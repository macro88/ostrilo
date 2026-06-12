# Ostrilo Settings & Permission System — Requirements (v1)

**Scope:** Stored settings, per-origin permissions, trust levels, and session grants for signing Nostr events in the Ostrilo browser extension.
**Schema version:** `settings.v1`

---

## Goals
- Fine-grained, per-origin control of signing behavior by event kind.
- Deterministic evaluation order with a clear override hierarchy.
- Ephemeral “Allow ALL” per-origin during an unlock session.
- Trust levels (`low|medium|high`) that map to sensible defaults.
- Multi-key support with explicit active key selection.

---

## Decision model

Given `(origin, kind, state)`:

1. If **locked** → return `error:"locked"`.
2. If **sessionGrantAll=TRUE** for `origin` and unlocked → **allow**.
3. If **explicit per-kind rule** exists for `(origin, kind)` → apply (`allow|deny|ask`).
4. Else apply **trust level default** for `origin`.
5. Else fallback → **ask**.

Rules:
- **deny overrides everything** (even session grant).
- All decisions are logged with `(origin, kind, mode, reason)` where reason ∈ `{locked, session, rule, trust, fallback}`.

---

## Trust level defaults

Shipped presets (user can edit in Settings):

| Trust | Kinds allowed silently | Kinds asked/prompted |
|---|---|---|
| low | — | all kinds |
| medium | 6 Repost, 16 Generic Repost, 7 Reaction, 10002 Relay list | 1 Note, 3 Contacts, 4/14 DMs, 9735 Zap request, others |
| high | all kinds | — |

> Rationale: medium enables quick interactions but prompts for posting, social graph changes, DMs, and payments.

---

## Functional requirements (delta/added)

| ID | Title | Priority | Description | Acceptance Criteria |
|---|---|---|---|---|
| NS-F-006a | Per-origin per-kind policy | Must | User sets `allow/deny/ask` by event kind for each origin (e.g., `https://primal.net`). | Editing UI persists; BG enforces; behavior matches evaluation order. |
| NS-F-006b | Origin trust level | Must | User sets `trustLevel ∈ {low, medium, high}` per origin to supply defaults when no explicit rule exists. | Defaults applied; visible in “effective policy” preview. |
| NS-F-006c | Session Allow-ALL | Must | Ephemeral “allow all kinds” for an origin until lock or revoke. | Survives popup reload; cleared on lock, suspend, or TTL; chip shows active state. |
| NS-F-006d | Explicit deny precedence | Must | `deny` blocks signing even if trust=high or session grant active. | Tests prove deny wins. |
| NS-F-006e | Policy preview | Should | Settings page shows computed decision for popular kinds before saving. | Preview updates live and matches runtime. |
| NS-F-007 | Multiple keys | Must | Store many keys, select active key in header, preserve per-origin policies regardless of active key. | Switching active key does not modify policies. |

---

## Non-functional

| ID | Title | Priority | Description | Acceptance Criteria |
|---|---|---|---|
| NS-N-011 | Atomic writes | Must | Settings writes are atomic; versioned; crash-safe. | No corruption; migrations pass. |
| NS-N-012 | Session isolation | Must | Session grants are memory-only and cleared on lock or TTL. | Grant disappears after lock or TTL expiry. |
| NS-N-013 | Privacy | Must | Policy evaluation is offline. | No network calls during decision. |

---

## TypeScript schema (authoritative)

```ts
// enums
export type Theme = "dark" | "light" | "system";
export type Authorisation = "allow" | "deny" | "ask";
export type TrustLevel = "low" | "medium" | "high";

// secret key record (encrypted at rest)
export interface KeyRecord {
  id: string;            // uuid (stable internal id)
  label?: string;        // user-visible label
  pubkey: string;        // hex
  ct: number[];          // AES-GCM ciphertext (private key) as byte array for storage
  iv: number[];          // 12-byte IV
  salt: number[];        // KDF salt
  createdAt: number;     // epoch seconds
  lastUsedAt?: number;
  isSelected?: boolean;  // active key
}

// per-kind rule
export type NostrEventKindAuthorisation = Record<number, Authorisation>;

// per-origin policy
export interface OriginPolicy {
  origin: string;        // e.g., "https://primal.net"
  name?: string;
  trustLevel: TrustLevel;
  rules: NostrEventKindAuthorisation;  // explicit overrides
  sessionGrantAll?: boolean;           // ephemeral; cleared on lock/TTL
  updatedAt: number;
}

// root settings
export interface AppSettingsV1 {
  __version: "settings.v1";
  theme: Theme;
  sidePanel: boolean;
  autoLockMinutes: number;
  relays: string[];           // for profile fetch; no auto connect in BG
  keys: KeyRecord[];          // multi-key
  origins: OriginPolicy[];    // per-origin policies
  mediumAllowKinds: number[]; // shipped default for medium trust
  sessionTTLMinutes: number;  // 0 = until lock only
  selectedKeyId?: string;     // convenience mirror of active key
}
```

### Storage layout (chrome.storage.local)

```jsonc
{
  "settings": { /* AppSettingsV1 JSON */ },
  // non-secret caches
  "profileCache": { "pubkeyHex": { "name": "...", "picture": "..." } }
}
```

### Migration
- Guard with `__version`. Unknown keys are preserved. Migration functions upgrade older shapes to `settings.v1`.

---

## Background policy API

```ts
type EvalReason = "locked" | "session" | "rule" | "trust" | "fallback";
export function evaluatePolicy(origin: string, kind: number, unlocked: boolean):
  { mode: Authorisation; reason: EvalReason };

export function setOriginPolicy(origin: string, patch: Partial<OriginPolicy>): Promise<void>;
export function setPerKindRule(origin: string, kind: number, mode: Authorisation): Promise<void>;
export function clearSessionGrant(origin: string): Promise<void>;
```

All mutations are atomic, versioned, and emit an internal event for UI sync.

---

## UI requirements

- **Origin editor:** trust selector, per-kind tri-state table, “Allow ALL this session” toggle, live “effective policy” preview.
- **Header chip:** show active session grant per origin during requests; one-click revoke.
- **Presets:** Strict (all ask), Safe interactions (medium defaults), Open (all allow).

---

## Defaults (shipped)

```ts
export const DEFAULT_SETTINGS_V1: AppSettingsV1 = {
  __version: "settings.v1",
  theme: "system",
  sidePanel: false,
  autoLockMinutes: 5,
  relays: ["wss://relay.primal.net"],
  keys: [],
  origins: [],
  mediumAllowKinds: [6, 16, 7, 10002],
  sessionTTLMinutes: 0,
  selectedKeyId: undefined
};
```

---

## Acceptance tests

1. **Session ALL precedence:** With session grant active and unlocked, any kind signs silently unless an explicit deny exists. After lock, next request prompts or follows rules/trust.
2. **Deny wins:** Set trust=high and session grant active, but rule(kind:1)=deny → signing blocked with `denied`.
3. **Per-kind overrides trust:** trust=high but rule(kind:1)=ask → prompt.
4. **Medium defaults:** With no explicit rules and trust=medium, allow kinds {6,16,7,10002}; ask for 1,3,4,14,9735.
5. **Persistence:** Reload BG and popup; policies and defaults persist. Session grant cleared.
6. **Multi-key independence:** Change active key; per-origin policies unchanged.
