import {
  AES_GCM_IV_LENGTH,
  KDF_DEFAULTS,
  KDF_FLOORS,
  KDF_CEILINGS,
  KDF_SALT_LENGTH,
  type KdfParams,
} from "@/domain/types";
import { VaultKdf, WebCryptoAesGcm } from "@/infrastructure/crypto/adapters";
import type { SecretBytes } from "@/application/ports/crypto";

/**
 * The encrypted backup file the create-key flow writes.
 *
 * This replaces `handleDownloadKey`, which serialised
 * `{ name, privateKey: nsec, privateKeyHex, createdAt }` to a `Blob` and saved
 * it through a synthetic anchor click. That file landed in Downloads: synced to
 * iCloud/OneDrive/Dropbox, captured by Time Machine, indexed by Spotlight, and
 * the first directory commodity infostealers read. A Nostr identity cannot be
 * rotated, so that outcome is permanent and total.
 *
 * Three properties this format is built for, each asserted by
 * `tests/unit/ui/features/onboarding/key-backup-envelope.test.ts`:
 *
 *  1. **Nothing readable.** The nsec, the hex key and the user's key name all
 *     live inside the ciphertext. The header carries only the parameters needed
 *     to derive the key again. Grepping the file for `nsec1` finds nothing.
 *  2. **Parameters travel with the material.** The KDF descriptor is recorded
 *     in the file and handed back to `VaultKdf.deriveKey` verbatim on restore.
 *     That is the same rule the vault follows (`src/infrastructure/crypto/
 *     adapters.ts`), and it is what allows the work factor to be raised later
 *     without making existing backups unreadable. It is also why the recorded
 *     parameters are checked against `KDF_FLOORS` and `KDF_CEILINGS` before
 *     use: a file is attacker-supplied input, and neither a rolled-back work
 *     factor nor a ruinous one may be honoured.
 *  3. **The header is authenticated.** The version, the KDF descriptor and the
 *     IV are bound into the GCM tag as additional authenticated data, so a file
 *     whose header has been rewritten fails to decrypt instead of decrypting
 *     under weaker parameters.
 *
 * No new crypto dependency and no second crypto implementation: the KDF and the
 * AEAD are the adapters the vault itself uses.
 */

export const KEY_BACKUP_TYPE = "ostrilo-key-backup";
export const KEY_BACKUP_VERSION = 1 as const;

/** KDF parameters as they appear in the file: same shape, base64 salt. */
export type SerializedKdfParams =
  | { alg: "argon2id"; m: number; t: number; p: number; salt: string }
  | { alg: "pbkdf2-sha256"; c: number; salt: string };

export interface KeyBackupEnvelopeV1 {
  v: typeof KEY_BACKUP_VERSION;
  type: typeof KEY_BACKUP_TYPE;
  kdf: SerializedKdfParams;
  cipher: { name: "AES-GCM"; iv: string };
  ct: string;
  createdAt: string;
}

/** What the ciphertext contains. Never written outside an envelope. */
export interface KeyBackupPayload {
  nsec: string;
  hex: string;
  name: string;
}

/**
 * Every failure the backup path can produce.
 *
 * The message is deliberately uniform across "wrong passphrase", "truncated
 * ciphertext" and "tampered header": AES-GCM cannot distinguish them without
 * leaking, and a message that did distinguish them would tell an attacker
 * holding the file which of their guesses was closest.
 */
export class KeyBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyBackupError";
  }
}

export const BACKUP_DECRYPT_FAILURE_MESSAGE =
  "Could not open this backup. Check the passphrase and that the file is the one Ostrilo wrote.";

const AAD_DOMAIN_KEY_BACKUP = "ostrilo/key-backup";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked so a large ciphertext cannot blow the argument limit on `apply`.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(value: string): SecretBytes {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out as SecretBytes;
}

function zeroize(bytes: Uint8Array | null): void {
  if (bytes) bytes.fill(0);
}

/**
 * Additional authenticated data for a backup envelope.
 *
 * Length-prefixed fields in a fixed order, exactly as `src/domain/crypto/aad.ts`
 * does it and for the same reason: JSON key order and whitespace are not
 * guaranteed stable across engines, and an AAD that changes shape makes every
 * existing file undecryptable. The domain prefix keeps a backup ciphertext from
 * ever being accepted where a vault record is expected.
 */
function backupAad(
  version: number,
  kdf: SerializedKdfParams,
  iv: string
): SecretBytes {
  const parts: Uint8Array[] = [];
  const push = (bytes: Uint8Array) => {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.byteLength, false);
    parts.push(len, bytes);
  };

  push(encoder.encode(AAD_DOMAIN_KEY_BACKUP));
  const versionBytes = new Uint8Array(4);
  new DataView(versionBytes.buffer).setUint32(0, version, false);
  push(versionBytes);
  push(encoder.encode(kdf.alg));
  push(
    encoder.encode(
      kdf.alg === "argon2id"
        ? `m=${kdf.m},t=${kdf.t},p=${kdf.p}`
        : `c=${kdf.c}`
    )
  );
  push(encoder.encode(kdf.salt));
  push(encoder.encode(iv));

  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out as SecretBytes;
}

function serializeKdf(params: KdfParams, salt: Uint8Array): SerializedKdfParams {
  if (params.alg === "argon2id") {
    return {
      alg: "argon2id",
      m: params.m,
      t: params.t,
      p: params.p,
      salt: toBase64(salt),
    };
  }
  return { alg: "pbkdf2-sha256", c: params.c, salt: toBase64(salt) };
}

/**
 * Rebuilds the parameters `VaultKdf` needs from what the file recorded, after
 * checking them against the floors. A file is untrusted input; accepting
 * `{ alg: "pbkdf2-sha256", c: 1 }` out of it would make the passphrase
 * brute-forceable at no cost to the attacker who wrote it.
 */
function deserializeKdf(kdf: SerializedKdfParams): KdfParams {
  const salt = Array.from(fromBase64(kdf.salt));
  if (salt.length < KDF_SALT_LENGTH) {
    throw new KeyBackupError(BACKUP_DECRYPT_FAILURE_MESSAGE);
  }

  // Out-of-bounds parameters fail exactly like a wrong passphrase: a backup
  // file is untrusted input, and a distinct message would help probe it. The
  // ceiling is checked here, before derivation, because a crafted `m` in the
  // gigabytes would otherwise stall or crash the page that opens the file.
  if (kdf.alg === "argon2id") {
    const floor = KDF_FLOORS.argon2id;
    const ceiling = KDF_CEILINGS.argon2id;
    if (
      kdf.m < floor.m || kdf.t < floor.t || kdf.p < floor.p ||
      kdf.m > ceiling.m || kdf.t > ceiling.t || kdf.p > ceiling.p
    ) {
      throw new KeyBackupError(BACKUP_DECRYPT_FAILURE_MESSAGE);
    }
    return { alg: "argon2id", m: kdf.m, t: kdf.t, p: kdf.p, salt };
  }

  if (
    kdf.c < KDF_FLOORS["pbkdf2-sha256"].c ||
    kdf.c > KDF_CEILINGS["pbkdf2-sha256"].c
  ) {
    throw new KeyBackupError(BACKUP_DECRYPT_FAILURE_MESSAGE);
  }
  return { alg: "pbkdf2-sha256", c: kdf.c, salt };
}

/**
 * Seals a payload under a passphrase supplied at export time.
 *
 * The passphrase is deliberately NOT the vault master password: sealing the
 * backup under the master password would mean forgetting that one password
 * loses the vault and its backup together, which is to say the backup would add
 * no recovery value at all.
 */
export async function createKeyBackup(
  payload: KeyBackupPayload,
  passphrase: string
): Promise<KeyBackupEnvelopeV1> {
  if (!passphrase) {
    throw new KeyBackupError("A backup passphrase is required.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(KDF_SALT_LENGTH));
  const iv = crypto.getRandomValues(
    new Uint8Array(AES_GCM_IV_LENGTH)
  ) as SecretBytes;
  const params: KdfParams = { ...KDF_DEFAULTS, salt: Array.from(salt) };
  const kdf = serializeKdf(params, salt);
  const ivB64 = toBase64(iv);

  let derived: SecretBytes | null = null;
  let plaintext: SecretBytes | null = null;
  try {
    derived = await VaultKdf.deriveKey(passphrase, params);
    const key = await WebCryptoAesGcm.importKey(derived, ["encrypt"]);
    plaintext = encoder.encode(JSON.stringify(payload)) as SecretBytes;
    const ct = await WebCryptoAesGcm.encrypt(
      key,
      iv,
      plaintext,
      backupAad(KEY_BACKUP_VERSION, kdf, ivB64)
    );
    return {
      v: KEY_BACKUP_VERSION,
      type: KEY_BACKUP_TYPE,
      kdf,
      cipher: { name: "AES-GCM", iv: ivB64 },
      ct: toBase64(ct),
      createdAt: new Date().toISOString(),
    };
  } finally {
    zeroize(derived);
    zeroize(plaintext);
  }
}

/**
 * Opens an envelope, or fails closed.
 *
 * Callers get `KeyBackupError` with a message that names neither the key nor
 * the passphrase, whatever went wrong.
 */
export async function openKeyBackup(
  envelope: KeyBackupEnvelopeV1,
  passphrase: string
): Promise<KeyBackupPayload> {
  if (!passphrase) {
    throw new KeyBackupError("A backup passphrase is required.");
  }

  const params = deserializeKdf(envelope.kdf);
  let derived: SecretBytes | null = null;
  let decrypted: SecretBytes | null = null;
  try {
    derived = await VaultKdf.deriveKey(passphrase, params);
    const key = await WebCryptoAesGcm.importKey(derived, ["decrypt"]);
    decrypted = await WebCryptoAesGcm.decrypt(
      key,
      fromBase64(envelope.cipher.iv),
      fromBase64(envelope.ct),
      backupAad(envelope.v, envelope.kdf, envelope.cipher.iv)
    );
    const payload = JSON.parse(decoder.decode(decrypted)) as KeyBackupPayload;
    if (typeof payload?.nsec !== "string" || typeof payload?.hex !== "string") {
      throw new KeyBackupError(BACKUP_DECRYPT_FAILURE_MESSAGE);
    }
    return { nsec: payload.nsec, hex: payload.hex, name: payload.name ?? "" };
  } catch (error) {
    if (error instanceof KeyBackupError) throw error;
    throw new KeyBackupError(BACKUP_DECRYPT_FAILURE_MESSAGE);
  } finally {
    zeroize(derived);
    zeroize(decrypted);
  }
}

/** Narrow arbitrary parsed JSON to an envelope this build can open. */
export function isKeyBackupEnvelope(
  value: unknown
): value is KeyBackupEnvelopeV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KeyBackupEnvelopeV1>;
  return (
    candidate.type === KEY_BACKUP_TYPE &&
    candidate.v === KEY_BACKUP_VERSION &&
    typeof candidate.ct === "string" &&
    typeof candidate.cipher?.iv === "string" &&
    (candidate.kdf?.alg === "argon2id" ||
      candidate.kdf?.alg === "pbkdf2-sha256")
  );
}

/** `null` rather than a throw: file contents are routinely not our format. */
export function parseKeyBackupEnvelope(text: string): KeyBackupEnvelopeV1 | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isKeyBackupEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * `ostrilo-backup-<iso-date>.json`.
 *
 * No key name and no part of the key: the old exporter put the user-entered key
 * name in the filename, which meant a directory listing, a sync client's
 * notification, or a shared-screen Downloads shelf disclosed which identity the
 * file belonged to without anyone opening it.
 */
export function backupFileName(now: Date = new Date()): string {
  return `ostrilo-backup-${now.toISOString().slice(0, 10)}.json`;
}

/** The bytes written to disk, pretty-printed so a human can inspect the header. */
export function serializeKeyBackup(envelope: KeyBackupEnvelopeV1): string {
  return JSON.stringify(envelope, null, 2);
}
