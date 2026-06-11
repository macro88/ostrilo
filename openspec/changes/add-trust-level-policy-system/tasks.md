# Implementation Tasks: Trust Level Policy System

## 2026-06-11 Review Status

Do not implement the full proposal until the product/security decisions in `proposal.md` are resolved. The local hardening slice can start now: centralize trust definitions, enforce protected kinds, and add tests around existing trust-level evaluation.

Treat tasks that mention official policy fetching, NIP-78, global override, and source badges as blocked until the official pubkey, relay policy, and global High policy are decided.

## Phase 0: Scope and Security Decisions

- [ ] **0.1** Confirm implementation slice
  - Decide whether this development pass is local hardening only or includes official directory fetching.
  - **Validation:** Proposal status and task scope are updated before code changes.

- [ ] **0.2** Decide protected and auto-sign kind policy
  - Confirm protected kinds, Medium auto-sign kinds, and High auto-sign kinds.
  - Decide whether explicit per-kind allow/session grants can ever override protected kinds.
  - **Validation:** Decisions are documented in the proposal and tests.

- [ ] **0.3** Resolve official-directory prerequisites
  - Choose official policy pubkey and custody model.
  - Choose relay list and timeout/privacy rules.
  - Decide whether global High trust is allowed.
  - **Validation:** Official directory phases are unblocked only after these decisions are recorded.

## Phase 1: Foundation & Data Structures

- [ ] **1.1** Create or extract `src/domain/policy/trust-definitions.ts` with hardcoded trust level definitions

  - Preserve current `TrustLevel` behavior intentionally where it is still correct.
  - Export `TRUST_DEFINITIONS` constant with low/medium/high auto-sign arrays.
  - Export `PROTECTED_KINDS` constant as `[1, 9734]`
  - Add JSDoc comments explaining each trust level's purpose
  - **Validation:** `pnpm run compile` passes, constants are properly typed

- [ ] **1.2** Add NIP-78 policy types to `src/domain/types.ts`

  - Add `PolicyCacheEntry` interface (origin, trustLevel, source, fetchedAt, expiresAt, event)
  - Add `PolicySource` type: "official" | "user" | "global"
  - Add `OfficialPolicyEvent` interface matching NIP-78 schema
  - **Validation:** Types compile without errors, used in service layer

- [ ] **1.3** Extend `AppSettingsV1` with global trust override fields

  - Add optional `globalTrustOverride?: boolean` field
  - Add optional `globalTrustLevel?: TrustLevel` field
  - Update default settings to include new fields
  - **Validation:** Settings schema updated, defaults compile

- [ ] **1.4** Extend `OriginPolicy` with trust level source tracking
  - Add optional `trustLevelSource?: PolicySource` field
  - Update existing policies to default source to "user" if manually set
  - **Validation:** Type changes compile, existing code uses new field

## Phase 2: Core Policy Resolution Logic

- [ ] **2.1** Modify `src/domain/policy/evaluate.ts` to integrate trust levels

  - Import `TRUST_DEFINITIONS` and `PROTECTED_KINDS`
  - Add protected kind check before all other logic (return "ask" if kind is 1 or 9734)
  - Add trust level auto-sign check after session grants
  - Update reason enum to include "protected" and "trust"
  - **Validation:** Unit tests pass for protected kind enforcement

- [ ] **2.2** Write unit tests for trust level evaluation logic

  - Test: Low trust prompts for all kinds
  - Test: Medium trust auto-signs [3, 7, 10000, 10002, 22242]
  - Test: High trust auto-signs expanded list
  - Test: Protected kinds always prompt regardless of trust
  - Test: Explicit deny overrides trust level
  - Test: Explicit allow/ask overrides trust level
  - **Validation:** All tests pass, coverage > 90% for evaluate.ts

- [ ] **2.3** Create `src/application/services/policy-fetch.service.ts`

  - Implement `PolicyFetchService` class with relay query logic
  - Add `fetchOfficialPolicy(origin: string)` method
  - Implement 2-second timeout for relay queries
  - Implement signature verification against official pubkey
  - Add error handling for malformed events
  - **Validation:** Service compiles, basic smoke test shows timeout works

- [ ] **2.4** Add `resolveTrustLevel()` method to `PolicyService`
  - Implement priority chain: global → user → official cache → fallback
  - Add cache loading from `chrome.storage.local`
  - Trigger background fetch on cache miss or expiration
  - Return resolved trust level synchronously
  - **Validation:** Method compiles, returns correct level for each priority

## Phase 3: Caching & Storage

- [ ] **3.1** Implement policy cache operations in `PolicyService`

  - Add `loadPolicyCache()` method to read from local storage
  - Add `updatePolicyCache(origin, entry)` method to write to local storage
  - Add `purgePolicyCache()` method to clear all cached policies
  - Add cache expiration check (24-hour TTL)
  - **Validation:** Cache persists across extension restarts

- [ ] **3.2** Implement background policy fetch logic

  - Add `backgroundFetchOfficial(origin)` private method
  - Fire-and-forget pattern (does not block resolution)
  - Update cache on successful fetch
  - Log errors but don't propagate to caller
  - **Validation:** Background fetch completes within timeout, updates cache

- [ ] **3.3** Implement stale-while-revalidate strategy

  - Serve expired cache immediately if available
  - Trigger background refresh when serving stale data
  - Update cache on successful refresh
  - **Validation:** Stale cache is served, then refreshed in background

- [ ] **3.4** Write integration tests for caching behavior
  - Test: Cache hit returns immediately without network call
  - Test: Cache miss triggers background fetch
  - Test: Expired cache serves stale then refreshes
  - Test: Invalid cache entries are purged on read
  - **Validation:** All caching tests pass

## Phase 4: Settings UI - Global Override

- [ ] **4.1** Add Global Trust Override section to Settings view

  - Add toggle switch for "Enable Global Trust Level"
  - Add dropdown for trust level selection (Low, Medium, High)
  - Wire up state to `useAppSettings` hook
  - Add warning alert when High is selected
  - **Validation:** UI renders, toggle and dropdown work

- [ ] **4.2** Implement global override mutations in `useAppSettings`

  - Add `updateGlobalTrustOverride(enabled: boolean)` method
  - Add `updateGlobalTrustLevel(level: TrustLevel)` method
  - Update `appSettings` state on change
  - Persist to `chrome.storage.sync`
  - **Validation:** Changes persist across extension restarts

- [ ] **4.3** Add E2E test for global override workflow
  - Test: User enables global Medium trust
  - Test: All dApps are evaluated with Medium trust
  - Test: User disables global override
  - Test: Individual trust levels are restored
  - **Validation:** E2E test passes in Playwright

## Phase 5: Settings UI - Per-DApp Management

- [ ] **5.1** Add trust level column to DApps table in Settings

  - Update table to show trust level with dropdown
  - Add "Source" badge (Official vs User)
  - Wire up dropdown to `updateOriginTrustLevel` method
  - **Validation:** Table displays correctly, dropdown functional

- [ ] **5.2** Implement trust level mutations for individual dApps

  - Modify `updateOriginPolicy` to set `trustLevelSource` to "user"
  - Add "Revert to Official" action for dApps with official policies
  - Update badge when source changes
  - **Validation:** User overrides work, revert restores official level

- [ ] **5.3** Add tooltips and help text for trust levels

  - Add info icon next to trust level dropdown
  - Tooltip explains auto-sign behavior for each level
  - Add "Learn More" link to docs
  - **Validation:** Tooltips display correct information

- [ ] **5.4** Add E2E test for per-dApp trust management
  - Test: User changes trust level for specific dApp
  - Test: Badge updates from Official to User
  - Test: User reverts to official policy
  - **Validation:** E2E test passes

## Phase 6: Connection Popup Enhancement

- [ ] **6.1** Add official trust badge to connection popup

  - Query for official policy when popup opens
  - Display "Official Trust Level: [LEVEL]" badge if found
  - Add shield icon and explanation text
  - Pre-select dropdown to official level
  - **Validation:** Badge displays for dApps with official policies

- [ ] **6.2** Add trust level selection dropdown to connection popup

  - Show dropdown with Low, Medium, High options
  - Include descriptions for each level
  - Default to official level if available, otherwise Low
  - **Validation:** Dropdown works, selection persists on connect

- [ ] **6.3** Wire up connection with selected trust level

  - Pass selected trust level to connection handler
  - Create origin policy with selected level and source
  - Set `trustLevelSource` to "user" if different from official
  - **Validation:** Connected dApps have correct trust level

- [ ] **6.4** Add E2E test for connection flow with trust levels
  - Test: Connect to dApp with official policy
  - Test: Official badge displays
  - Test: User accepts official level
  - Test: User chooses different level
  - **Validation:** Connection flow test passes

## Phase 7: Activity Logging

- [ ] **7.1** Add activity log entries for policy events

  - Log official policy fetch with result
  - Log user trust level changes
  - Log protected kind blocks
  - Include timestamp, origin, action, details
  - **Validation:** Activity log shows policy events

- [ ] **7.2** Add activity log filtering for policy events

  - Add "Policy Changes" filter to Activity View
  - Group policy events separately from signing events
  - **Validation:** Filter shows only policy events

- [ ] **7.3** Test activity logging with E2E tests
  - Test: Policy fetch appears in activity log
  - Test: Trust level change appears in activity log
  - Test: Protected kind block appears in activity log
  - **Validation:** All logging tests pass

## Phase 8: Security & Validation

- [ ] **8.1** Implement official pubkey signature verification

  - Add `verifyOfficialPolicy(event)` function
  - Check event.pubkey matches hardcoded official key
  - Verify event signature using nostr-tools
  - Validate content JSON structure
  - **Validation:** Only valid events from official key are accepted

- [ ] **8.2** Add protected kinds enforcement at RPC handler level

  - Secondary check in `signEvent` RPC handler
  - Force prompt for kind 1 and 9734 regardless of policy
  - Log when secondary check blocks auto-sign
  - **Validation:** Protected kinds never auto-sign even with bypass attempts

- [ ] **8.3** Write security tests for protected kinds

  - Test: Kind 1 with High trust + session grant still prompts
  - Test: Kind 9734 with global High override still prompts
  - Test: Malicious event with kind 1 cannot bypass protection
  - **Validation:** All security tests pass

- [ ] **8.4** Add input validation for NIP-78 event content
  - Validate `trustLevel` field is "low" | "medium" | "high"
  - Validate `updatedAt` is a number
  - Reject events with unknown trust levels
  - **Validation:** Invalid events are rejected, logged as errors

## Phase 9: Documentation & Hardcoded Values

- [ ] **9.1** Determine and hardcode official Ostrilo pubkey

  - Generate new keypair for official policy signing (or reuse existing)
  - Add pubkey as constant in `policy-fetch.service.ts`
  - Document private key storage location (DO NOT commit nsec)
  - **Validation:** Pubkey is valid hex string, verified with test event

- [ ] **9.2** Configure relay list for official policy fetch

  - Add relay URLs as constant in `policy-fetch.service.ts`
  - Use reliable, well-known relays (relay.damus.io, nos.lol, etc.)
  - Document relay selection criteria
  - **Validation:** Relays are reachable, test fetch succeeds

- [ ] **9.3** Update user-facing documentation

  - Add trust level system overview to README
  - Document auto-sign behavior for each level
  - Explain official vs user policies
  - Add FAQ section for common questions
  - **Validation:** Docs are clear, accurate, accessible

- [ ] **9.4** Add inline help text to Settings UI
  - Explain what each trust level does
  - Clarify protected kinds are always prompted
  - Explain official policy source
  - **Validation:** Help text is clear and concise

## Phase 10: Testing & Validation

- [ ] **10.1** Run full test suite

  - Unit tests: `pnpm run test:unit`
  - Integration tests: `pnpm run test:integration`
  - E2E tests: `pnpm run test:e2e`
  - **Validation:** All tests pass, no regressions

- [ ] **10.2** Perform manual testing of all workflows

  - Test global override with all three levels
  - Test per-dApp trust assignment and override
  - Test official policy fetch and caching
  - Test protected kinds enforcement
  - Test connection flow with official badge
  - **Validation:** All manual test scenarios pass

- [ ] **10.3** Test browser compatibility

  - Build for Chrome: `pnpm run build`
  - Build for Firefox: `pnpm run build:firefox`
  - Load extension in both browsers
  - Verify all features work in both environments
  - **Validation:** Extension works in Chrome and Firefox

- [ ] **10.4** Performance validation
  - Measure policy resolution time (< 10ms target)
  - Measure cache load time (< 50ms target)
  - Test with 50+ cached policies
  - Verify no UI lag during policy evaluation
  - **Validation:** Performance targets met

## Phase 11: Polish & Deployment Prep

- [ ] **11.1** Add telemetry/analytics (optional)

  - Log trust level distribution (anonymized)
  - Track protected kind blocks
  - Monitor cache hit rate
  - **Validation:** Analytics data is anonymous, opt-in

- [ ] **11.2** Create migration for existing users

  - Assign default "medium" trust to existing origins
  - Set `trustLevelSource` to "user" for existing policies
  - Do not enable global override by default
  - **Validation:** Migration runs successfully, no data loss

- [ ] **11.3** Update CHANGELOG with new features

  - Document trust level system
  - List auto-sign behaviors
  - Mention protected kinds
  - **Validation:** CHANGELOG is accurate and complete

- [ ] **11.4** Final code review and cleanup
  - Remove debug logging
  - Check for TODO/FIXME comments
  - Verify all files have proper headers
  - Run linter and fix warnings
  - **Validation:** Code is clean, production-ready

---

## Estimated Effort

- **Phase 1-2:** Foundation (4-6 hours)
- **Phase 3:** Caching (3-4 hours)
- **Phase 4-6:** UI Implementation (6-8 hours)
- **Phase 7:** Logging (2-3 hours)
- **Phase 8:** Security (4-5 hours)
- **Phase 9:** Documentation (2-3 hours)
- **Phase 10:** Testing (4-6 hours)
- **Phase 11:** Polish (2-3 hours)

**Total:** 27-38 hours

## Dependencies

- NIP-78 event format specification
- Official Ostrilo pubkey (to be generated/determined)
- Relay endpoints for policy fetch
- Design approval for Settings UI changes
- Security review of protected kinds enforcement

## Rollout Strategy

1. **Internal Testing:** Deploy to dev environment, test with team
2. **Beta Release:** Publish to small group of trusted users
3. **Monitor Feedback:** Track issues, protected kind bypasses, cache performance
4. **Gradual Rollout:** Increase user base over 2 weeks
5. **Full Release:** Publish to all users after stability confirmed

## Success Criteria

- ✅ All tests pass (unit, integration, E2E)
- ✅ No auto-signing of kind 1 or 9734 in any scenario
- ✅ Cache hit rate > 80% for official policies
- ✅ Policy resolution time < 10ms (excluding network)
- ✅ Zero data corruption or loss during migration
- ✅ Extension builds successfully for Chrome and Firefox
