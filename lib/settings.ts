// Settings types and defaults based on the requirements document

// Enums
export type Theme = "dark" | "light" | "system";
export type Authorisation = "allow" | "deny" | "ask";
export type TrustLevel = "low" | "medium" | "high";

// Secret key record (encrypted at rest)
export interface KeyRecord {
  id: string; // uuid (stable internal id)
  label?: string; // user-visible label
  pubkey: string; // hex
  ct: number[]; // AES-GCM ciphertext (private key) as byte array for storage
  iv: number[]; // 12-byte IV
  salt: number[]; // KDF salt
  createdAt: number; // epoch seconds
  lastUsedAt?: number;
  isSelected?: boolean; // active key
}

// Per-kind rule
export type NostrEventKindAuthorisation = Record<number, Authorisation>;

// Per-origin policy
export interface OriginPolicy {
  origin: string; // e.g., "https://primal.net"
  name?: string;
  trustLevel: TrustLevel;
  rules: NostrEventKindAuthorisation; // explicit overrides
  sessionGrantAll?: boolean; // ephemeral; cleared on lock/TTL
  updatedAt: number;
}

// Root settings
export interface AppSettingsV1 {
  __version: "settings.v1";
  theme: Theme;
  sidePanel: boolean;
  autoLockMinutes: number;
  relays: string[]; // for profile fetch; no auto connect in BG
  // NOTE: keys are stored in local storage for security, not sync
  selectedKeyId?: string; // ID of the currently selected key
  origins: OriginPolicy[]; // per-origin policies
  mediumAllowKinds: number[]; // shipped default for medium trust
  sessionTTLMinutes: number; // 0 = until lock only
  onboardingCompleted?: boolean; // track if user completed onboarding
  onboardingCompletedAt?: number; // epoch seconds when onboarding was completed
}

// Default settings shipped with the extension
export const DEFAULT_SETTINGS_V1: AppSettingsV1 = {
  __version: "settings.v1",
  theme: "system",
  sidePanel: false,
  autoLockMinutes: 5,
  relays: ["wss://relay.damus.io", "wss://nostr.wine"],
  origins: [],
  mediumAllowKinds: [6, 16, 7, 10002], // Repost, Generic Repost, Reaction, Relay list
  sessionTTLMinutes: 0,
};

// Trust level descriptions for UI
export const TRUST_LEVEL_DESCRIPTIONS: Record<TrustLevel, string> = {
  low: "Ask for all events - Maximum security",
  medium: "Allow common interactions, ask for posts and sensitive actions",
  high: "Allow all events - Maximum convenience",
};

// Common Nostr event kinds for UI
export const COMMON_EVENT_KINDS = {
  1: "Text Note",
  3: "Contacts",
  4: "Encrypted Direct Message",
  6: "Repost",
  7: "Reaction",
  14: "Direct Message (NIP-14)",
  16: "Generic Repost",
  9735: "Zap Request",
  10002: "Relay List",
} as const;

// Helper function to get medium trust default behavior for a kind
export function isMediumTrustAllowed(
  kind: number,
  settings: AppSettingsV1
): boolean {
  return settings.mediumAllowKinds.includes(kind);
}

// Helper function to generate a new key record (without crypto implementation for now)
export function createKeyRecord(
  pubkey: string,
  label?: string
): Omit<KeyRecord, "ct" | "iv" | "salt"> {
  return {
    id: crypto.randomUUID(),
    label,
    pubkey,
    createdAt: Math.floor(Date.now() / 1000),
    lastUsedAt: undefined,
    isSelected: false,
  };
}
