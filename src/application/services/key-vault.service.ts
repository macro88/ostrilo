import { StorageSuite } from "@/src/application/ports/storage";
import type {
  CryptoAead,
  CryptoKdf,
  Schnorr,
} from "@/src/application/ports/crypto";
import { AppSettingsV1, KeyRecord } from "@/src/domain/types";

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
