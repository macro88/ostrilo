# Policy System Specification

## ADDED Requirements

### Requirement: Trust Level Definitions

The extension SHALL define three trust levels with hardcoded auto-sign rules that determine which event kinds can be automatically signed without user prompts.

**Acceptance Criteria:**

- Low Trust level has empty auto-sign list (prompts for all events)
- Medium Trust level auto-signs kinds: 3, 7, 10000, 10002, 22242
- High Trust level auto-signs kinds: 0, 3, 6, 7, 1984, 10000, 10002, 22242, 30023
- Trust definitions are immutable at runtime (hardcoded constants)
- Trust level enum is strictly typed: "low" | "medium" | "high"

#### Scenario: User connects to dApp with Medium Trust

**Given** a dApp is assigned Medium Trust level  
**When** the dApp requests to sign kind 7 (Reaction)  
**Then** the extension auto-signs without prompting  
**And** when the dApp requests kind 1 (Text Note)  
**Then** the extension prompts the user for approval

#### Scenario: User connects to dApp with Low Trust

**Given** a dApp is assigned Low Trust level (default)  
**When** the dApp requests to sign any event kind  
**Then** the extension always prompts the user for approval

#### Scenario: User connects to dApp with High Trust

**Given** a dApp is assigned High Trust level  
**When** the dApp requests to sign kind 6 (Repost)  
**Then** the extension auto-signs without prompting  
**And** when the dApp requests kind 30023 (Long-form Content)  
**Then** the extension auto-signs without prompting

---

### Requirement: Protected Kinds Enforcement

The extension SHALL never auto-sign kind 1 (Text Notes) or kind 9734 (Zap Requests) regardless of trust level, global overrides, or explicit rules.

**Acceptance Criteria:**

- Kind 1 signing always requires user approval
- Kind 9734 signing always requires user approval
- Protected kinds check occurs before trust level evaluation
- Protected kinds list is immutable: [1, 9734]
- Approval prompt must display event content for protected kinds

#### Scenario: High Trust dApp attempts to sign Text Note

**Given** a dApp is assigned High Trust level  
**When** the dApp requests to sign kind 1 (Text Note)  
**Then** the extension shows approval prompt with event content  
**And** the prompt explains "Text Notes always require approval"

#### Scenario: Global High Trust cannot bypass Zap protection

**Given** user enabled "Global Trust Level: High" in settings  
**When** any dApp requests to sign kind 9734 (Zap Request)  
**Then** the extension shows approval prompt with zap details  
**And** the prompt explains "Zap Requests always require approval"

#### Scenario: Session grant cannot bypass protected kinds

**Given** user granted "Allow All" session permission to a dApp  
**When** the dApp requests to sign kind 1 (Text Note)  
**Then** the extension still shows approval prompt  
**And** the session grant does not apply to protected kinds

---

### Requirement: Trust Level Resolution Priority

The extension SHALL resolve trust level for a dApp by checking sources in priority order: Global Override → User Override → Official Directory → Fallback to Low.

**Acceptance Criteria:**

- Global override bypasses all other sources when enabled
- User-specific override takes precedence over official directory
- Official directory policies are fetched from Nostr (NIP-78)
- Fallback to Low Trust when no policy is found
- Resolution must complete within 100ms (excluding network fetch)

#### Scenario: Global override is active

**Given** user enabled "Global Trust Level: High" in settings  
**When** extension evaluates policy for any dApp  
**Then** the extension returns "high" trust level immediately  
**And** no network requests are made  
**And** user-specific and official policies are ignored

#### Scenario: User has manual override for specific dApp

**Given** user set "primal.net" to Medium Trust manually  
**And** official directory has "primal.net" as High Trust  
**When** extension evaluates policy for "primal.net"  
**Then** the extension returns "medium" trust level  
**And** the official policy is ignored for this origin

#### Scenario: Official policy found in cache

**Given** official directory has "snort.social" as High Trust  
**And** policy is cached and not expired  
**When** extension evaluates policy for "snort.social"  
**Then** the extension returns "high" trust level from cache  
**And** no network request is made

#### Scenario: No policy found anywhere

**Given** no global override is set  
**And** no user override exists for "unknown-app.com"  
**And** no official policy exists for "unknown-app.com"  
**When** extension evaluates policy for "unknown-app.com"  
**Then** the extension returns "low" trust level (default)

---

### Requirement: NIP-78 Official Policy Fetch

The extension SHALL fetch official trust level assignments from Nostr relays using NIP-78 (Arbitrary Custom App Data) events signed by the official Ostrilo pubkey.

**Acceptance Criteria:**

- Fetch kind 30078 events with `d` tag matching dApp origin
- Verify events are signed by hardcoded official Ostrilo pubkey
- Parse JSON content to extract `trustLevel` field
- Timeout relay queries after 2 seconds
- Store valid policies in local cache with 24-hour TTL
- Background fetch never blocks policy evaluation

#### Scenario: Fetch official policy on first connection

**Given** user connects to "primal.net" for the first time  
**And** official policy exists on relays  
**When** extension fetches official policy  
**Then** a kind 30078 event with `["d", "https://primal.net"]` is queried  
**And** the fetch completes within 2 seconds or times out  
**And** valid response is cached with 24-hour expiration

#### Scenario: Invalid signature on official policy

**Given** extension receives a kind 30078 event for "malicious-app.com"  
**And** the event pubkey does not match official Ostrilo pubkey  
**When** extension validates the event  
**Then** the event is rejected  
**And** no cache entry is created  
**And** trust level falls back to "low"

#### Scenario: Malformed JSON in policy content

**Given** extension receives a valid NIP-78 event  
**And** the content field is not valid JSON  
**When** extension parses the content  
**Then** the policy is rejected  
**And** an error is logged  
**And** trust level falls back to "low"

---

### Requirement: Policy Cache Management

The extension SHALL cache fetched official policies in chrome.storage.local with TTL-based expiration and stale-while-revalidate strategy.

**Acceptance Criteria:**

- Cache stores: origin, trustLevel, source, fetchedAt, expiresAt, event
- Cache entries expire after 24 hours
- Expired cache is served while background refetch occurs
- Cache survives browser restarts
- Cache key is "policyCache" in chrome.storage.local
- Invalid cache entries are purged on read

#### Scenario: Cache hit within TTL

**Given** policy for "primal.net" was cached 2 hours ago  
**And** cache entry has not expired (< 24 hours)  
**When** extension evaluates policy for "primal.net"  
**Then** trust level is returned from cache immediately  
**And** no network request is made

#### Scenario: Cache miss triggers background fetch

**Given** no cache entry exists for "snort.social"  
**When** extension evaluates policy for "snort.social"  
**Then** extension returns "low" trust level immediately  
**And** a background fetch is initiated  
**And** future requests will use cached result

#### Scenario: Expired cache serves stale while refetching

**Given** policy for "primal.net" was cached 25 hours ago (expired)  
**When** extension evaluates policy for "primal.net"  
**Then** expired cache value is returned immediately  
**And** a background fetch is initiated to refresh cache  
**And** next request uses fresh data if fetch succeeds

#### Scenario: Cache persists across browser restarts

**Given** policies are cached for multiple dApps  
**When** user restarts the browser  
**And** extension loads  
**Then** all cached policies are still available  
**And** TTL calculations remain valid

---

### Requirement: Global Trust Override Settings

The extension SHALL provide a global setting to apply one trust level to all dApps, bypassing individual assignments.

**Acceptance Criteria:**

- Settings UI has toggle for "Enable Global Trust Level"
- Dropdown allows selection: Low, Medium, High
- Warning displayed when High is selected
- Setting stored in chrome.storage.sync as `globalTrustOverride` (boolean) and `globalTrustLevel` (string)
- When enabled, all policy resolution returns global level
- Existing per-dApp rules are hidden but preserved

#### Scenario: User enables global Medium trust

**Given** user has 5 connected dApps with various trust levels  
**When** user enables "Global Trust Level: Medium"  
**Then** all dApps are treated as Medium trust  
**And** individual trust assignments are preserved but ignored  
**And** no network fetches occur for official policies

#### Scenario: User disables global override

**Given** global override was enabled with High trust  
**When** user disables the global override toggle  
**Then** individual dApp trust levels are restored  
**And** official policies are used where applicable  
**And** user overrides are respected

#### Scenario: Warning shown for global High trust

**Given** user selects "Global Trust Level: High"  
**When** the dropdown value changes  
**Then** a warning alert is displayed  
**And** warning states "auto-approve most actions on all websites"  
**And** warning clarifies "Notes and Zaps will still require approval"

---

### Requirement: Per-DApp Trust Level Management

The extension SHALL allow users to manually assign and override trust levels for individual dApps through the Settings UI.

**Acceptance Criteria:**

- Settings displays table of connected dApps with current trust level
- Each row has dropdown to change trust level: Low, Medium, High
- Badge displays source: "Official" or "User"
- Changing level creates user override (source becomes "User")
- User overrides are stored in `origins` array in settings
- User can revert to official policy (if available)

#### Scenario: User overrides official policy

**Given** "primal.net" has official trust level "high"  
**When** user changes trust level to "medium" in Settings  
**Then** `trustLevelSource` is set to "user"  
**And** badge changes from "Official" to "User"  
**And** policy evaluation uses "medium" instead of "high"

#### Scenario: User reverts to official policy

**Given** user previously overrode "snort.social" to "low"  
**And** official policy is "high"  
**When** user clicks "Revert to Official" action  
**Then** `trustLevelSource` is removed or set to "official"  
**And** badge changes to "Official"  
**And** trust level becomes "high"

#### Scenario: User sets trust for app without official policy

**Given** "unknown-app.com" has no official policy  
**When** user sets trust level to "medium"  
**Then** trust level is stored as user override  
**And** badge shows "User"  
**And** policy evaluation returns "medium"

---

### Requirement: Connection Popup Trust Badge

The extension SHALL display official trust level badge during first-time dApp connection to inform users of vetted applications.

**Acceptance Criteria:**

- Popup checks for official policy when connecting to new dApp
- Badge displays "Official Trust Level: [LOW|MEDIUM|HIGH]" if found
- Badge includes shield icon and explanation text
- User can accept official level or choose different level before connecting
- Popup shows dropdown to select trust level with descriptions
- Default selection is official level if available, otherwise "low"

#### Scenario: Connecting to dApp with official High trust

**Given** user clicks "Connect" on "primal.net" for the first time  
**And** official policy is "high"  
**When** connection popup appears  
**Then** badge shows "Official Trust Level: HIGH"  
**And** dropdown is pre-selected to "High"  
**And** user sees explanation "Ostrilo has verified this application"

#### Scenario: Connecting to dApp without official policy

**Given** user clicks "Connect" on "new-app.com"  
**And** no official policy exists  
**When** connection popup appears  
**Then** no official badge is shown  
**And** dropdown is pre-selected to "Low"  
**And** user can select any trust level before connecting

#### Scenario: User chooses different level than official

**Given** connection popup shows official "high" trust  
**When** user selects "medium" from dropdown  
**And** clicks "Connect"  
**Then** dApp is connected with "medium" trust level  
**And** `trustLevelSource` is set to "user"

---

### Requirement: Integration with Existing Per-Kind Rules

The extension SHALL preserve existing per-kind rule functionality and ensure explicit rules override trust level defaults.

**Acceptance Criteria:**

- Explicit "deny" rules always block signing regardless of trust level
- Explicit "allow" rules take precedence over trust level
- Explicit "ask" rules take precedence over trust level auto-sign
- Session grants still function independently
- Trust level only applies when no explicit rule exists
- UI shows both trust level AND per-kind rules in Settings

#### Scenario: Explicit deny overrides High trust auto-sign

**Given** "primal.net" has High trust level  
**And** user set explicit "deny" rule for kind 6 (Repost)  
**When** "primal.net" requests to sign kind 6  
**Then** extension denies the request without prompting  
**And** trust level auto-sign is ignored

#### Scenario: Explicit allow on Low trust dApp

**Given** "unknown-app.com" has Low trust level  
**And** user set explicit "allow" rule for kind 7 (Reaction)  
**When** "unknown-app.com" requests to sign kind 7  
**Then** extension auto-signs without prompting  
**And** Low trust default is overridden

#### Scenario: Trust level applies when no explicit rule exists

**Given** "primal.net" has Medium trust level  
**And** no explicit rule exists for kind 10002 (Relay List)  
**When** "primal.net" requests to sign kind 10002  
**Then** extension auto-signs because kind 10002 is in Medium auto-sign list  
**And** no prompt is shown

---

### Requirement: Security Audit Logging

The extension SHALL log all trust level assignments, policy fetches, and protected kind enforcement to activity log for security auditing.

**Acceptance Criteria:**

- Log when official policy is fetched and cached
- Log when user manually changes trust level
- Log when protected kind blocks auto-sign
- Log includes: timestamp, origin, action, source, result
- Logs are stored in activity log ring buffer
- Logs are accessible in Activity View

#### Scenario: Official policy fetch is logged

**Given** extension fetches official policy for "primal.net"  
**When** valid policy is received and cached  
**Then** activity log contains entry:

- Action: "Policy Fetched"
- Origin: "primal.net"
- Details: "Official trust level: high"
- Timestamp: [current time]

#### Scenario: Protected kind rejection is logged

**Given** "primal.net" (High trust) requests to sign kind 1  
**When** extension blocks auto-sign due to protected kind  
**And** shows approval prompt  
**Then** activity log contains entry:

- Action: "Protected Kind"
- Kind: 1
- Reason: "Text Notes always require approval"
- Origin: "primal.net"

#### Scenario: User override is logged

**Given** user changes "snort.social" from "high" to "medium"  
**When** change is saved  
**Then** activity log contains entry:

- Action: "Trust Level Changed"
- Origin: "snort.social"
- From: "high (official)"
- To: "medium (user)"

---

## MODIFIED Requirements

### Requirement: Policy Evaluation Algorithm

**Modified Behavior:** The extension SHALL evaluate policy using layered priority: Locked Check → Explicit Rules → Protected Kinds → Session Grants → Trust Level Auto-Sign → Fallback to Ask.

**Acceptance Criteria:**

- Locked state check occurs first (deny all if locked)
- Explicit deny rules block all other evaluation
- Protected kinds [1, 9734] force prompt regardless of trust
- Session grant "allow all" applies if no explicit deny
- Trust level auto-sign applies if kind is in autoSign array
- Fallback to "ask" if no rules or trust level match
- Evaluation completes in < 10ms excluding network I/O

#### Scenario: Layered evaluation with Medium trust

**Given** extension is unlocked  
**And** "primal.net" has Medium trust level  
**And** no explicit rules exist for kind 7  
**When** "primal.net" requests to sign kind 7 (Reaction)  
**Then** locked check passes (unlocked)  
**And** no explicit deny rule exists  
**And** kind 7 is not protected  
**And** kind 7 is in Medium auto-sign list  
**Then** extension auto-signs without prompting  
**And** reason is "trust"

#### Scenario: Protected kind bypasses all other logic

**Given** "primal.net" has High trust and session grant  
**And** no explicit deny exists for kind 1  
**When** "primal.net" requests to sign kind 1  
**Then** protected kind check blocks auto-sign  
**And** extension shows approval prompt  
**And** session grant is ignored  
**And** High trust is ignored

---

## REMOVED Requirements

None. This change is additive and does not remove existing functionality.
