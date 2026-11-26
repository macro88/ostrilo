import type { StorageSuite } from "@/application/ports/storage";
import type {
  CryptoAead,
  CryptoHkdf,
  SecretBytes,
} from "@/application/ports/crypto";
import {
  AES_GCM_IV_LENGTH,
  BIOMETRIC_CREDENTIAL_ID_MAX_LENGTH,
  BIOMETRIC_HKDF_INFO_VERSION,
  BIOMETRIC_PRF_LENGTH,
  BIOMETRIC_WRAPPER_VERSION,
  PASSWORD_REHEARSAL_DAYS,
  type BiometricFactor,
  type KeyRecord,
  type VaultBiometricRecord,
  type VaultEnvelope,
} from "@/domain/types";
import { bioWrapAad } from "@/domain/crypto/aad";
import { zeroize } from "@/domain/utils/memory";
import {
  ROTATION_JOURNAL_STORAGE,
  isRotationJournal,
} from "./vault-rotation-journal";

/** The storage key of the biometric wrapping. Absent when nothing is enrolled. */
export const VAULT_BIOMETRIC_STORAGE = "vaultBiometric";

/**
 * Set in session storage by the first password unlock of a browser session.
 * Session storage is emptied by a browser restart and by an extension update,
 * which is exactly when the password is asked for again.
 */
const PASSWORD_UNLOCK_MARKER_STORAGE = "passwordUnlockedThisSession";

const KEK_LENGTH = 32;
const GCM_TAG_LENGTH = 16;
const MAX_TRANSPORTS = 8;
const MAX_TRANSPORT_LENGTH = 32;
const REHEARSAL_WINDOW_MS = PASSWORD_REHEARSAL_DAYS * 24 * 60 * 60 * 1000;

/** Why the password, and not the factor, is what will open the vault this time. */
export type PasswordNeededReason =
  | "rotation_pending"
  | "legacy_records"
  | "restart_pending"
  | "rehearsal_due";

/**
 * Refused before anything secret was tested: the vault needs the password
 * once. Never counted against the unlock throttle.
 */
export class BiometricPasswordNeededError extends Error {
  constructor(readonly reason: PasswordNeededReason) {
    super("biometric_password_needed");
    this.name = "BiometricPasswordNeededError";
  }
}

/**
 * The supplied output did not open the vault, or there is no usable factor.
 * Deliberately one error for every such case: a caller must not be able to
 * learn which step failed.
 */
export class BiometricRejectedError extends Error {
  /**
   * `evaluated` is true only when a supplied output was actually tried against
   * the wrapping or the verifier. That is a guess, and the unlock throttle
   * charges for it; a refusal that tested nothing is not charged.
   */
  constructor(readonly evaluated = false) {
    super("biometric_rejected");
    this.name = "BiometricRejectedError";
  }
}

export interface BiometricStatus {
  enrolled: boolean;
  enrolledAt?: number;
  /** Reported only to an unlocked session. */
  synced?: boolean;
  /** Present when an unlock with the factor would be refused unevaluated. */
  passwordNeeded?: PasswordNeededReason;
}

export interface BiometricUnlockRequest {
  credentialId: number[];
  prfSalt: number[];
  transports: string[];
}

function isByteArray(value: unknown, min: number, max: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
  );
}

function isBiometricFactor(value: unknown): value is BiometricFactor {
  if (!value || typeof value !== "object") return false;
  const f = value as Record<string, unknown>;
  return (
    isByteArray(f.credentialId, 1, BIOMETRIC_CREDENTIAL_ID_MAX_LENGTH) &&
    isByteArray(f.prfSalt, BIOMETRIC_PRF_LENGTH, BIOMETRIC_PRF_LENGTH) &&
    typeof f.backupEligible === "boolean" &&
    Array.isArray(f.transports) &&
    f.transports.length <= MAX_TRANSPORTS &&
    f.transports.every(
      (t) => typeof t === "string" && t.length <= MAX_TRANSPORT_LENGTH
    )
  );
}

/** Narrows a stored value to a wrapping this build can open. */
function isUsableRecord(value: unknown): value is VaultBiometricRecord {
  if (!isBiometricFactor(value)) return false;
  const r = value as Partial<VaultBiometricRecord>;
  return (
    r.v === BIOMETRIC_WRAPPER_VERSION &&
    r.hkdfInfoVersion === BIOMETRIC_HKDF_INFO_VERSION &&
    isByteArray(r.wrapped?.iv, AES_GCM_IV_LENGTH, AES_GCM_IV_LENGTH) &&
    isByteArray(
      r.wrapped?.ct,
      KEK_LENGTH + GCM_TAG_LENGTH,
      KEK_LENGTH + GCM_TAG_LENGTH
    ) &&
    typeof r.createdAt === "number" &&
    typeof r.lastPasswordUnlockAt === "number"
  );
}

/** Compares without stopping at the first difference. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * The only reader and writer of the biometric wrapping.
 *
 * It holds no key between calls. The vault service owns the KEK and the
 * decision to unlock; this service turns an authenticator's PRF output into a
 * candidate KEK and nothing more. Whatever it returns is still unproven until
 * the vault has opened the envelope verifier with it.
 *
 * Everything here is statically imported: it runs in the MV3 background
 * worker, where `import()` is disallowed.
 */
export class BiometricFactorService {
  constructor(
    private storage: StorageSuite,
    private aead: CryptoAead,
    private hkdf: CryptoHkdf,
    private now: () => number = Date.now
  ) {}

  /** The stored value, whatever it is. `undefined` means nothing is enrolled. */
  private async readStored(): Promise<unknown> {
    return await this.storage.local.get<unknown>(VAULT_BIOMETRIC_STORAGE);
  }

  private async readUsable(): Promise<VaultBiometricRecord | undefined> {
    const stored = await this.readStored();
    return isUsableRecord(stored) ? stored : undefined;
  }

  /** The versioned purpose string, a separator, then the credential id. */
  private hkdfInfo(credentialId: Uint8Array): Uint8Array<ArrayBuffer> {
    const purpose = new TextEncoder().encode(
      `ostrilo/biometric-kek-wrap/v${BIOMETRIC_HKDF_INFO_VERSION}`
    );
    const info = new Uint8Array(purpose.byteLength + 1 + credentialId.byteLength);
    info.set(purpose, 0);
    info.set(credentialId, purpose.byteLength + 1);
    return info;
  }

  private aadFor(
    envelope: VaultEnvelope,
    factor: BiometricFactor
  ): Uint8Array<ArrayBuffer> {
    return bioWrapAad(envelope.v, envelope.kdf, {
      v: BIOMETRIC_WRAPPER_VERSION,
      credentialId: Uint8Array.from(factor.credentialId),
      prfSalt: Uint8Array.from(factor.prfSalt),
      hkdfInfoVersion: BIOMETRIC_HKDF_INFO_VERSION,
      backupEligible: factor.backupEligible,
    });
  }

  /**
   * Why the password is needed before the factor can be used, if it is.
   *
   * A rotation journal or an unversioned record can only be resolved with the
   * password, so opening the vault without one would run on whichever
   * half-written state is on disk. The other two reasons are not cryptographic
   * controls: they keep the password remembered and ask for it after a restart.
   */
  async passwordNeededReason(
    records: KeyRecord[],
    record: Pick<VaultBiometricRecord, "lastPasswordUnlockAt">
  ): Promise<PasswordNeededReason | undefined> {
    // The same test recovery applies: a value it would not act on is not a
    // rotation in progress, and must not hold the factor back for ever.
    const journal = await this.storage.local.get<unknown>(ROTATION_JOURNAL_STORAGE);
    if (isRotationJournal(journal)) return "rotation_pending";
    if (records.some((rec) => rec.v === undefined)) return "legacy_records";

    const marker = await this.storage.session.get<unknown>(
      PASSWORD_UNLOCK_MARKER_STORAGE
    );
    if (marker !== true) return "restart_pending";

    const sincePassword = this.now() - record.lastPasswordUnlockAt;
    if (!(sincePassword >= 0 && sincePassword <= REHEARSAL_WINDOW_MS)) {
      return "rehearsal_due";
    }
    return undefined;
  }

  /**
   * What a surface may know about the factor. Never the credential id, and
   * whether the credential syncs only once the vault is unlocked.
   */
  async status(records: KeyRecord[], unlocked: boolean): Promise<BiometricStatus> {
    const record = await this.readUsable();
    if (!record) return { enrolled: false };
    const passwordNeeded = await this.passwordNeededReason(records, record);
    return {
      enrolled: true,
      enrolledAt: record.createdAt,
      ...(unlocked ? { synced: record.backupEligible } : {}),
      ...(passwordNeeded ? { passwordNeeded } : {}),
    };
  }

  /** What the ceremony document needs in order to ask the authenticator. */
  async unlockRequest(records: KeyRecord[]): Promise<BiometricUnlockRequest> {
    const record = await this.readUsable();
    if (!record) throw new BiometricRejectedError();
    const reason = await this.passwordNeededReason(records, record);
    if (reason) throw new BiometricPasswordNeededError(reason);
    return {
      credentialId: record.credentialId,
      prfSalt: record.prfSalt,
      transports: record.transports,
    };
  }

  /**
   * Turns a PRF output into a candidate KEK. Callers MUST zeroize the result,
   * and MUST prove it against the envelope verifier before using it.
   *
   * The caller owns `prfOutput` and zeroizes it.
   */
  async unwrapKek(
    envelope: VaultEnvelope,
    records: KeyRecord[],
    credentialId: Uint8Array,
    prfOutput: SecretBytes
  ): Promise<SecretBytes> {
    const record = await this.readUsable();
    if (!record) throw new BiometricRejectedError();
    const reason = await this.passwordNeededReason(records, record);
    if (reason) throw new BiometricPasswordNeededError(reason);

    const enrolledId = Uint8Array.from(record.credentialId);
    if (
      prfOutput.byteLength !== BIOMETRIC_PRF_LENGTH ||
      !constantTimeEqual(enrolledId, credentialId)
    ) {
      throw new BiometricRejectedError();
    }

    let kek: SecretBytes;
    try {
      const key = await this.hkdf.deriveAeadKey(
        prfOutput,
        this.hkdfInfo(enrolledId),
        ["decrypt"]
      );
      kek = await this.aead.decrypt(
        key,
        Uint8Array.from(record.wrapped.iv) as SecretBytes,
        Uint8Array.from(record.wrapped.ct) as SecretBytes,
        this.aadFor(envelope, record)
      );
    } catch {
      throw new BiometricRejectedError(true);
    }
    if (kek.byteLength !== KEK_LENGTH) {
      zeroize(kek);
      throw new BiometricRejectedError(true);
    }
    return kek;
  }

  /**
   * Wraps the live KEK under a key derived from `prfOutput` and stores it,
   * replacing any existing factor in the one write.
   *
   * The wrapping is opened again and compared with the KEK before anything is
   * written, so a factor that could not unlock is never enrolled, and a failed
   * enrolment leaves an existing factor exactly as it was.
   *
   * The caller owns `kek` and `prfOutput` and zeroizes both.
   */
  async enroll(
    kek: SecretBytes,
    envelope: VaultEnvelope,
    factor: BiometricFactor,
    prfOutput: SecretBytes
  ): Promise<void> {
    if (
      !isBiometricFactor(factor) ||
      prfOutput.byteLength !== BIOMETRIC_PRF_LENGTH ||
      kek.byteLength !== KEK_LENGTH
    ) {
      throw new BiometricRejectedError();
    }

    const credentialId = Uint8Array.from(factor.credentialId);
    const info = this.hkdfInfo(credentialId);
    const aad = this.aadFor(envelope, factor);
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));

    const [sealKey, openKey] = await Promise.all([
      this.hkdf.deriveAeadKey(prfOutput, info, ["encrypt"]),
      this.hkdf.deriveAeadKey(prfOutput, info, ["decrypt"]),
    ]);
    const ct = await this.aead.encrypt(sealKey, iv, kek, aad);
    const roundTripped = await this.aead.decrypt(openKey, iv, ct, aad);
    try {
      if (!constantTimeEqual(roundTripped, kek)) {
        throw new BiometricRejectedError();
      }
    } finally {
      zeroize(roundTripped);
    }

    const now = this.now();
    await this.storage.local.set<VaultBiometricRecord>(VAULT_BIOMETRIC_STORAGE, {
      v: BIOMETRIC_WRAPPER_VERSION,
      hkdfInfoVersion: BIOMETRIC_HKDF_INFO_VERSION,
      credentialId: [...factor.credentialId],
      prfSalt: [...factor.prfSalt],
      transports: [...factor.transports],
      backupEligible: factor.backupEligible,
      wrapped: { ct: Array.from(ct), iv: Array.from(iv) },
      createdAt: now,
      // Enrolment is itself a password proof.
      lastPasswordUnlockAt: now,
    });
  }

  /** Removes the wrapping. Needs no credential: it can only reduce access. */
  async forget(): Promise<void> {
    await this.storage.local.remove(VAULT_BIOMETRIC_STORAGE);
  }

  /**
   * Records a password unlock: the session marker always, and the rehearsal
   * timestamp only when there is a factor to rehearse for.
   */
  async notePasswordUnlock(): Promise<void> {
    await this.storage.session.set<boolean>(PASSWORD_UNLOCK_MARKER_STORAGE, true);
    const record = await this.readUsable();
    if (!record) return;
    await this.storage.local.set<VaultBiometricRecord>(VAULT_BIOMETRIC_STORAGE, {
      ...record,
      lastPasswordUnlockAt: this.now(),
    });
  }

  async noteFactorUnlock(): Promise<void> {
    const record = await this.readUsable();
    if (!record) return;
    await this.storage.local.set<VaultBiometricRecord>(VAULT_BIOMETRIC_STORAGE, {
      ...record,
      lastUnlockAt: this.now(),
    });
  }
}
