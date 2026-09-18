import { DEFAULT_SESSION_TTL_MINUTES } from "@/domain/policy/session-grants";
// Settings types and defaults based on the requirements document
import { DEFAULT_MEDIUM_ALLOW_KINDS } from "./policy/trust-definitions";

// Re-export profile types
export * from "./profile/types";

// Enums
export type Theme = "dark" | "light" | "system";
export type Authorisation = "allow" | "deny" | "ask";
export type TrustLevel = "low" | "medium" | "high";

// ============================================
// Vault encryption schema
// ============================================

/**
 * Current vault format version.
 *
 * A record without `v` is a legacy record written before the vault carried its
 * own parameters: PBKDF2-HMAC-SHA256, 100,000 iterations, no AAD, one
 * derivation per key. Those are read-only and lazily migrated on unlock.
 */
export const VAULT_VERSION = 1 as const;

/** Versions this build can read. Reject anything else rather than guessing. */
export const SUPPORTED_VAULT_VERSIONS: readonly number[] = [VAULT_VERSION];

/**
 * Recorded KDF parameters.
 *
 * The point of storing these is that the work factor can be raised later
 * without guessing how an existing record was encrypted. Never infer these
 * from code constants when reading a record.
 */
export type KdfParams =
  | {
      alg: "argon2id";
      /** Memory cost in KiB. */
      m: number;
      /** Time cost (passes). */
      t: number;
      /** Parallelism. */
      p: number;
      salt: number[];
    }
  | {
      alg: "pbkdf2-sha256";
      /** Iteration count. */
      c: number;
      salt: number[];
    };

/**
 * Parameter floors. A record whose recorded cost is below these is refused
 * rather than silently accepted, so an attacker who can write to storage
 * cannot roll the work factor back to something cheap.
 *
 * Argon2id values are the OWASP-listed configuration; see
 * openspec/changes/harden-vault-key-derivation/kdf-measurements.md for the
 * measurements behind the choice.
 */
export const KDF_FLOORS = {
  argon2id: { m: 19456, t: 2, p: 1 },
  "pbkdf2-sha256": { c: 600_000 },
} as const;

/** Parameters used for newly written material. */
export const KDF_DEFAULTS: KdfParams = {
  alg: "argon2id",
  m: 19456,
  t: 2,
  p: 1,
  salt: [],
};

export const KDF_SALT_LENGTH = 16;
export const AES_GCM_IV_LENGTH = 12;
export const DEK_LENGTH = 32;

/**
 * Vault-level envelope.
 *
 * One password-derived key-encryption key (KEK) per vault wraps a per-key
 * data-encryption key (DEK). That means unlock costs exactly one KDF run
 * regardless of how many keys the vault holds - the property that makes a
 * memory-hard KDF affordable at all. The previous design derived once per
 * record, so a five-key vault paid five times the cost.
 *
 * `verifier` is a known plaintext encrypted under the KEK. Decrypting it
 * proves the password before any per-record work is attempted, and gives a
 * clean "wrong password" signal that a damaged record cannot masquerade as.
 */
export interface VaultEnvelope {
  v: number;
  kdf: KdfParams;
  verifier: { ct: number[]; iv: number[] };
  createdAt: number;
  updatedAt: number;
}

// Secret key record (encrypted at rest)
export interface KeyRecord {
  id: string; // uuid (stable internal id)
  label?: string; // user-visible label
  pubkey: string; // hex
  ct: number[]; // AES-GCM ciphertext (private key) as byte array for storage
  iv: number[]; // 12-byte IV
  /**
   * Legacy KDF salt. Present only on unversioned records, where the key was
   * encrypted directly under a per-record password-derived key. Removed once
   * the record has been migrated to the envelope.
   */
  salt?: number[];
  /**
   * Format version. Absent means a legacy record; see VAULT_VERSION.
   */
  v?: number;
  /**
   * The record's DEK, wrapped under the vault KEK. Present on v:1 records.
   */
  wrappedDek?: { ct: number[]; iv: number[] };
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
  /**
   * Whether this origin may read the user's public key via
   * `nostr.getPublicKey`.
   *
   * ABSENT MEANS NO DECISION HAS BEEN RECORDED, which is the prompting state -
   * NOT consent. Nothing grants this by migration: a stored policy record is
   * written whenever a signing decision is made, including a refusal, and
   * `low` is the level assigned by default when a record is created as a side
   * effect. So an existing record is evidence of a signing decision and of
   * nothing else. Every origin prompts once on next use.
   */
  identityDisclosure?: Authorisation;
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
  /** Session-grant lifetime. Bounded by DEFAULT/MAX_SESSION_TTL_MINUTES. */
  sessionTTLMinutes: number;
  // aislop-ignore-next-line ai-slop/meta-comment -- not build-plan narration: this records why the upload endpoint is undefined by default - an undefined endpoint means no outbound request. Deleting it invites a hardcoded third-party endpoint back.
  /**
   * Where profile image uploads are sent. Undefined by default, which is
   * the point: the field used to be a hardcoded `nostr.build` endpoint, so
   * editing a profile picture uploaded it to a third party the user had
   * never been asked about. No destination means no outbound request.
   */
  uploadEndpoint?: string;
  onboardingCompleted?: boolean; // track if user completed onboarding
  onboardingCompletedAt?: number; // epoch seconds when onboarding was completed
}

/**
 * Auto-lock bounds, defined once and shared.
 *
 * There is no "never" any more. `autoLockMinutes: 0` used to mean "do not
 * lock", which combined with a lock state that already failed open to leave a
 * vault unlocked indefinitely. A stored 0 is now read as the shipped default.
 *
 * The ceiling is an hour. The old schema allowed 1440 (a day), which is longer
 * than the browser session it is meant to bound.
 */
export const AUTO_LOCK_BOUNDS = { min: 1, max: 60, default: 5 } as const;

/**
 * Coerces any stored or supplied auto-lock value into the enforced range.
 *
 * Called on every read rather than only on write, because settings live in
 * `storage.sync`: a value written by an older version, or by another profile
 * on the same account, arrives without ever passing through the patch schema.
 */
export function normalizeAutoLockMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return AUTO_LOCK_BOUNDS.default;
  }
  const whole = Math.floor(value);
  if (whole < AUTO_LOCK_BOUNDS.min) return AUTO_LOCK_BOUNDS.default;
  return Math.min(whole, AUTO_LOCK_BOUNDS.max);
}

export const DEFAULT_RELAY_URLS = ["wss://relay.primal.net"] as const;

// Default settings shipped with the extension
export const DEFAULT_SETTINGS_V1: AppSettingsV1 = {
  __version: "settings.v1",
  theme: "system",
  sidePanel: false,
  autoLockMinutes: AUTO_LOCK_BOUNDS.default,
  maxActivityEntries: 50,
  relays: [...DEFAULT_RELAY_URLS],
  origins: [],
  mediumAllowKinds: [...DEFAULT_MEDIUM_ALLOW_KINDS],
  sessionTTLMinutes: DEFAULT_SESSION_TTL_MINUTES,
};

// Comprehensive Nostr event kinds mapping
const ALL_EVENT_KINDS = {
  0: "Profile Metadata",
  1: "Short Text Note",
  2: "Recommend Relay",
  3: "Contacts",
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
  9735: "Zap Receipt",
  9802: "Highlights",
  10000: "Mute List",
  10001: "Pin List",
  10002: "Relay List",
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
  30078: "Application Data",
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

/**
 * The title for one activity row.
 *
 * An identity disclosure signs nothing and has no kind, so it must not be
 * rendered through `getKindName` - that would print "Kind undefined" and the
 * user would have no way to tell a disclosure from a signature. The
 * distinction has to reach the UI, not only the stored record.
 */
export function describeActivityEntry(
  entry: Pick<ActivityLogEntry, "operation" | "kind">
): string {
  if (entry.operation === "identity_disclosure") {
    return "Identity disclosure";
  }
  return entry.kind === undefined ? "Unknown request" : getKindName(entry.kind);
}

/**
 * One activity row phrased as a completed action, for the compact home list.
 *
 * "Signed identity disclosure" would be wrong in both halves, so the verb and
 * the object are chosen together rather than concatenated by the caller.
 */
export function describeActivityAction(
  entry: Pick<ActivityLogEntry, "operation" | "kind" | "decision">
): string {
  if (entry.operation === "identity_disclosure") {
    return entry.decision === "allow"
      ? "Shared your public key"
      : "Refused to share your public key";
  }
  const kind = describeActivityEntry(entry).toLowerCase();
  return entry.decision === "allow" ? `Signed ${kind}` : `Denied ${kind}`;
}

// Common Nostr event kinds for UI (curated subset for settings)
export const COMMON_EVENT_KINDS = {
  0: "Profile Metadata",
  1: "Short Text Note",
  3: "Contacts",
  4: "Encrypted Direct Messages",
  6: "Repost",
  7: "Reaction",
  14: "Direct Message",
  16: "Generic Repost",
  9734: "Zap Request",
  9735: "Zap Receipt",
  10000: "Mute List",
  10001: "Pin List",
  10002: "Relay List",
  30078: "Application Data",
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
  | "protected"
  | "fallback"
  | "medium_allow"
  | "session_grant"
  /**
   * The origin has an explicit remembered refusal to disclose the public key.
   *
   * A signature returns the public key inside the signed event, so a standing
   * allow would hand over the identity the user just refused - while Settings
   * displayed the refusal. Downgraded to `ask`, never to `deny`: refusing to
   * hand over an identity for the asking is not the same as saying the site may
   * never sign anything.
   */
  | "identity_disclosure_denied"
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
  /**
   * What the origin is asking for.
   *
   * Required, and set explicitly at every construction site, so a consumer
   * cannot reach `event` without first having decided what kind of request it
   * is holding. The spelling matches `ActivityLogEntry.operation` exactly: an
   * earlier design used `get_public_key` on one side and
   * `identity_disclosure` on the other, which would have put two different
   * strings on either side of the audit boundary.
   */
  operation: "sign_event" | "identity_disclosure";
  /**
   * The unsigned event to be signed.
   *
   * ABSENT for an identity disclosure, which signs nothing. Narrow on
   * `operation` before reading this - `approval.resolve` used to dereference
   * `request.event.kind` unconditionally, which throws for an eventless
   * request.
   */
  event?: UnsignedEvent;
  /** Optional computed NIP-01 event ID hash used for de-duplication */
  eventIdHash?: string;
  /** Unix timestamp when the request was created (seconds) */
  createdAt: number;
  /** Unix timestamp when the request will auto-deny (seconds) */
  timeoutAt: number;
  /**
   * The public key this request will be signed with, in hex, captured when
   * the request was enqueued.
   *
   * The approval dialog used to render "Signing as" from whichever key the
   * UI had selected when it loaded. Switching the active key while a prompt
   * was open therefore changed the displayed identity without changing the
   * one that would sign - the dialog told the user something false about the
   * thing they were about to authorize.
   */
  signingPubkey?: string;
  /**
   * The page-side correlation id, when the request came from a web page.
   *
   * Lets the content script cancel a request the page has abandoned. Only
   * ever used to DENY: see cancelByClientRequestId.
   */
  clientRequestId?: string;
}

/**
 * A request that has an event to sign.
 *
 * Every view that reads `request.event` should take this, not `PendingRequest`.
 * The point is that the narrowing happens ONCE, where the request is routed,
 * rather than as an optional chain at each of the ~20 places the event is read
 * - an optional chain there would render a blank field instead of failing, and
 * a blank field in an approval prompt is worse than a crash.
 */
export type SigningRequest = PendingRequest & {
  operation: "sign_event";
  event: UnsignedEvent;
};

/** A request to disclose the user's public key. It signs nothing. */
export type DisclosureRequest = PendingRequest & {
  operation: "identity_disclosure";
  event?: undefined;
};

export function isSigningRequest(
  request: PendingRequest
): request is SigningRequest {
  return request.operation === "sign_event" && request.event !== undefined;
}

export function isDisclosureRequest(
  request: PendingRequest
): request is DisclosureRequest {
  return request.operation === "identity_disclosure";
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
  /**
   * Nostr event kind number.
   *
   * Absent for an identity disclosure, which signs nothing and therefore has
   * no kind. A kind filter excludes those entries, which is correct.
   */
  kind?: number;
  /**
   * What the origin asked for.
   *
   * Absent means `"sign_event"`, so history written before identity disclosure
   * was logged stays readable without a migration.
   *
   * The spelling is `"identity_disclosure"` on BOTH this type and
   * `PendingRequest`. An earlier design used `"get_public_key"` on one side and
   * `"identity_disclosure"` on the other, which would have put two different
   * strings on either side of the audit boundary.
   */
  operation?: "sign_event" | "identity_disclosure";
  /**
   * Why the request ended as it did.
   *
   * A closed union, never free text: an activity log is read by people and
   * must not become a channel for whatever a handler happened to have in a
   * string. Absent when the decision speaks for itself.
   */
  reason?: "user" | "policy" | "remembered" | "timeout" | "rate_limited";
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
