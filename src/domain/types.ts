// Domain types (authoritative, mirrored from docs)

export type Theme = "dark" | "light" | "system";
export type Authorisation = "allow" | "deny" | "ask";
export type TrustLevel = "low" | "medium" | "high";

export interface KeyRecord {
  id: string;
  label?: string;
  pubkey: string; // hex
  ct: number[];
  iv: number[];
  salt: number[];
  createdAt: number;
  lastUsedAt?: number;
  isSelected?: boolean;
}

export type NostrEventKindAuthorisation = Record<number, Authorisation>;

export interface OriginPolicy {
  origin: string;
  name?: string;
  trustLevel: TrustLevel;
  rules: NostrEventKindAuthorisation;
  sessionGrantAll?: boolean;
  updatedAt: number;
}

export interface AppSettingsV1 {
  __version: "settings.v1";
  theme: Theme;
  sidePanel: boolean;
  autoLockMinutes: number;
  relays: string[];
  origins: OriginPolicy[];
  mediumAllowKinds: number[];
  sessionTTLMinutes: number;
  selectedKeyId?: string;
}

export type EvalReason = "locked" | "session" | "rule" | "trust" | "fallback";

export interface PolicyContext {
  unlocked: boolean;
  mediumAllowKinds: number[];
}

export interface PolicyInput {
  origin: string;
  kind: number;
}

export interface PolicyOutput {
  mode: Authorisation;
  reason: EvalReason;
}
