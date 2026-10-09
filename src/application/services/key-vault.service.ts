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
  KDF_CEILINGS,
  KDF_DEFAULTS,
  KDF_SALT_LENGTH,
  AES_GCM_IV_LENGTH,
  DEK_LENGTH,
  normalizeAutoLockMinutes,
  isLockReason,
  parseInactivityMinutes,
  type LockReason,
} from "@/domain/types";
import { verifierAad, dekAad, skAad } from "@/domain/crypto/aad";
import { deriveLegacyKeyReadOnly } from "@/infrastructure/crypto/adapters";
import { computeEventId } from "@/application/crypto/event-id";
import { parsePrivateKey } from "@/application/crypto/private-key";
import { CRYPTO_CONSTANTS } from "@/domain/crypto/constants";
import { bytesToHex, hexToBytes, isValidHex } from "@/domain/utils/hex";
import { zeroize } from "@/domain/utils/memory";
import { SerialLock } from "@/domain/utils/serial-lock";
import { SETTINGS_CHANGED_EVENT, defaultSettings } from "./settings.service";
import {
  ROTATION_JOURNAL_STORAGE,
  isRotationJournal,
  type RotationJournal,
} from "./vault-rotation-journal";
import { SettingsStore } from "./settings-store";
import { KeyBackupStatusService } from "./key-backup-status.service";

const ENCRYPTED_KEYS_STORAGE = "encryptedKeys";
const VAULT_ENVELOPE_STORAGE = "vaultEnvelope";
const LOCK_STATE_STORAGE = "lockState";

/**
 * Known plaintext sealed under the vault KEK. Decrypting it proves the password
 * before any per-record work happens, which is what lets a wrong password be
 * distinguished from a damaged record. Previously both surfaced as
 * "incorrect_password".
 */
const VERIFIER_PLAINTEXT = "ostrilo/vault-verifier/v1";

/** An unversioned record carrying the salt its key was encrypted under. */
type LegacyKeyRecord = KeyRecord & { salt: number[] };

function isLegacyRecord(rec: KeyRecord): rec is LegacyKeyRecord {
  return rec.v === undefined && Array.isArray(rec.salt);
}

type LockState = {
  isLocked: boolean;
  selectedKeyId?: string;
  lastActivity: number;
  /** Present only on a locked record. A label, never key material. */
  lockReason?: LockReason;
  /** The timeout that elapsed, on an `inactivity` lock, so the lock screen can name it. */
  inactivityMinutes?: number;
};

/** What `getLockState()` reports. `lockAt` is set only while unlocked; the rest only while locked. */
export type VaultLockState = {
  isLocked: boolean;
  selectedKeyId?: string;
  lockAt?: number;
  lockReason?: LockReason;
  inactivityMinutes?: number;
};

/** The outcome of checking an unlocked record against the clock and the timeout. */
type SessionDeadline =
  | { expired: false; lockAt: number }
  | {
      expired: true;
      reason: Extract<LockReason, "inactivity" | "clock_rollback" | "state_unreadable">;
      minutes: number;
    };

/** A password change refused because these records do not open. */
export class VaultDamagedRecordsError extends Error {
  constructor(readonly keyIds: string[]) {
    super("vault_has_damaged_records");
    this.name = "VaultDamagedRecordsError";
  }
}

export class KeyVaultService {
  private unlocked: Map<string, Uint8Array> = new Map();

  /**
   * Records the last unlock could not open. Held so that a request for one of
   * them is refused for what it is, rather than reported as a locked vault or
   * answered with another key.
   */
  private unreadable: Set<string> = new Set();

  /**
   * Incremented by every lock and unlock. A read of the lock state that awaits
   * storage compares it before correcting the record, so a correction computed
   * from a session that has since ended cannot overwrite the newer record.
   */
  private sessionEpoch = 0;

  /**
   * One vault write at a time. A password change replaces the KEK every record
   * is wrapped under; a key imported mid-rotation would otherwise be sealed
   * under the old KEK and then dropped by the rotation's record list. In
   * memory is enough: the background worker is the only writer.
   */
  private writeLock = new SerialLock();

  constructor(
    private storage: StorageSuite,
    private aead: CryptoAead,
    private kdf: CryptoKdf,
    private schnorr: Schnorr,
    private hash: CryptoHash,
    private bech32: Bech32Codec,
    private settingsStore: SettingsStore = new SettingsStore(storage),
    /**
     * Per-key backup status. The vault is the one place a key is created or
     * deleted, so it is also the one place that sets a new key `pending` and
     * drops a deleted key's record: a key cannot exist without its status.
     */
    readonly backupStatus: KeyBackupStatusService = new KeyBackupStatusService(
      storage.local
    )
  ) {}

  async getSettings(): Promise<AppSettingsV1 | undefined> {
    return await this.settingsStore.read<AppSettingsV1>();
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
   * Rejects a record whose recorded cost is below the floor or above the
   * ceiling, before any derivation runs.
   *
   * Without the floor, an attacker able to write extension storage could
   * rewrite the stored parameters to something trivially cheap. The AAD
   * binding makes that tamper detectable, and this check makes it refused
   * rather than merely detected late. Without the ceiling, the same writer
   * could set a memory cost that stalls or crashes the worker on every unlock.
   */
  private assertKdfAcceptable(kdf: KdfParams): void {
    if (kdf.alg === "argon2id") {
      const f = KDF_FLOORS.argon2id;
      const c = KDF_CEILINGS.argon2id;
      if (kdf.m < f.m || kdf.t < f.t || kdf.p < f.p) {
        throw new Error("kdf_below_floor");
      }
      if (kdf.m > c.m || kdf.t > c.t || kdf.p > c.p) {
        throw new Error("kdf_above_ceiling");
      }
    } else if (kdf.alg === "pbkdf2-sha256") {
      if (kdf.c < KDF_FLOORS["pbkdf2-sha256"].c) {
        throw new Error("kdf_below_floor");
      }
      if (kdf.c > KDF_CEILINGS["pbkdf2-sha256"].c) {
        throw new Error("kdf_above_ceiling");
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
    } catch {
      // The version and KDF-floor refusals are thrown before the try, so
      // anything caught here is the verifier failing to open.
      zeroize(kek);
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
  /** Unwraps a record's DEK under `kek`. Caller owns zeroizing it. */
  private async unwrapDek(
    rec: KeyRecord,
    kek: SecretBytes,
    kdf: KdfParams
  ): Promise<SecretBytes> {
    if (!rec.wrappedDek) throw new Error("record_missing_wrapped_dek");
    const kekKey = await this.aead.importKey(kek, ["decrypt"]);
    return await this.aead.decrypt(
      kekKey,
      Uint8Array.from(rec.wrappedDek.iv) as SecretBytes,
      Uint8Array.from(rec.wrappedDek.ct) as SecretBytes,
      dekAad(rec.v ?? VAULT_VERSION, kdf, rec.id, rec.pubkey)
    );
  }

  private async openPrivateKey(
    rec: KeyRecord,
    kek: SecretBytes,
    kdf: KdfParams
  ): Promise<SecretBytes> {
    const dek = await this.unwrapDek(rec, kek, kdf);
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
    // A rotation whose commit failed leaves a mixed envelope and record list.
    // Sealing a new key into that would be overwritten by the recovery.
    await this.recoverInterruptedRotation(password);
    const existing = await this.getEnvelope();
    if (existing) {
      const kek = await this.openEnvelope(password, existing);
      return { kek, kdf: existing.kdf, created: false };
    }

    // No envelope. Either a brand-new vault, or a legacy vault whose password
    // must be proven against a legacy record before an envelope is created -
    // otherwise a wrong password would silently create a second vault.
    const records = await this.listKeys();
    const legacy = records.filter(isLegacyRecord);
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

  /**
   * With `onlyIfEmpty`, creates nothing and throws `vault_not_empty` when the
   * vault already holds a key. The check runs inside the write lock, before the
   * envelope is touched, so two callers racing to make the first key cannot both
   * pass it: the second sees the first's key. A UI that only looked at the key
   * list first could not promise that.
   */
  async generateKey(
    password: string,
    label?: string,
    options: { onlyIfEmpty?: boolean } = {}
  ): Promise<KeyRecord> {
    return this.writeLock.run(() =>
      this.generateKeyNow(password, label, options.onlyIfEmpty === true)
    );
  }

  private async generateKeyNow(
    password: string,
    label: string | undefined,
    onlyIfEmpty: boolean
  ): Promise<KeyRecord> {
    if (!password) {
      throw new Error("password_required");
    }
    if (onlyIfEmpty && (await this.listKeys()).length > 0) {
      throw new Error("vault_not_empty");
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
      // Before any write that names this key, so a failure here leaves neither
      // a stored key nor a selection pointing at one. A saveKeys failure after
      // it can leave an orphan pending record, which is inert: the id is random
      // and never reused.
      await this.backupStatus.markPending(id);
      const hasSelected =
        (await this.getSettings())?.selectedKeyId ??
        records.find((r) => r.isSelected)?.id;
      if (!hasSelected && records.length === 0) {
        record.isSelected = true;
        // also set selectedKeyId in settings
        const settings = (await this.getSettings()) ?? defaultSettings();
        await this.settingsStore.write<AppSettingsV1>({
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
    return this.writeLock.run(() => this.importKeyNow(input, password, label));
  }

  private async importKeyNow(
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
        await this.settingsStore.write<AppSettingsV1>({
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
    return this.writeLock.run(() => this.selectKeyNow(id));
  }

  private async selectKeyNow(id: string): Promise<void> {
    // Update selectedKeyId in settings
    const settings = (await this.getSettings()) ?? defaultSettings();
    await this.settingsStore.write<AppSettingsV1>({
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
    return this.writeLock.run(() => this.renameKeyNow(id, label));
  }

  private async renameKeyNow(id: string, label: string): Promise<void> {
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
    return this.writeLock.run(() => this.deleteKeyNow(id));
  }

  private async deleteKeyNow(
    id: string
  ): Promise<{ newSelectedKeyId?: string }> {
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
      // A key always remains: deleting the last one is refused above.
      newSelectedKeyId = updatedRecords[0].id;
      await this.selectKeyNow(newSelectedKeyId);
    }

    // Last, and best effort: the secret is already zeroized and the selection
    // repaired, and an orphan status record for a deleted id is inert. A failed
    // write here must not abort that cleanup.
    try {
      await this.backupStatus.remove(id);
    } catch (error) {
      console.warn("[Vault] could not drop a deleted key's backup status:", error);
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
    legacyRecords: LegacyKeyRecord[]
  ): Promise<void> {
    for (const rec of legacyRecords) {
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
    // Serialised with every vault write: unlock can create the envelope,
    // migrate legacy records and recover an interrupted rotation.
    return this.writeLock.run(() => this.unlockNow(password));
  }

  private async unlockNow(password: string): Promise<{
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
    await this.recoverInterruptedRotation(password);

    // All three reads are independent; issue them together rather than
    // serialising three storage round-trips on the unlock path.
    const [settings, records, loadedEnvelope] = await Promise.all([
      this.getSettings(),
      this.listKeys(),
      this.getEnvelope(),
    ]);
    let envelope = loadedEnvelope;
    const legacyRecords = records.filter(isLegacyRecord);

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

      // A re-unlock over a live session replaces these keys; they are wiped,
      // not merely dropped.
      this.discardUnlockedKeys();
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

      // The password was right but not one key opened. Reporting the vault
      // unlocked would hand every surface an open session with nothing in it,
      // and the next read would blame the browser for it
      // (`background_restarted`). The record is left locked, with no reason
      // rather than a false one, and the caller is told the keys are damaged.
      if (unlockedKeyIds.length === 0) {
        await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
          isLocked: true,
          selectedKeyId: undefined,
          lastActivity: Date.now(),
        });
        throw new Error("vault_keys_unreadable");
      }

      if (migrated.length > 0) {
        const byId = new Map(migrated.map((r) => [r.id, r]));
        await this.saveKeys(records.map((r) => byId.get(r.id) ?? r));
      }

      this.unreadable = new Set(damagedKeyIds);

      // The stored selection is kept while its record exists, even when that
      // record could not be opened: signing with it is then refused, and the
      // user chooses another key. Falling back to a different key here would
      // sign as an identity they did not pick. Only a selection that no longer
      // exists in the records falls back to the first key that opened.
      const stored = settings?.selectedKeyId;
      const selectedKeyId =
        stored !== undefined && records.some((rec) => rec.id === stored)
          ? stored
          : unlockedKeyIds[0];
      if (selectedKeyId !== stored) {
        // Written through the path `vault.select` uses, so the settings and the
        // records' `isSelected` flags - which `nostr-rpc` resolves the signing
        // key from - agree with the session. Only the selection moves; no key
        // material or other field of a record is rewritten.
        await this.selectKeyNow(selectedKeyId);
      }

      await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
        isLocked: false,
        selectedKeyId,
        lastActivity: Date.now(),
      });

      await this.notifyUnlocked();
      // A surface that opened while locked read the settings redacted - no
      // relays, no origins, no selected key - and keeps them until told
      // otherwise. This is what tells it the real ones are now readable.
      await this.broadcastSettingsChanged();

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

  /** Zeroizes every held private key, then forgets it. */
  private discardUnlockedKeys(): void {
    this.sessionEpoch++;
    this.unlocked.forEach((sk) => zeroize(sk));
    this.unlocked.clear();
    this.unreadable.clear();
  }

  /** True when the last unlock could not open this key's record. */
  isKeyUnreadable(id: string): boolean {
    return this.unreadable.has(id);
  }

  /**
   * `reason` is recorded for the lock screen; it defaults to `manual` because
   * the lock button is the one caller that names nothing.
   */
  async lock(
    reason: LockReason = "manual",
    inactivityMinutes?: number
  ): Promise<void> {
    // The security-critical steps come first and do not depend on settings
    // storage: the keys are gone, the state says locked, and the grants are
    // revoked before anything else can fail.
    this.discardUnlockedKeys();
    await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
      isLocked: true,
      selectedKeyId: undefined,
      lastActivity: Date.now(),
      lockReason: reason,
      ...(parseInactivityMinutes(inactivityMinutes) === undefined
        ? {}
        : { inactivityMinutes }),
    });
    await this.storage.session.remove("sessionGrants");

    // The listeners run in `finally`, because one of them denies the pending
    // approvals: a settings write that throws (it once lived under sync's
    // quota; a full disk or corrupt record still can) used to skip them, so a
    // request the user walked away from could survive the lock. The error
    // still reaches the caller, after them.
    try {
      await this.clearSessionDisplayFlags();
    } finally {
      await this.notifyLocked();
    }
  }

  /** Clears the `sessionGrantAll` display flags that mirror the revoked grants. */
  private async clearSessionDisplayFlags(): Promise<void> {
    const settings = (await this.getSettings()) ?? ({} as AppSettingsV1);
    if (!settings?.origins?.length) return;
    const next = {
      ...settings,
      origins: settings.origins.map((o) => ({
        ...o,
        sessionGrantAll: false,
      })),
    } satisfies AppSettingsV1;
    await this.settingsStore.write<AppSettingsV1>(next);
    await this.broadcastSettingsChanged();
  }

  /**
   * Tells every open surface to read the settings again.
   *
   * Best-effort: no listener is the normal case (no extension page open), and
   * a failed broadcast changes nothing that was stored.
   */
  private async broadcastSettingsChanged(): Promise<void> {
    try {
      const { browser } = await import("wxt/browser");
      browser.runtime.sendMessage({ __event: SETTINGS_CHANGED_EVENT });
    } catch {
      // Nothing to deliver to.
    }
  }

  /**
   * After the state is written and the keys are gone, so a listener sees a
   * locked vault. Concurrent and settled, not sequential: the listeners are
   * independent, and one that hangs or throws - a badge that will not clear,
   * a broadcast with no listener - must not stop the others.
   */
  private async notifyLocked(): Promise<void> {
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
   *      material - which happens when the browser ends the MV3 service
   *      worker. The record is corrected on the way out so the two do not
   *      keep disagreeing.
   *
   * Each reports a `lockReason` except a state that was never written, which
   * is the ordinary first state of a browser session. The reason is recorded
   * at the moment of locking, so a surface opened later reads the same answer.
   */
  async getLockState(): Promise<VaultLockState> {
    const epoch = this.sessionEpoch;
    let state: LockState | undefined;
    try {
      state = await this.storage.session.get<LockState>(LOCK_STATE_STORAGE);
    } catch {
      return { isLocked: true, lockReason: "state_unreadable" };
    }

    // Absent: nothing has been unlocked in this browser session. That is the
    // normal first state, not a fault, so it carries no reason.
    if (state === undefined) return { isLocked: true };

    // Malformed: locked, and said so. `isLocked` must be a boolean; anything
    // else is a record this code did not write.
    if (!state || typeof state !== "object" || typeof state.isLocked !== "boolean") {
      return { isLocked: true, lockReason: "state_unreadable" };
    }

    if (state.isLocked) {
      return {
        isLocked: true,
        selectedKeyId: state.selectedKeyId,
        ...(isLockReason(state.lockReason) ? { lockReason: state.lockReason } : {}),
        ...(parseInactivityMinutes(state.inactivityMinutes) === undefined
          ? {}
          : { inactivityMinutes: state.inactivityMinutes }),
      };
    }

    const deadline = await this.sessionDeadline(state);
    if (deadline.expired) {
      const minutes = deadline.reason === "inactivity" ? deadline.minutes : undefined;
      await this.lock(deadline.reason, minutes);
      return {
        isLocked: true,
        lockReason: deadline.reason,
        ...(minutes === undefined ? {} : { inactivityMinutes: minutes }),
      };
    }

    // Says unlocked, but there is nothing in memory: the worker was evicted.
    // Correct the record rather than reporting an unlocked vault with no keys,
    // which surfaced to the user as a confusing "denied" on the next signature.
    if (this.unlocked.size === 0) {
      // A lock or unlock that ran while this read was awaiting storage already
      // wrote a newer record, with its own reason. Read again instead of
      // overwriting it with a conclusion drawn from the old one.
      if (epoch !== this.sessionEpoch) return this.getLockState();
      await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
        isLocked: true,
        selectedKeyId: undefined,
        lastActivity: Date.now(),
        lockReason: "background_restarted",
      });
      return { isLocked: true, lockReason: "background_restarted" };
    }

    return {
      isLocked: false,
      selectedKeyId: state.selectedKeyId,
      lockAt: deadline.lockAt,
    };
  }

  /**
   * Checks an unlocked record against the clock and the normalized timeout.
   *
   * Derived from a stored timestamp checked on access rather than from a timer
   * firing, because a `setTimeout` in an MV3 service worker does not survive
   * worker eviction: a timer-only design would silently never lock.
   *
   * The one formula behind both enforcement and what `getLockState()` reports,
   * so the deadline shown to the user cannot drift from the deadline applied.
   * Every unusable timestamp is `expired`, so every fail-closed case stays
   * closed - including `NaN`, which compares false against everything and
   * would otherwise read as a deadline that never arrives.
   */
  private async sessionDeadline(state: LockState): Promise<SessionDeadline> {
    const settings = await this.getSettings();
    // Normalized, not read raw: a stored 0 used to mean "never lock", and
    // that reading is exactly the fail-open this change removes. It is now
    // the shipped default, as it is everywhere else settings are read.
    const minutes = normalizeAutoLockMinutes(settings?.autoLockMinutes);

    const last = state.lastActivity;
    if (typeof last !== "number" || !Number.isFinite(last) || last <= 0) {
      return { expired: true, reason: "state_unreadable", minutes };
    }

    // A timestamp in the future means the clock moved or the record was
    // tampered with. Treat it as expired rather than as a long lease.
    const now = Date.now();
    if (last > now) return { expired: true, reason: "clock_rollback", minutes };

    const lockAt = last + minutes * 60 * 1000;
    if (now >= lockAt) return { expired: true, reason: "inactivity", minutes };
    return { expired: false, lockAt };
  }

  /** Records user activity and pushes the auto-lock deadline out. */
  async touchActivity(): Promise<void> {
    const state = await this.storage.session.get<LockState>(LOCK_STATE_STORAGE);
    if (!state || state.isLocked !== false) return; // never revive a locked vault

    // A passed deadline is locked too - the record just has not been read yet,
    // because the check is lazy and `state.touch` does not run it. The stored
    // flag alone was a sufficient guard only while nothing called this; once
    // the surfaces report activity, an expired session reached by a late
    // report would be silently extended past a deadline that had already run
    // out. Locked means the same thing here as it does in `getLockState()`.
    if ((await this.sessionDeadline(state)).expired) return;
    await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
      ...state,
      lastActivity: Date.now(),
    });
  }

  /**
   * The key a call without an explicit ID means: the stored selection.
   *
   * Never another key: the first entry of the unlocked map is not "the" key,
   * and a caller that omits the ID must not sign as whichever opened first.
   */
  private async resolveKeyId(keyId?: string): Promise<string> {
    if (keyId) return keyId;
    if (this.unlocked.size === 0) throw new Error("no_unlocked_key");
    const selected = (await this.getSettings())?.selectedKeyId;
    if (!selected) throw new Error("no_unlocked_key");
    return selected;
  }

  private ensureUnlockedKey(id: string): { keyId: string; sk: Uint8Array } {
    const sk = this.unlocked.get(id);
    if (!sk) {
      // aislop-ignore-next-line ai-slop/hardcoded-id -- internal error contract, not a deployment identifier or credential: nostr-rpc matches this exact string and maps it to RPC_ERROR_CODES. Moving it to an environment variable would break the mapping.
      if (this.unreadable.has(id)) throw new Error("key_unreadable");
      // aislop-ignore-next-line ai-slop/hardcoded-id -- internal error contract, not a deployment identifier or credential: nostr-rpc matches this exact string and maps it to RPC_ERROR_CODES. Moving it to an environment variable would break the mapping.
      throw new Error("key_locked_or_missing");
    }
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
    const { keyId: id, sk } = this.ensureUnlockedKey(await this.resolveKeyId(keyId));
    const sig = await this.schnorr.sign(bytes, sk);
    return { sigHex: bytesToHex(sig), keyId: id };
  }

  /**
   * Sign a Nostr event (NIP-01).
   * Computes event ID and signature for an unsigned event.
   *
   * @param unsignedEvent - Event without id and sig fields
   * @param keyId - Optional key ID (the stored selected key if omitted, never
   *   another key; a selected key that is not open fails rather than falling back)
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
    return this.writeLock.run(() => this.verifyPasswordNow(password));
  }

  private async verifyPasswordNow(password: string): Promise<void> {
    if (!password) throw new Error("password_required");
    await this.recoverInterruptedRotation(password);

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
  /**
   * Replaces the master password: one new KEK, every DEK re-wrapped under it,
   * a new verifier. The private-key ciphertexts are untouched - `skAad` does
   * not bind the KDF, and re-sealing them would defend against a leaked DEK,
   * which is not what a password rotation is for. The envelope and the records
   * are separate storage items, so the commit goes through a single-item
   * journal; see `vault-rotation-journal.ts`.
   *
   * Throws `incorrect_password` only for a wrong `current`, so the caller can
   * charge the password throttle for exactly that.
   */
  async changePassword(current: string, next: string): Promise<void> {
    return this.writeLock.run(() => this.changePasswordNow(current, next));
  }

  private async changePasswordNow(current: string, next: string): Promise<void> {
    if (!current || !next) throw new Error("password_required");
    await this.recoverInterruptedRotation(current);

    const [envelope, records] = await Promise.all([
      this.getEnvelope(),
      this.listKeys(),
    ]);
    if (!envelope || records.length === 0) throw new Error("vault_not_created");

    let oldKek: SecretBytes | null = null;
    let newKek: SecretBytes | null = null;
    try {
      oldKek = await this.openEnvelope(current, envelope);
      // Refused before the new KEK exists: rotating around a record that
      // cannot be opened would strand it under a password nobody holds.
      if (records.some((r) => r.v === undefined)) {
        throw new Error("vault_has_legacy_records");
      }
      const damaged = await this.recordsThatDoNotOpen(records, oldKek, envelope.kdf);
      if (damaged.length > 0) throw new VaultDamagedRecordsError(damaged);

      const created = await this.createEnvelope(next);
      newKek = created.kek;
      const nextEnvelope: VaultEnvelope = {
        ...created.envelope,
        createdAt: envelope.createdAt,
      };
      const [fromKek, toKek] = [oldKek, newKek];
      const nextRecords = await Promise.all(
        records.map((rec) =>
          this.rewrapRecord(rec, fromKek, envelope.kdf, toKek, nextEnvelope.kdf)
        )
      );

      await this.commitRotation({
        from: { envelope, records },
        to: { envelope: nextEnvelope, records: nextRecords },
      });
    } finally {
      if (oldKek) zeroize(oldKek);
      if (newKek) zeroize(newKek);
    }
    // The session carries on: the unlocked map holds private keys, not
    // anything derived from the KEK. A password change is user activity.
    await this.touchActivity();
  }

  /** The ids of records that do not open, and match their pubkey, under `kek`. */
  private async recordsThatDoNotOpen(
    records: KeyRecord[],
    kek: SecretBytes,
    kdf: KdfParams
  ): Promise<string[]> {
    const opens = await Promise.all(
      records.map(async (rec) => {
        let sk: SecretBytes | null = null;
        try {
          sk = await this.openPrivateKey(rec, kek, kdf);
          return await this.matchesPubkey(sk, rec.pubkey);
        } catch {
          return false;
        } finally {
          if (sk) zeroize(sk);
        }
      })
    );
    return records.filter((_, i) => !opens[i]).map((rec) => rec.id);
  }

  /**
   * Moves one record's DEK from the old KEK to the new one, and proves the
   * result by opening it and matching the pubkey before anything is written,
   * as `migrateLegacyRecord` does. The ciphertext and its IV are carried over
   * byte for byte.
   */
  private async rewrapRecord(
    rec: KeyRecord,
    oldKek: SecretBytes,
    oldKdf: KdfParams,
    newKek: SecretBytes,
    newKdf: KdfParams
  ): Promise<KeyRecord> {
    const dek = await this.unwrapDek(rec, oldKek, oldKdf);
    let roundTripped: SecretBytes | null = null;
    try {
      const dekIv = this.randomBytes(AES_GCM_IV_LENGTH);
      const newKey = await this.aead.importKey(newKek, ["encrypt"]);
      const wrapped = await this.aead.encrypt(
        newKey,
        dekIv,
        dek,
        dekAad(rec.v ?? VAULT_VERSION, newKdf, rec.id, rec.pubkey)
      );
      const candidate: KeyRecord = {
        ...rec,
        wrappedDek: { ct: Array.from(wrapped), iv: Array.from(dekIv) },
      };
      roundTripped = await this.openPrivateKey(candidate, newKek, newKdf);
      if (!(await this.matchesPubkey(roundTripped, rec.pubkey))) {
        throw new Error("rotation_verification_failed");
      }
      return candidate;
    } finally {
      zeroize(dek);
      if (roundTripped) zeroize(roundTripped);
    }
  }

  /**
   * Journal first, then the two live items, then the journal goes. Until the
   * journal is removed, `recoverInterruptedRotation` can restore either whole
   * state; success is reported only after it is.
   */
  private async commitRotation(journal: RotationJournal): Promise<void> {
    await this.storage.local.set<RotationJournal>(ROTATION_JOURNAL_STORAGE, journal);
    await this.saveEnvelope(journal.to.envelope);
    await this.saveKeys(journal.to.records);
    await this.storage.local.remove(ROTATION_JOURNAL_STORAGE);
  }

  /**
   * Finishes an interrupted password change, if there is one.
   *
   * A password that opens the journal's after-state rolls forward: it is a
   * credential the user chose, and the rotation was otherwise complete. One
   * that opens the before-state rolls back: the user was never told the change
   * succeeded. Either way a whole state is written, so this is correct
   * whichever live write was interrupted, and idempotent if it is interrupted
   * itself. A password that opens neither leaves the journal for the normal
   * path to report `incorrect_password`.
   */
  private async recoverInterruptedRotation(password: string): Promise<void> {
    const journal = await this.storage.local.get<unknown>(ROTATION_JOURNAL_STORAGE);
    if (!isRotationJournal(journal)) return;
    for (const state of [journal.to, journal.from]) {
      if (await this.passwordOpens(password, state.envelope)) {
        await this.saveEnvelope(state.envelope);
        await this.saveKeys(state.records);
        await this.storage.local.remove(ROTATION_JOURNAL_STORAGE);
        return;
      }
    }
  }

  private async passwordOpens(
    password: string,
    envelope: VaultEnvelope
  ): Promise<boolean> {
    try {
      zeroize(await this.openEnvelope(password, envelope));
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === "incorrect_password") {
        return false;
      }
      throw error;
    }
  }
}
