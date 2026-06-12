// Settings types and defaults based on the requirements document

// Re-export profile types
export * from "./profile/types";

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
  maxActivityEntries?: number; // max items to keep in activity log ring buffer
  relays: string[]; // for profile fetch; no auto connect in BG
  // NOTE: keys are stored in local storage for security, not sync
  selectedKeyId?: string; // ID of the currently selected key
  origins: OriginPolicy[]; // per-origin policies
  mediumAllowKinds: number[]; // shipped default for medium trust
  sessionTTLMinutes: number; // 0 = until lock only
  onboardingCompleted?: boolean; // track if user completed onboarding
  onboardingCompletedAt?: number; // epoch seconds when onboarding was completed
}

export const DEFAULT_RELAY_URLS = ["wss://relay.primal.net"] as const;

// Default settings shipped with the extension
export const DEFAULT_SETTINGS_V1: AppSettingsV1 = {
  __version: "settings.v1",
  theme: "system",
  sidePanel: false,
  autoLockMinutes: 5,
  maxActivityEntries: 50,
  relays: [...DEFAULT_RELAY_URLS],
  origins: [],
  mediumAllowKinds: [6, 16, 7, 10002], // Repost, Generic Repost, Reaction, Relay list
  sessionTTLMinutes: 0,
};

// Comprehensive Nostr event kinds mapping
const ALL_EVENT_KINDS = {
  0: "User Metadata",
  1: "Short Text Note",
  2: "Recommend Relay",
  3: "Follows",
  4: "Encrypted Direct Messages",
  5: "Event Deletion Request",
  6: "Repost",
  7: "Reaction",
  8: "Badge Award",
  9: "Chat Message",
  10: "Group Chat Threaded Reply",
  11: "Thread",
  12: "Group Thread Reply",
  13: "Seal",
  14: "Direct Message",
  15: "File Message",
  16: "Generic Repost",
  17: "Reaction to a website",
  20: "Picture",
  21: "Video Event",
  22: "Short-form Portrait Video Event",
  30: "internal reference",
  31: "external web reference",
  32: "hardcopy reference",
  33: "prompt reference",
  40: "Channel Creation",
  41: "Channel Metadata",
  42: "Channel Message",
  43: "Channel Hide Message",
  44: "Channel Mute User",
  62: "Request to Vanish",
  64: "Chess (PGN)",
  818: "Merge Requests",
  1018: "Poll Response",
  1021: "Bid",
  1022: "Bid confirmation",
  1040: "OpenTimestamps",
  1059: "Gift Wrap",
  1063: "File Metadata",
  1068: "Poll",
  1111: "Comment",
  1311: "Live Chat Message",
  1337: "Code Snippet",
  1617: "Patches",
  1621: "Issues",
  1622: "Git Replies (deprecated)",
  1971: "Problem Tracker",
  1984: "Reporting",
  1985: "Label",
  1986: "Relay reviews",
  1987: "AI Embeddings / Vector lists",
  2003: "Torrent",
  2004: "Torrent Comment",
  2022: "Coinjoin Pool",
  4550: "Community Post Approval",
  7000: "Job Feedback",
  7374: "Reserved Cashu Wallet Tokens",
  7375: "Cashu Wallet Tokens",
  7376: "Cashu Wallet History",
  9041: "Zap Goal",
  9321: "Nutzap",
  9467: "Tidal login",
  9734: "Zap Request",
  9735: "Zap",
  9802: "Highlights",
  10000: "Mute list",
  10001: "Pin list",
  10002: "Relay List Metadata",
  10003: "Bookmark list",
  10004: "Communities list",
  10005: "Public chats list",
  10006: "Blocked relays list",
  10007: "Search relays list",
  10009: "User groups",
  10012: "Favorite relays list",
  10013: "Private event relay list",
  10015: "Interests list",
  10019: "Nutzap Mint Recommendation",
  10020: "Media follows",
  10030: "User emoji list",
  10050: "Relay list to receive DMs",
  10063: "User server list",
  10096: "File storage server list",
  10166: "Relay Monitor Announcement",
  13194: "Wallet Info",
  17375: "Cashu Wallet Event",
  21000: "Lightning Pub RPC",
  22242: "Client Authentication",
  23194: "Wallet Request",
  23195: "Wallet Response",
  24133: "Nostr Connect",
  24242: "Blobs stored on mediaservers",
  27235: "HTTP Auth",
  30000: "Follow sets",
  30001: "Generic lists (deprecated)",
  30002: "Relay sets",
  30003: "Bookmark sets",
  30004: "Curation sets",
  30005: "Video sets",
  30007: "Kind mute sets",
  30008: "Profile Badges",
  30009: "Badge Definition",
  30015: "Interest sets",
  30017: "Create or update a stall",
  30018: "Create or update a product",
  30019: "Marketplace UI/UX",
  30020: "Product sold as an auction",
  30023: "Long-form Content",
  30024: "Draft Long-form Content",
  30030: "Emoji sets",
  30040: "Curated Publication Index",
  30041: "Curated Publication Content",
  30063: "Release artifact sets",
  30078: "Application-specific Data",
  30166: "Relay Discovery",
  30267: "App curation sets",
  30311: "Live Event",
  30315: "User Statuses",
  30388: "Slide Set",
  30402: "Classified Listing",
  30403: "Draft Classified Listing",
  30617: "Repository announcements",
  30618: "Repository state announcements",
  30818: "Wiki article",
  30819: "Redirects",
  31234: "Draft Event",
  31388: "Link Set",
  31890: "Feed",
  31922: "Date-Based Calendar Event",
  31923: "Time-Based Calendar Event",
  31924: "Calendar",
  31925: "Calendar Event RSVP",
  31989: "Handler recommendation",
  31990: "Handler information",
  32267: "Software Application",
  34550: "Community Definition",
  38383: "Peer-to-peer Order events",
  39089: "Starter packs",
  39092: "Media starter packs",
  39701: "Web bookmarks",
} as const;

// Helper function to get human-readable name for any Nostr event kind
// Handles specific kinds, ranged kinds, and unknown kinds
export function getKindName(kind: number): string {
  // First, check the map for a direct match
  if (kind in ALL_EVENT_KINDS) {
    return ALL_EVENT_KINDS[kind as keyof typeof ALL_EVENT_KINDS];
  }

  // If not in the map, check for known ranges
  if (kind >= 1630 && kind <= 1633) {
    return "Status";
  }
  if (kind >= 5000 && kind <= 5999) {
    return "Job Request";
  }
  if (kind >= 6000 && kind <= 6999) {
    return "Job Result";
  }
  if (kind >= 9000 && kind <= 9030) {
    return "Group Control Events";
  }
  if (kind >= 39000 && kind <= 39009) {
    return "Group metadata events";
  }

  // Default fallback for unknown kinds
  return `Kind ${kind}`;
}

// Common Nostr event kinds for UI (curated subset for settings)
export const COMMON_EVENT_KINDS = {
  1: "Short Text Note",
  3: "Follows",
  4: "Encrypted Direct Messages",
  6: "Repost",
  7: "Reaction",
  14: "Direct Message",
  16: "Generic Repost",
  9735: "Zap",
  10002: "Relay List Metadata",
} as const;

// Additional types needed for various domain operations
export interface PolicyContext {
  origin: string;
  kind: number;
  timestamp: number;
  unlocked: boolean;
  mediumAllowKinds: number[];
}

// Policy evaluation types
export interface PolicyInput {
  origin: string;
  kind: number;
  unlocked: boolean;
  mediumAllowKinds: number[];
  policies: OriginPolicy[];
  sessionGrants: Record<string, number>;
}

export interface PolicyOutput {
  mode: Authorisation;
  reason: EvalReason;
}

export type EvalReason =
  | "locked"
  | "explicit_allow"
  | "explicit_deny"
  | "rule"
  | "session"
  | "trust"
  | "fallback"
  | "medium_allow"
  | "session_grant"
  | "default_ask";

// Validation types for domain operations
export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
}

// Event signature verification types
export interface SignatureVerificationResult {
  isValid: boolean;
  pubkey?: string;
  error?: string;
}

// ============================================
// NIP-01 Event Types
// ============================================

/**
 * NIP-01 Unsigned Event - event data before signing
 * Used when a dapp requests signing via window.nostr.signEvent()
 */
export interface UnsignedEvent {
  /** Event kind number (0-65535) */
  kind: number;
  /** Event content (arbitrary string, may be JSON) */
  content: string;
  /** Array of tag arrays (e.g., [["e", "id"], ["p", "pubkey"]]) */
  tags: string[][];
  /** Unix timestamp in seconds */
  created_at: number;
  /** Optional pubkey - signer will fill if missing */
  pubkey?: string;
}

/**
 * NIP-01 Signed Event - complete event with id and signature
 * Returned after signing via window.nostr.signEvent()
 */
export interface SignedEvent {
  /** 32-byte lowercase hex event id (SHA-256 of serialized event) */
  id: string;
  /** 32-byte lowercase hex public key of the event creator */
  pubkey: string;
  /** Unix timestamp in seconds */
  created_at: number;
  /** Event kind number (0-65535) */
  kind: number;
  /** Array of tag arrays */
  tags: string[][];
  /** Event content */
  content: string;
  /** 64-byte lowercase hex Schnorr signature */
  sig: string;
}

// ============================================
// Approval Queue Types
// ============================================

/**
 * Result of an approval decision from the user
 * - "allow": Sign this event
 * - "deny": Reject this event
 */
export type ApprovalDecision = "allow" | "deny";

/**
 * User action choices in the approval prompt UI
 * - "allow": Sign this event and allow future events from this origin+kind
 * - "allow_once": Sign this event only (no policy change)
 * - "deny": Reject this event only (no policy change)
 * - "deny_remember": Reject and block future events from this origin+kind
 */
export type ApprovalAction = "allow" | "allow_once" | "deny" | "deny_remember";

/**
 * A pending approval request in the queue
 * Created when policy evaluation returns "ask" and waits for user decision
 */
export interface PendingRequest {
  /** Unique request identifier (UUID) */
  id: string;
  /** Origin of the requesting dapp (e.g., "https://primal.net") */
  origin: string;
  /** The unsigned event to be signed */
  event: UnsignedEvent;
  /** Optional computed NIP-01 event ID hash used for de-duplication */
  eventIdHash?: string;
  /** Unix timestamp when the request was created (seconds) */
  createdAt: number;
  /** Unix timestamp when the request will auto-deny (seconds) */
  timeoutAt: number;
}

// ============================================
// Activity Log Types
// ============================================

/**
 * Activity log entry tracking signing operations
 * Stored in local storage for audit trail
 */
export interface ActivityLogEntry {
  /** Unique entry ID (UUID) */
  id: string;
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Origin of the dApp (e.g., "https://primal.net") */
  origin: string;
  /** Nostr event kind number */
  kind: number;
  /** User decision: "allow" | "deny" */
  decision: "allow" | "deny";
  /** Content preview (first 100 chars, sanitized) */
  contentPreview?: string;
  /** Key ID used for signing (if allowed) */
  keyId?: string;
}

/**
 * Activity log storage schema
 * Stored in browser.storage.local under key "activityLog"
 */
export interface ActivityLogStorage {
  __version: "activityLog.v1";
  maxEntries: number;
  entries: ActivityLogEntry[];
}

/**
 * Filters for querying activity log entries
 */
export interface ActivityFilters {
  origin?: string;
  kind?: number;
  limit?: number;
  offset?: number;
}
