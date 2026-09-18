import type { StorageSuite } from "@/application/ports/storage";
import type {
  Bech32Codec,
  CryptoAead,
  CryptoHash,
  CryptoKdf,
  Schnorr,
  SecretBytes,
} from "@/application/ports/crypto";
import {
  AppSettingsV1,
  KeyRecord,
  VaultEnvelope,
  KdfParams,
  VAULT_VERSION,
  SUPPORTED_VAULT_VERSIONS,
  KDF_FLOORS,
  KDF_DEFAULTS,
  KDF_SALT_LENGTH,
  AES_GCM_IV_LENGTH,
  DEK_LENGTH,
  normalizeAutoLockMinutes,
} from "@/domain/types";
import { verifierAad, dekAad, skAad } from "@/domain/crypto/aad";
import { deriveLegacyKeyReadOnly } from "@/infrastructure/crypto/adapters";
import { computeEventId } from "@/application/crypto/event-id";
import { parsePrivateKey } from "@/application/crypto/private-key";
import { CRYPTO_CONSTANTS } from "@/domain/crypto/constants";
import { bytesToHex, hexToBytes, isValidHex } from "@/domain/utils/hex";
import { zeroize } from "@/domain/utils/memory";
import { SETTINGS_CHANGED_EVENT, defaultSettings } from "./settings.service";

const ENCRYPTED_KEYS_STORAGE = "encryptedKeys";
const VAULT_ENVELOPE_STORAGE = "vaultEnvelope";
const LOCK_STATE_STORAGE = "lockState";
const SETTINGS_KEY = "appSettings";

/**
 * Known plaintext sealed under the vault KEK. Decrypting it proves the password
 * before any per-record work happens, which is what lets a wrong password be
 * distinguished from a damaged record. Previously both surfaced as
 * "incorrect_password".
 */
const VERIFIER_PLAINTEXT = "ostrilo/vault-verifier/v1";

type LockState = {
  isLocked: boolean;
  selectedKeyId?: string;
  lastActivity: number;
};

export class KeyVaultService {
  private unlocked: Map<string, Uint8Array> = new Map();

  constructor(
    private storage: StorageSuite,
    private aead: CryptoAead,
    private kdf: CryptoKdf,
    private schnorr: Schnorr,
    private hash: CryptoHash,
    private bech32: Bech32Codec
  ) {}

  async getSettings(): Promise<AppSettingsV1 | undefined> {
    return await this.storage.sync.get<AppSettingsV1>(SETTINGS_KEY);
  }

  async listKeys(): Promise<KeyRecord[]> {
    return (
      (await this.storage.local.get<KeyRecord[]>(ENCRYPTED_KEYS_STORAGE)) ?? []
    );
  }

  private async saveKeys(records: KeyRecord[]): Promise<void> {
    await this.storage.local.set<KeyRecord[]>(ENCRYPTED_KEYS_STORAGE, records);
  }

  // ==========================================================================
  // Vault envelope
  //
  // One password-derived key-encryption key (KEK) per vault wraps a per-key
  // data-encryption key (DEK). Unlock therefore costs exactly one KDF run no
  // matter how many keys the vault holds. The previous design derived once per
  // record, which is why a memory-hard KDF was unaffordable: a five-key vault
  // would have paid five times the cost.
  // ==========================================================================

  async getEnvelope(): Promise<VaultEnvelope | undefined> {
    return await this.storage.local.get<VaultEnvelope>(VAULT_ENVELOPE_STORAGE);
  }

  private async saveEnvelope(env: VaultEnvelope): Promise<void> {
    await this.storage.local.set<VaultEnvelope>(VAULT_ENVELOPE_STORAGE, env);
  }

  private randomBytes(n: number): SecretBytes {
    // Single auditable CSPRNG entry point for every random draw in this
    // service: private keys, DEKs, salts and IVs all come through here.
    return crypto.getRandomValues(new Uint8Array(n)) as SecretBytes;
  }

  /**
   * Rejects a record whose recorded cost is below the floor.
   *
   * Without this, an attacker able to write extension storage could rewrite the
   * stored parameters to something trivially cheap. The AAD binding makes that
   * tamper detectable, and this check makes it refused rather than merely
   * detected late.
   */
  private assertKdfAcceptable(kdf: KdfParams): void {
    if (kdf.alg === "argon2id") {
      const f = KDF_FLOORS.argon2id;
      if (kdf.m < f.m || kdf.t < f.t || kdf.p < f.p) {
        throw new Error("kdf_below_floor");
      }
    } else if (kdf.alg === "pbkdf2-sha256") {
      if (kdf.c < KDF_FLOORS["pbkdf2-sha256"].c) {
        throw new Error("kdf_below_floor");
      }
    } else {
      throw new Error("kdf_unknown_algorithm");
    }
  }

  private assertVersionSupported(v: number | undefined): void {
    if (v === undefined) return; // legacy record; handled by the legacy path
    if (!SUPPORTED_VAULT_VERSIONS.includes(v)) {
      throw new Error("vault_version_unsupported");
    }
  }

  private freshKdfParams(): KdfParams {
    const salt = Array.from(this.randomBytes(KDF_SALT_LENGTH));
    return { ...KDF_DEFAULTS, salt } as KdfParams;
  }

  /** Derives the KEK. Callers MUST zeroize the result. */
  private async deriveKek(
    password: string,
    kdf: KdfParams
  ): Promise<SecretBytes> {
    this.assertKdfAcceptable(kdf);
    return await this.kdf.deriveKey(password, kdf);
  }

  /** Creates a brand-new envelope and returns it with its (live) KEK. */
  private async createEnvelope(
    password: string
  ): Promise<{ envelope: VaultEnvelope; kek: SecretBytes }> {
    const kdf = this.freshKdfParams();
    const kek = await this.deriveKek(password, kdf);
    try {
      const iv = this.randomBytes(AES_GCM_IV_LENGTH);
      const key = await this.aead.importKey(kek, ["encrypt"]);
      const ct = await this.aead.encrypt(
        key,
        iv,
        new TextEncoder().encode(VERIFIER_PLAINTEXT) as SecretBytes,
        verifierAad(VAULT_VERSION, kdf)
      );
      const now = Date.now();
      const envelope: VaultEnvelope = {
        v: VAULT_VERSION,
        kdf,
        verifier: { ct: Array.from(ct), iv: Array.from(iv) },
        createdAt: now,
        updatedAt: now,
      };
      return { envelope, kek };
    } catch (e) {
      zeroize(kek);
      throw e;
    }
  }

  /**
   * Proves the password against the envelope verifier and returns the KEK.
   * Callers MUST zeroize the result.
   *
   * Throws `incorrect_password` only here. A per-record failure later means a
   * damaged record, not a bad password, and must not be reported as one.
   */
  private async openEnvelope(
    password: string,
    envelope: VaultEnvelope
  ): Promise<SecretBytes> {
    this.assertVersionSupported(envelope.v);
    const kek = await this.deriveKek(password, envelope.kdf);
    try {
      const key = await this.aead.importKey(kek, ["decrypt"]);
      const pt = await this.aead.decrypt(
        key,
        Uint8Array.from(envelope.verifier.iv) as SecretBytes,
        Uint8Array.from(envelope.verifier.ct) as SecretBytes,
        verifierAad(envelope.v, envelope.kdf)
      );
      const ok = new TextDecoder().decode(pt) === VERIFIER_PLAINTEXT;
      zeroize(pt);
      if (!ok) throw new Error("incorrect_password");
      return kek;
    } catch (e) {
      zeroize(kek);
      if (e instanceof Error && e.message === "kdf_below_floor") throw e;
      if (e instanceof Error && e.message === "vault_version_unsupported") throw e;
      throw new Error("incorrect_password");
    }
  }

  /**
   * Seals a private key: a fresh DEK per key encrypts the key itself, and the
   * KEK wraps the DEK. Both operations are bound to the record's identity by
   * AAD, so a ciphertext cannot be moved to another record.
   */
  private async sealPrivateKey(
    sk: SecretBytes,
    kek: SecretBytes,
    kdf: KdfParams,
    keyId: string,
    pubkey: string
  ): Promise<Pick<KeyRecord, "ct" | "iv" | "wrappedDek" | "v">> {
    const dek = this.randomBytes(DEK_LENGTH);
    try {
      const skIv = this.randomBytes(AES_GCM_IV_LENGTH);
      const dekKey = await this.aead.importKey(dek, ["encrypt"]);
      const ct = await this.aead.encrypt(
        dekKey,
        skIv,
        sk,
        skAad(VAULT_VERSION, keyId, pubkey)
      );

      const dekIv = this.randomBytes(AES_GCM_IV_LENGTH);
      const kekKey = await this.aead.importKey(kek, ["encrypt"]);
      const wrapped = await this.aead.encrypt(
        kekKey,
        dekIv,
        dek,
        dekAad(VAULT_VERSION, kdf, keyId, pubkey)
      );

      return {
        v: VAULT_VERSION,
        ct: Array.from(ct),
        iv: Array.from(skIv),
        wrappedDek: { ct: Array.from(wrapped), iv: Array.from(dekIv) },
      };
    } finally {
      zeroize(dek);
    }
  }

  /** Opens a v:1 record. Returns the private key; caller owns zeroizing it. */
  private async openPrivateKey(
    rec: KeyRecord,
    kek: SecretBytes,
    kdf: KdfParams
  ): Promise<SecretBytes> {
    if (!rec.wrappedDek) throw new Error("record_missing_wrapped_dek");
    const kekKey = await this.aead.importKey(kek, ["decrypt"]);
    const dek = await this.aead.decrypt(
      kekKey,
      Uint8Array.from(rec.wrappedDek.iv) as SecretBytes,
      Uint8Array.from(rec.wrappedDek.ct) as SecretBytes,
      dekAad(rec.v ?? VAULT_VERSION, kdf, rec.id, rec.pubkey)
    );
    try {
      const dekKey = await this.aead.importKey(dek, ["decrypt"]);
      return await this.aead.decrypt(
        dekKey,
        Uint8Array.from(rec.iv) as SecretBytes,
        Uint8Array.from(rec.ct) as SecretBytes,
        skAad(rec.v ?? VAULT_VERSION, rec.id, rec.pubkey)
      );
    } finally {
      zeroize(dek);
    }
  }

  /**
   * Confirms a recovered private key actually belongs to the record it came
   * from. Unlock previously returned whatever decrypted without ever checking
   * it against the stored pubkey.
   */
  private async matchesPubkey(
    sk: Uint8Array,
    pubkeyHex: string
  ): Promise<boolean> {
    try {
      const pub = await this.schnorr.getPublicKey(sk);
      return bytesToHex(pub) === pubkeyHex;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the KEK for a write, creating the envelope on first use.
   *
   * This replaces `validatePasswordAgainstExistingKeys`, which decrypted
   * `records[0]` to check the password - an extra full KDF run that only ever
   * validated against one record. The envelope verifier does the same job once,
   * for the whole vault.
   *
   * Callers MUST zeroize the returned KEK.
   */
  private async kekForWrite(
    password: string
  ): Promise<{ kek: SecretBytes; kdf: KdfParams; created: boolean }> {
    const existing = await this.getEnvelope();
    if (existing) {
      const kek = await this.openEnvelope(password, existing);
      return { kek, kdf: existing.kdf, created: false };
    }

    // No envelope. Either a brand-new vault, or a legacy vault whose password
    // must be proven against a legacy record before an envelope is created -
    // otherwise a wrong password would silently create a second vault.
    const records = await this.listKeys();
    const legacy = records.filter((r) => r.v === undefined && r.salt);
    if (legacy.length > 0) {
      await this.assertLegacyPassword(password, legacy);
    }

    const { envelope, kek } = await this.createEnvelope(password);
    // A catch, not a finally: the success path transfers ownership of this KEK
    // to the caller, so clearing it unconditionally would break every write.
    // Mirrors createEnvelope's own failure path directly above.
    try {
      await this.saveEnvelope(envelope);
    } catch (e) {
      zeroize(kek);
      throw e;
    }
    return { kek, kdf: envelope.kdf, created: true };
  }

  async generateKey(password: string, label?: string): Promise<KeyRecord> {
    if (!password) {
      throw new Error("password_required");
    }

    const { kek, kdf } = await this.kekForWrite(password);
    // Drawn inside the try: the KEK is already owned here, and the CSPRNG can
    // throw. No catch - a catch could mask the platform's own error.
    let sk: SecretBytes | null = null;
    try {
      sk = this.randomBytes(32);
      const pub = await this.schnorr.getPublicKey(sk);
      const id = crypto.randomUUID();
      const pubkey = bytesToHex(pub);
      const sealed = await this.sealPrivateKey(sk, kek, kdf, id, pubkey);
      const record: KeyRecord = {
        id,
        label,
        pubkey,
        ...sealed,
        createdAt: Date.now(),
        isSelected: false,
      } as KeyRecord;
      const records = await this.listKeys();
      const hasSelected =
        (await this.getSettings())?.selectedKeyId ??
        records.find((r) => r.isSelected)?.id;
      if (!hasSelected && records.length === 0) {
        record.isSelected = true;
        // also set selectedKeyId in settings
        const settings = (await this.getSettings()) ?? defaultSettings();
        await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, {
          ...defaultSettings(),
          ...settings,
          __version: "settings.v1",
          selectedKeyId: record.id,
        } as AppSettingsV1);
      }
      const next = [...records, record];
      await this.saveKeys(next);
      return record;
    } finally {
      // zeroize private key material
      if (sk) zeroize(sk);
      zeroize(kek);
    }
  }

  async importKey(
    input: string,
    password: string,
    label?: string
  ): Promise<KeyRecord> {
    if (!password) {
      throw new Error("password_required");
    }

    const { kek, kdf } = await this.kekForWrite(password);
    // Parsed inside the try: the KEK is already owned here, and a malformed
    // input throws. No catch - a catch could mask the parser's own error.
    let sk: SecretBytes | null = null;
    try {
      sk = parsePrivateKey(this.bech32, input) as SecretBytes;
      const pub = await this.schnorr.getPublicKey(sk);
      const pubHex = bytesToHex(pub);
      const existing = (await this.listKeys()).find((k) => k.pubkey === pubHex);
      // aislop-ignore-next-line ai-slop/hardcoded-id -- internal error contract, not a deployment identifier or credential: vault-rpc matches this exact string and maps it to RPC_ERROR_CODES. Moving it to an environment variable would break the mapping.
      if (existing) throw new Error("key_already_exists");
      const id = crypto.randomUUID();
      const sealed = await this.sealPrivateKey(sk, kek, kdf, id, pubHex);
      const record: KeyRecord = {
        id,
        label,
        pubkey: pubHex,
        ...sealed,
        createdAt: Date.now(),
        isSelected: false,
      } as KeyRecord;
      const records = await this.listKeys();
      const hasSelected =
        (await this.getSettings())?.selectedKeyId ??
        records.find((r) => r.isSelected)?.id;
      if (!hasSelected && records.length === 0) {
        record.isSelected = true;
        const settings = (await this.getSettings()) ?? defaultSettings();
        await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, {
          ...defaultSettings(),
          ...settings,
          __version: "settings.v1",
          selectedKeyId: record.id,
        } as AppSettingsV1);
      }
      const next = [...records, record];
      await this.saveKeys(next);
      return record;
    } finally {
      if (sk) zeroize(sk);
      zeroize(kek);
    }
  }

  async selectKey(id: string): Promise<void> {
    // Update selectedKeyId in settings
    const settings = (await this.getSettings()) ?? defaultSettings();
    await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, {
      ...defaultSettings(),
      ...settings,
      __version: "settings.v1",
      selectedKeyId: id,
    } as AppSettingsV1);
    // Also mark in local list for UI convenience
    const records = await this.listKeys();
    const next = records.map((r) => ({ ...r, isSelected: r.id === id }));
    await this.saveKeys(next);
    // Update session lock selected id if unlocked
    const state = await this.storage.session.get<LockState>(LOCK_STATE_STORAGE);
    if (state && state.isLocked === false) {
      await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
        ...state,
        selectedKeyId: id,
      });
    }
  }

  async renameKey(id: string, label: string): Promise<void> {
    const records = await this.listKeys();
    const keyIndex = records.findIndex((r) => r.id === id);

    if (keyIndex === -1) {
      throw new Error("key_not_found");
    }

    // Update the label
    records[keyIndex] = { ...records[keyIndex], label };
    await this.saveKeys(records);
  }

  async deleteKey(id: string): Promise<{ newSelectedKeyId?: string }> {
    const records = await this.listKeys();

    // Prevent deleting the last key
    if (records.length === 1) {
      throw new Error("cannot_delete_last_key");
    }

    const keyIndex = records.findIndex((r) => r.id === id);

    if (keyIndex === -1) {
      throw new Error("key_not_found");
    }

    // Remove the key from the list
    const updatedRecords = records.filter((r) => r.id !== id);
    await this.saveKeys(updatedRecords);

    // Remove from unlocked map if present
    const unlockedKey = this.unlocked.get(id);
    if (unlockedKey) {
      zeroize(unlockedKey);
      this.unlocked.delete(id);
    }

    // Check if we deleted the currently selected key
    const settings = await this.getSettings();
    let newSelectedKeyId: string | undefined;

    if (settings?.selectedKeyId === id) {
      // Auto-select the first remaining key
      newSelectedKeyId = updatedRecords[0]?.id;
      if (newSelectedKeyId) {
        await this.selectKey(newSelectedKeyId);
      }
    }

    return { newSelectedKeyId };
  }

  /**
   * Proves a password against legacy (unversioned) records.
   *
   * Legacy records have no verifier, so the only way to check the password is
   * to try decrypting one. `incorrect_password` is reported only when EVERY
   * legacy record fails: a single damaged record must not be mistaken for a
   * wrong password.
   */
  private async assertLegacyPassword(
    password: string,
    legacyRecords: KeyRecord[]
  ): Promise<void> {
    for (const rec of legacyRecords) {
      if (!rec.salt) continue;
      const raw = await deriveLegacyKeyReadOnly(
        password,
        Uint8Array.from(rec.salt)
      );
      try {
        const key = await this.aead.importKey(raw, ["decrypt"]);
        const pt = await this.aead.decrypt(
          key,
          Uint8Array.from(rec.iv) as SecretBytes,
          Uint8Array.from(rec.ct) as SecretBytes,
          new Uint8Array(0) as SecretBytes // legacy records carry no AAD
        );
        zeroize(pt);
        return; // one success proves the password
      } catch {
        // try the next record
      } finally {
        zeroize(raw);
      }
    }
    throw new Error("incorrect_password");
  }

  /**
   * Unlocks the vault.
   *
   * Order matters here and is the substance of the change:
   *   1. Prove the password ONCE against the envelope verifier, before any
   *      per-record work. That is what separates "wrong password" from
   *      "damaged record", which the previous implementation conflated.
   *   2. Decrypt each record in its own try/catch. The previous `Promise.all`
   *      rejected wholesale, so one corrupt record made the entire vault
   *      un-unlockable and reported it to the user as a bad password.
   *   3. Verify every recovered key against its stored pubkey before accepting
   *      it. Nothing checked this before.
   *
   * `isLocked: false` is written only after the password is proven.
   */
  async unlock(password: string): Promise<{
    selectedKeyId?: string;
    unlockedKeyIds: string[];
    damagedKeyIds: string[];
  }> {
    // NOTE: there is deliberately no `passwordBuffer` here. This method used to
    // encode `password` into a Uint8Array and zeroize that, which looked like
    // the password was being cleared. It was not: the encoded copy was never
    // passed to anything, so the code created a *second* copy of the secret
    // purely to have something to wipe.
    //
    // The honest position: `password` is an immutable JavaScript string. It
    // cannot be erased. What we can do is avoid extra copies and drop
    // references promptly.
    // All three reads are independent; issue them together rather than
    // serialising three storage round-trips on the unlock path.
    const [settings, records, loadedEnvelope] = await Promise.all([
      this.getSettings(),
      this.listKeys(),
      this.getEnvelope(),
    ]);
    let envelope = loadedEnvelope;
    const legacyRecords = records.filter((r) => r.v === undefined && r.salt);

    if (!envelope && records.length === 0) {
      // aislop-ignore-next-line ai-slop/meta-comment -- not build-plan narration: this records the security invariant that an empty vault must not open with any password. Deleting it invites the fail-open behavior back.
      // Previously this "succeeded" and marked the session unlocked without
      // verifying anything, so an empty vault opened with any password.
      throw new Error("vault_not_created");
    }

    let kek: SecretBytes | null = null;
    try {
      if (envelope) {
        kek = await this.openEnvelope(password, envelope);
      } else {
        // Legacy-only vault: prove the password against a legacy record, then
        // create the envelope so migration has a KEK to seal against.
        await this.assertLegacyPassword(password, legacyRecords);
        const created = await this.createEnvelope(password);
        envelope = created.envelope;
        kek = created.kek;
        await this.saveEnvelope(envelope);
      }

      this.unlocked.clear();
      const unlockedKeyIds: string[] = [];
      const damagedKeyIds: string[] = [];
      const migrated: KeyRecord[] = [];

      for (const rec of records) {
        let sk: SecretBytes | null = null;
        try {
          this.assertVersionSupported(rec.v);
          sk =
            rec.v === undefined
              ? await this.openLegacyRecord(password, rec)
              : await this.openPrivateKey(rec, kek, envelope.kdf);

          if (!(await this.matchesPubkey(sk, rec.pubkey))) {
            throw new Error("pubkey_mismatch");
          }

          this.unlocked.set(rec.id, sk);
          unlockedKeyIds.push(rec.id);

          if (rec.v === undefined) {
            const upgraded = await this.migrateLegacyRecord(
              rec,
              sk,
              kek,
              envelope.kdf
            );
            if (upgraded) migrated.push(upgraded);
          }
          sk = null; // ownership transferred to this.unlocked
        } catch {
          damagedKeyIds.push(rec.id);
        } finally {
          if (sk) zeroize(sk);
        }
      }

      if (migrated.length > 0) {
        const byId = new Map(migrated.map((r) => [r.id, r]));
        await this.saveKeys(records.map((r) => byId.get(r.id) ?? r));
      }

      const selectedKeyId =
        settings?.selectedKeyId && unlockedKeyIds.includes(settings.selectedKeyId)
          ? settings.selectedKeyId
          : unlockedKeyIds[0];

      await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
        isLocked: false,
        selectedKeyId,
        lastActivity: Date.now(),
      });

      await this.notifyUnlocked();

      return { selectedKeyId, unlockedKeyIds, damagedKeyIds };
    } finally {
      if (kek) zeroize(kek);
    }
  }

  /** Opens an unversioned record with the read-only legacy derivation. */
  private async openLegacyRecord(
    password: string,
    rec: KeyRecord
  ): Promise<SecretBytes> {
    if (!rec.salt) throw new Error("legacy_record_missing_salt");
    const raw = await deriveLegacyKeyReadOnly(
      password,
      Uint8Array.from(rec.salt)
    );
    try {
      const key = await this.aead.importKey(raw, ["decrypt"]);
      return await this.aead.decrypt(
        key,
        Uint8Array.from(rec.iv) as SecretBytes,
        Uint8Array.from(rec.ct) as SecretBytes,
        new Uint8Array(0) as SecretBytes // legacy records carry no AAD
      );
    } finally {
      zeroize(raw);
    }
  }

  /**
   * Write-verify-then-delete migration of a single legacy record.
   *
   * The new material is written and read back and checked against the stored
   * pubkey BEFORE the legacy `salt` is dropped. If anything fails the record is
   * returned untouched, so the key stays usable and simply migrates on a later
   * unlock. A migration must never be able to lose a key.
   */
  private async migrateLegacyRecord(
    rec: KeyRecord,
    sk: SecretBytes,
    kek: SecretBytes,
    kdf: KdfParams
  ): Promise<KeyRecord | null> {
    try {
      const sealed = await this.sealPrivateKey(sk, kek, kdf, rec.id, rec.pubkey);
      const candidate: KeyRecord = { ...rec, ...sealed };

      // Read it back before trusting it.
      const roundTripped = await this.openPrivateKey(candidate, kek, kdf);
      try {
        if (!(await this.matchesPubkey(roundTripped, rec.pubkey))) return null;
      } finally {
        zeroize(roundTripped);
      }

      // Only now is it safe to drop the legacy field.
      const { salt: _legacySalt, ...withoutSalt } = candidate;
      return withoutSalt as KeyRecord;
    } catch {
      return null; // leave the legacy record exactly as it was
    }
  }

  /**
   * Notified after every lock, however it was triggered.
   *
   * The vault must not import the approval queue - that points the
   * dependency the wrong way through the layers - but something has to
   * deny the requests that are waiting when the vault locks. Locking with
   * an approval window open left the request pending and the badge showing
   * a count; the next unlock could then approve a signature the user had
   * walked away from.
   */
  private lockListeners: Array<() => void | Promise<void>> = [];

  onLock(listener: () => void | Promise<void>): void {
    this.lockListeners.push(listener);
  }

  /** Notified after a successful unlock. Symmetric with onLock. */
  private unlockListeners: Array<() => void | Promise<void>> = [];

  onUnlock(listener: () => void | Promise<void>): void {
    this.unlockListeners.push(listener);
  }

  private async notifyUnlocked(): Promise<void> {
    const results = await Promise.allSettled(
      this.unlockListeners.map((listener) => listener())
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[Vault] unlock listener failed:", result.reason);
      }
    }
  }

  async lock(): Promise<void> {
    // zeroize all unlocked private keys
    this.unlocked.forEach((sk) => zeroize(sk));
    this.unlocked.clear();

    await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
      isLocked: true,
      selectedKeyId: undefined,
      lastActivity: Date.now(),
    });
    // Clear session grants on lock
    await this.storage.session.remove("sessionGrants");
    // Also clear any sessionGrantAll display flags in settings
    const settings = (await this.getSettings()) ?? ({} as AppSettingsV1);
    if (settings?.origins?.length) {
      const next = {
        ...settings,
        origins: settings.origins.map((o) => ({
          ...o,
          sessionGrantAll: false,
        })),
      } satisfies AppSettingsV1;
      await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, next);
      try {
        const { browser } = await import("wxt/browser");
        browser.runtime.sendMessage({ __event: SETTINGS_CHANGED_EVENT });
      } catch {
        // No listener is the normal case (no extension page open); the
        // broadcast is best-effort and its failure changes nothing here.
      }
    }
    // After the state is written and the keys are gone, so a listener sees a
    // locked vault. Concurrent and settled, not sequential: the listeners are
    // independent, and one that hangs or throws - a badge that will not clear,
    // a broadcast with no listener - must not stop the vault from locking.
    const results = await Promise.allSettled(
      this.lockListeners.map((listener) => listener())
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[Vault] lock listener failed:", result.reason);
      }
    }
  }

  // aislop-ignore-next-line ai-slop/meta-comment -- not build-plan narration: this block documents why the lock gate FAILS CLOSED, including the identity leak a fail-open reading caused. Deleting it invites the regression back.
  /**
   * The single definition of "is the vault locked".
   *
   * This FAILS CLOSED. It used to be `isLocked: !!state?.isLocked`, which
   * returns false - unlocked - whenever session storage holds no lock state at
   * all. That is the situation after every browser restart, before anything has
   * been unlocked, so a vault that had never been opened reported itself open.
   * At the time, `nostr.getPublicKey` checked only this gate, so the user's
   * Nostr identity leaked to any page from a vault they had never unlocked.
   * The method now validates the calling origin and is rate limited per
   * origin as well; this gate is still what it answers to first.
   *
   * Three ways to be locked, all of which now report locked:
   *   1. No stored state, malformed state, or a read that throws.
   *   2. The stored state says unlocked but the deadline has passed.
   *   3. The stored state says unlocked but the background holds no key
   *      material - which happens on every MV3 worker eviction. The record is
   *      corrected on the way out so the two do not keep disagreeing.
   */
  async getLockState(): Promise<{ isLocked: boolean; selectedKeyId?: string }> {
    let state: LockState | undefined;
    try {
      state = await this.storage.session.get<LockState>(LOCK_STATE_STORAGE);
    } catch {
      return { isLocked: true };
    }

    // Absent or malformed: locked.
    if (!state || typeof state !== "object" || state.isLocked !== false) {
      return { isLocked: true, selectedKeyId: state?.selectedKeyId };
    }

    // Deadline passed: locked. A future timestamp is treated as expired rather
    // than trusted, so a clock change cannot extend a session indefinitely.
    const deadlinePassed = await this.isPastAutoLockDeadline(state);
    if (deadlinePassed) {
      await this.lock();
      return { isLocked: true };
    }

    // Says unlocked, but there is nothing in memory: the worker was evicted.
    // Correct the record rather than reporting an unlocked vault with no keys,
    // which surfaced to the user as a confusing "denied" on the next signature.
    if (this.unlocked.size === 0) {
      await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
        isLocked: true,
        selectedKeyId: undefined,
        lastActivity: Date.now(),
      } as LockState);
      return { isLocked: true };
    }

    return { isLocked: false, selectedKeyId: state.selectedKeyId };
  }

  /**
   * True when `autoLockMinutes` has elapsed since the last recorded activity.
   *
   * Derived from a stored timestamp checked on access rather than from a timer
   * firing, because a `setTimeout` in an MV3 service worker does not survive
   * worker eviction: a timer-only design would silently never lock.
   */
  private async isPastAutoLockDeadline(state: LockState): Promise<boolean> {
    const settings = await this.getSettings();
    // Normalized, not read raw: a stored 0 used to mean "never lock", and
    // that reading is exactly the fail-open this change removes. It is now
    // the shipped default, as it is everywhere else settings are read.
    const minutes = normalizeAutoLockMinutes(settings?.autoLockMinutes);

    const last = typeof state.lastActivity === "number" ? state.lastActivity : 0;
    if (last <= 0) return true;

    const now = Date.now();
    // A timestamp in the future means the clock moved or the record was
    // tampered with. Treat it as expired rather than as a long lease.
    if (last > now) return true;

    return now - last >= minutes * 60 * 1000;
  }

  /** Records user activity and pushes the auto-lock deadline out. */
  async touchActivity(): Promise<void> {
    const state = await this.storage.session.get<LockState>(LOCK_STATE_STORAGE);
    if (!state || state.isLocked !== false) return; // never revive a locked vault
    await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
      ...state,
      lastActivity: Date.now(),
    } as LockState);
  }

  private ensureUnlockedKey(keyId?: string): { keyId: string; sk: Uint8Array } {
    const id = keyId ?? [...this.unlocked.keys()][0];
    if (!id) throw new Error("no_unlocked_key");
    const sk = this.unlocked.get(id);
    // aislop-ignore-next-line ai-slop/hardcoded-id -- internal error contract, not a deployment identifier or credential: vault-rpc matches this exact string and maps it to RPC_ERROR_CODES. Moving it to an environment variable would break the mapping.
    if (!sk) throw new Error("key_locked_or_missing");
    return { keyId: id, sk };
  }

  /**
   * The single Schnorr call site in this class.
   *
   * `hashHex` is validated as 64 characters of hex BEFORE it is decoded. The
   * previous decode was `hashHex.match(/.{1,2}/g).map(b => parseInt(b, 16))`,
   * which never checked the characters: a non-hex pair became `NaN`, which
   * stores as `0` in a `Uint8Array`, so a corrupt hash was signed as a
   * partially-zeroed one. The length check that followed caught truncation
   * and nothing else.
   */
  async sign(
    hashHex: string,
    keyId?: string
  ): Promise<{ sigHex: string; keyId: string }> {
    if (!isValidHex(hashHex, 32)) throw new Error("hash_must_be_32_bytes");
    const bytes = hexToBytes(hashHex);
    const { keyId: id, sk } = this.ensureUnlockedKey(keyId);
    const sig = await this.schnorr.sign(bytes, sk);
    return { sigHex: bytesToHex(sig), keyId: id };
  }

  /**
   * Sign a Nostr event (NIP-01).
   * Computes event ID and signature for an unsigned event.
   *
   * @param unsignedEvent - Event without id and sig fields
   * @param keyId - Optional key ID (uses selected key if omitted)
   * @returns Signed event with id and sig
   */
  async signEvent(
    unsignedEvent: {
      pubkey: string;
      created_at: number;
      kind: number;
      tags: string[][];
      content: string;
    },
    keyId?: string
  ): Promise<{
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }> {
    const eventId = computeEventId(this.hash, unsignedEvent);

    // aislop-ignore-next-line ai-slop/meta-comment -- not build-plan narration: this records why there is a single Schnorr call site, an invariant a security test enforces. Deleting it invites a second signing path back into the domain layer.
    // Through `this.sign`, not a second Schnorr call. This method used to
    // call `signEventHash`, which reached `@noble/curves` directly from the
    // domain layer, so the same class signed two different ways and only one
    // of them went through the injected port a test could substitute.
    const { sigHex } = await this.sign(eventId, keyId);

    return {
      id: eventId,
      ...unsignedEvent,
      sig: sigHex,
    };
  }

  /**
   * Reveal private key with password re-verification.
   * The ONLY path that releases private key material. It re-verifies the
   * password against the vault envelope rather than trusting the unlocked
   * session, and checks the recovered key against the record's stored pubkey
   * before returning anything.
   *
   * A passwordless `exportKey` used to sit alongside this. It required only
   * that the vault was unlocked, had no caller, and was reachable by any code
   * running in an extension page. It has been removed.
   */
  /**
   * Verifies a password without returning anything derived from it.
   *
   * Used to re-authenticate a high-risk action while the vault is already
   * unlocked: deleting a key, raising an origin to `high` trust, or changing
   * a security timeout. Those actions previously needed only an unlocked
   * vault, so anyone with a minute at an unattended screen could grant an
   * origin silent-signing authority that outlived their access to the device.
   *
   * Verification decrypts real key material - the same check `unlock` makes -
   * rather than comparing against anything stored, and everything it derives
   * is zeroized before it returns. Nothing is cached: a second action needs a
   * second entry.
   */
  async verifyPassword(password: string): Promise<void> {
    if (!password) throw new Error("password_required");

    const records = await this.listKeys();
    if (records.length === 0) throw new Error("vault_not_created");

    const envelope = await this.getEnvelope();
    let kek: SecretBytes | null = null;
    let sk: SecretBytes | null = null;
    try {
      // Prefer a versioned record: the envelope verifier is the cheapest
      // honest check. Fall back to a legacy record for a vault that has not
      // been migrated yet.
      const record =
        records.find((r) => r.v !== undefined) ?? records[0];
      if (record.v === undefined) {
        sk = await this.openLegacyRecord(password, record);
      } else {
        if (!envelope) throw new Error("vault_not_created");
        kek = await this.openEnvelope(password, envelope);
        sk = await this.openPrivateKey(record, kek, envelope.kdf);
      }
      if (!(await this.matchesPubkey(sk, record.pubkey))) {
        throw new Error("pubkey_mismatch");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "vault_not_created") throw error;
      throw new Error("incorrect_password");
    } finally {
      if (sk) zeroize(sk);
      if (kek) zeroize(kek);
    }
  }

  async revealKey(
    password: string,
    keyId?: string
  ): Promise<{ nsec: string; hex: string }> {
    if (!password) {
      throw new Error("password_required");
    }

    // Get the key record
    const records = await this.listKeys();
    const targetId = keyId || (await this.getSettings())?.selectedKeyId;
    if (!targetId) {
      throw new Error("vault_locked");
    }

    const record = records.find((r) => r.id === targetId);
    if (!record) {
      throw new Error("key_not_found");
    }

    // Re-verify the password against the vault envelope rather than trusting
    // the unlocked session, then open just this record.
    const envelope = await this.getEnvelope();
    let kek: SecretBytes | null = null;
    let sk: SecretBytes | null = null;
    try {
      if (record.v === undefined) {
        // Legacy record: the only available check is decrypting it.
        sk = await this.openLegacyRecord(password, record);
      } else {
        if (!envelope) throw new Error("vault_not_created");
        kek = await this.openEnvelope(password, envelope);
        sk = await this.openPrivateKey(record, kek, envelope.kdf);
      }

      // Never hand back material that does not match the record it came from.
      if (!(await this.matchesPubkey(sk, record.pubkey))) {
        throw new Error("pubkey_mismatch");
      }

      const nsec = this.bech32.encode(
        CRYPTO_CONSTANTS.NOSTR_PRIVATE_KEY_PREFIX,
        sk
      );
      const hex = bytesToHex(sk);
      return { nsec, hex };
    } catch (error) {
      if (error instanceof Error && error.message === "pubkey_mismatch") throw error;
      if (error instanceof Error && error.message === "vault_not_created") throw error;
      throw new Error("incorrect_password");
    } finally {
      if (sk) zeroize(sk);
      if (kek) zeroize(kek);
    }
  }
}
