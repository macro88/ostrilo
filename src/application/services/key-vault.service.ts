import type { StorageSuite } from "@/application/ports/storage";
import type {
  CryptoAead,
  CryptoKdf,
  Schnorr,
} from "@/application/ports/crypto";
import { AppSettingsV1, KeyRecord } from "@/domain/types";
import { randomBytes } from "@noble/hashes/utils.js";
import { bech32 } from "@scure/base";
import { zeroize, computeEventId, signEventHash } from "@/domain/utils/crypto";
import { SETTINGS_CHANGED_EVENT, defaultSettings } from "./settings.service";

const ENCRYPTED_KEYS_STORAGE = "encryptedKeys";
const LOCK_STATE_STORAGE = "lockState";
const SETTINGS_KEY = "appSettings";

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

  private parsePrivateKey(input: string): Uint8Array {
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

  private async encryptPrivateKey(
    sk: Uint8Array,
    password: string
  ): Promise<{ ct: number[]; iv: number[]; salt: number[] }> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const rawKey = await this.kdf.deriveKey(password, salt);
    try {
      const key = await this.aead.importKey(rawKey, ["encrypt"]);
      const ct = await this.aead.encrypt(key, iv, sk);
      return { ct: Array.from(ct), iv: Array.from(iv), salt: Array.from(salt) };
    } finally {
      // Always zeroize derived key material
      zeroize(rawKey);
    }
  }

  /**
   * Validates that the provided password can decrypt existing keys.
   * Throws an error if the password is incorrect.
   * This ensures all keys in the vault use the same password.
   */
  private async validatePasswordAgainstExistingKeys(
    password: string
  ): Promise<void> {
    const records = await this.listKeys();

    // If this is the first key, no validation needed
    if (records.length === 0) {
      return;
    }

    // Try to decrypt the first key to validate the password
    const firstKey = records[0];
    const salt = new Uint8Array(firstKey.salt);
    const iv = new Uint8Array(firstKey.iv);
    const ct = new Uint8Array(firstKey.ct);
    const rawKey = await this.kdf.deriveKey(password, salt);

    try {
      const key = await this.aead.importKey(rawKey, ["decrypt"]);
      const pt = await this.aead.decrypt(key, iv, ct);
      // Successfully decrypted - password is correct
      zeroize(pt);
    } catch (error) {
      // Decryption failed - wrong password
      throw new Error("incorrect_password");
    } finally {
      zeroize(rawKey);
    }
  }

  async generateKey(password: string, label?: string): Promise<KeyRecord> {
    if (!password) {
      throw new Error("password_required");
    }

    // Validate password can decrypt existing keys (if any)
    await this.validatePasswordAgainstExistingKeys(password);

    const sk = crypto.getRandomValues(new Uint8Array(32));
    try {
      const pub = await this.schnorr.getPublicKey(sk);
      const enc = await this.encryptPrivateKey(sk, password);
      const record: KeyRecord = {
        id: crypto.randomUUID(),
        label,
        pubkey: this.toHex(pub),
        ct: enc.ct,
        iv: enc.iv,
        salt: enc.salt,
        createdAt: Date.now(),
        isSelected: false,
      } as any;
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

    // Validate password can decrypt existing keys (if any)
    await this.validatePasswordAgainstExistingKeys(password);

    const sk = this.parsePrivateKey(input);
    try {
      const pub = await this.schnorr.getPublicKey(sk);
      const pubHex = this.toHex(pub);
      const existing = (await this.listKeys()).find((k) => k.pubkey === pubHex);
      if (existing) throw new Error("key_already_exists");
      const enc = await this.encryptPrivateKey(sk, password);
      const record: KeyRecord = {
        id: crypto.randomUUID(),
        label,
        pubkey: pubHex,
        ct: enc.ct,
        iv: enc.iv,
        salt: enc.salt,
        createdAt: Date.now(),
        isSelected: false,
      } as any;
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

  async unlock(password: string): Promise<{ selectedKeyId?: string }> {
    const [settings, records] = await Promise.all([
      this.getSettings(),
      this.listKeys(),
    ]);

    // Convert password to buffer for zeroization
    const passwordBuffer = new TextEncoder().encode(password);

    try {
      // Derive and decrypt each key into memory
      this.unlocked.clear();
      for (const rec of records) {
        const salt = new Uint8Array(rec.salt);
        const iv = new Uint8Array(rec.iv);
        const ct = new Uint8Array(rec.ct);
        const rawKey = await this.kdf.deriveKey(password, salt);
        let pt: Uint8Array | null = null;
        try {
          const key = await this.aead.importKey(rawKey, ["decrypt"]);
          pt = await this.aead.decrypt(key, iv, ct);
          this.unlocked.set(rec.id, pt);
          // Clear the local reference after storing
          pt = null;
        } finally {
          // Always zeroize derived key material
          zeroize(rawKey);
          // Zeroize the plaintext if it exists and wasn't stored
          if (pt) {
            zeroize(pt);
          }
        }
      }
    } finally {
      // Always zeroize password buffer
      zeroize(passwordBuffer);
    }

    const selectedKeyId = settings?.selectedKeyId ?? records[0]?.id;
    await this.storage.session.set<LockState>(LOCK_STATE_STORAGE, {
      isLocked: false,
      selectedKeyId,
      lastActivity: Date.now(),
    } as any);

    return { selectedKeyId };
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
   * Export private key in nsec bech32 format
   * Requires vault to be unlocked
   */
  async exportKey(keyId?: string): Promise<{ nsec: string; hex: string }> {
    const { sk } = this.ensureUnlockedKey(keyId);
    // Convert to nsec bech32 format
    const words = bech32.toWords(sk);
    const nsec = bech32.encode("nsec", words);
    // Also provide hex format
    const hex = this.toHex(sk);
    return { nsec, hex };
  }
}
