import type { KeyRecord, VaultEnvelope } from "@/domain/types";

/** The storage key of the rotation journal. Present only mid-rotation. */
export const ROTATION_JOURNAL_STORAGE = "vaultRotation";

/** One complete, self-consistent vault state: an envelope and its records. */
export interface VaultState {
  envelope: VaultEnvelope;
  records: KeyRecord[];
}

/**
 * The before and after states of a password change, written as ONE storage
 * item before either live item changes.
 *
 * The envelope and the key records are separate items, and neither browser
 * documents a multi-key write as atomic. A single-item write is. So whichever
 * of the two live writes a crash interrupts, the journal still holds both
 * whole states, and the next unlock restores the one the typed password opens.
 */
export interface RotationJournal {
  from: VaultState;
  to: VaultState;
}

function isVaultState(value: unknown): value is VaultState {
  if (!value || typeof value !== "object") return false;
  const s = value as { envelope?: unknown; records?: unknown };
  return (
    !!s.envelope &&
    typeof s.envelope === "object" &&
    "verifier" in s.envelope &&
    "kdf" in s.envelope &&
    Array.isArray(s.records)
  );
}

/** Narrows a stored value to a journal this build can recover from. */
export function isRotationJournal(value: unknown): value is RotationJournal {
  if (!value || typeof value !== "object") return false;
  const j = value as { from?: unknown; to?: unknown };
  return isVaultState(j.from) && isVaultState(j.to);
}
