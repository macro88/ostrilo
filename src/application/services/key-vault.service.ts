import { StorageSuite } from "@/src/application/ports/storage";
import type {
  CryptoAead,
  CryptoKdf,
  Schnorr,
} from "@/src/application/ports/crypto";
import { AppSettingsV1, KeyRecord } from "@/src/domain/types";
import { randomBytes } from "@noble/hashes/utils";
import { bech32 } from "@scure/base";
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
    const raw = await this.kdf.deriveKey(password, salt);
    const key = await this.aead.importKey(raw, ["encrypt"]);
    const ct = await this.aead.encrypt(key, iv, sk);
    // zeroize derived raw
    raw.fill(0);
    return { ct: Array.from(ct), iv: Array.from(iv), salt: Array.from(salt) };
  }

  async generateKey(password: string, label?: string): Promise<KeyRecord> {
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
      // zeroize sk
      sk.fill(0);
    }
  }

  async importKey(
    input: string,
    password: string,
    label?: string
  ): Promise<KeyRecord> {
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
      sk.fill(0);
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

  async unlock(password: string): Promise<{ selectedKeyId?: string }> {
    const [settings, records] = await Promise.all([
      this.getSettings(),
      this.listKeys(),
    ]);

    // Derive and decrypt each key into memory
    this.unlocked.clear();
    for (const rec of records) {
      const salt = new Uint8Array(rec.salt);
      const iv = new Uint8Array(rec.iv);
      const ct = new Uint8Array(rec.ct);
      const rawKey = await this.kdf.deriveKey(password, salt);
      const key = await this.aead.importKey(rawKey, ["decrypt"]);
      const pt = await this.aead.decrypt(key, iv, ct);
      this.unlocked.set(rec.id, pt);
      // zeroize rawKey
      rawKey.fill(0);
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
    // zeroize secrets
    this.unlocked.forEach((v) => v.fill(0));
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
}
