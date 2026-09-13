import type { StorageSuite } from "@/application/ports/storage";
import type {
  CryptoAead,
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
} from "@/domain/types";
import { verifierAad, dekAad, skAad } from "@/domain/crypto/aad";
import { deriveLegacyKeyReadOnly } from "@/infrastructure/crypto/adapters";
import { bech32 } from "@scure/base";
import { zeroize, computeEventId, signEventHash } from "@/domain/utils/crypto";
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
    private schnorr: Schnorr
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

  private toHex(u8: Uint8Array): string {
    return Array.from(u8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private parsePrivateKey(input: string): SecretBytes {
    const trimmed = input.trim();
    const isHex =
      /^[0-9a-fA-F]{64}$/.test(trimmed) || /^0x[0-9a-fA-F]{64}$/.test(trimmed);
    if (isHex) {
      const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
      const out = new Uint8Array(32);
      for (let i = 0; i < 32; i++)
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    }
    // bech32 nsec
    if (trimmed.startsWith("nsec")) {
      const decoded = bech32.decode(trimmed as `${string}1${string}`);
      if (decoded.prefix !== "nsec") throw new Error("invalid_nsec_prefix");
      const bytes = new Uint8Array(bech32.fromWords(decoded.words));
      if (bytes.length !== 32) throw new Error("invalid_nsec_length");
      return bytes;
    }
    throw new Error("invalid_private_key_format");
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
      return this.toHex(pub) === pubkeyHex;
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
    await this.saveEnvelope(envelope);
    return { kek, kdf: envelope.kdf, created: true };
  }

  async generateKey(password: string, label?: string): Promise<KeyRecord> {
    if (!password) {
      throw new Error("password_required");
    }

    const { kek, kdf } = await this.kekForWrite(password);
    const sk = this.randomBytes(32);
    try {
      const pub = await this.schnorr.getPublicKey(sk);
      const id = crypto.randomUUID();
      const pubkey = this.toHex(pub);
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
      zeroize(sk);
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
    const sk = this.parsePrivateKey(input);
    try {
      const pub = await this.schnorr.getPublicKey(sk);
      const pubHex = this.toHex(pub);
      const existing = (await this.listKeys()).find((k) => k.pubkey === pubHex);
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
      zeroize(sk);
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
      } as any);
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
      } as any);

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

  async lock(): Promise<void> {
    // zeroize all unlocked private keys
    this.unlocked.forEach((sk) => zeroize(sk));
    this.unlocked.clear();

    await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
      isLocked: true,
      selectedKeyId: undefined,
      lastActivity: Date.now(),
    } as any);
    // Clear session grants on lock
    await this.storage.session.remove("sessionGrants");
    // Also clear any sessionGrantAll display flags in settings
    const settings = (await this.getSettings()) ?? ({} as AppSettingsV1);
    if (settings?.origins?.length) {
      const next = {
        ...settings,
        origins: settings.origins.map((o: any) => ({
          ...o,
          sessionGrantAll: false,
        })),
      } as any;
      await this.storage.sync.set<AppSettingsV1>(SETTINGS_KEY, next);
      try {
        const { browser } = await import("wxt/browser");
        browser.runtime.sendMessage({ __event: SETTINGS_CHANGED_EVENT });
      } catch {}
    }
  }

  async getLockState(): Promise<{ isLocked: boolean; selectedKeyId?: string }> {
    const state = await this.storage.session.get<LockState>(LOCK_STATE_STORAGE);
    return { isLocked: !!state?.isLocked, selectedKeyId: state?.selectedKeyId };
  }

  private ensureUnlockedKey(keyId?: string): { keyId: string; sk: Uint8Array } {
    const id = keyId ?? [...this.unlocked.keys()][0];
    if (!id) throw new Error("no_unlocked_key");
    const sk = this.unlocked.get(id);
    if (!sk) throw new Error("key_locked_or_missing");
    return { keyId: id, sk };
  }

  async sign(
    hashHex: string,
    keyId?: string
  ): Promise<{ sigHex: string; keyId: string }> {
    const bytes = new Uint8Array(
      hashHex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []
    );
    if (bytes.length !== 32) throw new Error("hash_must_be_32_bytes");
    const { keyId: id, sk } = this.ensureUnlockedKey(keyId);
    const sig = await this.schnorr.sign(bytes, sk);
    const sigHex = Array.from(sig)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { sigHex, keyId: id };
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
    const { sk } = this.ensureUnlockedKey(keyId);

    // Compute event ID per NIP-01
    const eventId = computeEventId(
      unsignedEvent.pubkey,
      unsignedEvent.created_at,
      unsignedEvent.kind,
      unsignedEvent.tags,
      unsignedEvent.content
    );

    // Sign the event ID
    const sig = signEventHash(eventId, sk);

    return {
      id: eventId,
      ...unsignedEvent,
      sig,
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

      const words = bech32.toWords(sk);
      const nsec = bech32.encode("nsec", words);
      const hex = this.toHex(sk);
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
