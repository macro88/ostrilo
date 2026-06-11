# Proposal: Add Trust Level Policy System

## Status

- **Created:** 2025-12-18
- **Status:** Needs product/security decisions before full development
- **Author:** AI Assistant
- **Approver:** TBD

## 2026-06-11 Review Status

Current code already has a local `TrustLevel` type, per-origin `trustLevel`, `mediumAllowKinds`, and trust-based evaluation in `src/domain/policy/evaluate.ts`. The missing pieces are protected-kind enforcement, source tracking, global override, official NIP-78 directory fetch/cache, and UI surfacing.

Development readiness: not ready as a full proposal. The local hardening slice is ready to develop, but the official directory and sync-backed trust assignment work is blocked until product/security decisions are made.

Ready local hardening slice:

- Extract/centralize trust definitions and protected kinds.
- Enforce protected kinds before explicit rules and session grants.
- Add tests proving kind 1 and kind 9734 never auto-sign.
- Align default medium/high kind lists with the final product policy.

Blocked decisions before official-directory development:

- Official Ostrilo policy pubkey and key custody/rotation plan.
- Relay list and fetch failure behavior.
- Whether global High trust is allowed at all.
- Whether official trust assignments may preselect first-connection trust.
- Whether NIP-78 user override sync belongs here or in a separate sync proposal.

## Problem Statement

The current permission system requires users to manage per-kind permissions for every dApp individually. This creates "popup fatigue" - users are bombarded with approval prompts for every signing request, even for trusted applications. While this approach provides maximum security, it creates friction that degrades the user experience, particularly for power users who regularly interact with trusted Nostr clients.

**Current Pain Points:**

1. **Manual Configuration:** Users must configure permissions for each event kind on each dApp
2. **Repetitive Prompts:** Even trusted apps require constant approval popups
3. **No Trust Hierarchy:** The system doesn't distinguish between "new unknown app" vs "established trusted client"
4. **No Remote Defaults:** There's no mechanism for the Ostrilo team to publish recommended trust levels for well-known dApps
5. **No Sync Across Devices:** User trust preferences are local-only

## Proposed Solution

Implement a **Hybrid Trust Level Policy System** that reduces popup fatigue while maintaining security guardrails. The system operates on three levels of trust (Low, Medium, High) with hardcoded auto-sign rules and remote/user-defined assignments.

This proposal should be split during implementation:

1. Local policy hardening and protected-kind enforcement.
2. Official directory fetch/cache and source badges after the decisions above are resolved.
3. Optional user sync via NIP-78 only if a separate privacy review approves it.

### Key Components

1. **Trust Level Definitions (Hardcoded)**

   - **Low Trust:** Prompt for everything (current behavior)
   - **Medium Trust:** Auto-sign utility kinds (7, 3, 10000, 10002, 22242), prompt for content
   - **High Trust:** Auto-sign social interactions (0, 6, 30023, 1984), but NEVER kind 1 (notes) or 9734 (zaps)

2. **Trust Assignment Sources (Priority Order)**

   - Global Override (User setting: "Treat all apps as X")
   - User-Specific Override (Stored locally or synced via NIP-78)
   - Official Ostrilo Directory (NIP-78 events signed by official pubkey)
   - Fallback to Low Trust

3. **Security Guarantees**
   - Kind 1 (Text Notes) NEVER auto-signed
   - Kind 9734 (Zap Requests) NEVER auto-signed
   - Official assignments verified by signature
   - 24-hour cache TTL for remote policies

### User Experience Improvements

- **First Connection:** Show "Official Trust Level: HIGH" badge if Ostrilo has vetted the dApp
- **Settings UI:** Simple dropdown per dApp: "Trust Level: Low | Medium | High"
- **Global Override:** One-click "Trust all apps at Medium" for power users
- **Sync via Nostr:** Users can publish their trust assignments as NIP-78 events to sync across devices

## Goals

1. **Reduce Popup Fatigue:** Auto-sign low-risk operations for trusted apps
2. **Maintain Security:** Never auto-sign notes (kind 1) or zaps (kind 9734)
3. **Enable Curation:** Ostrilo team can publish vetted dApp trust levels
4. **Support Power Users:** Global override for experienced users
5. **Cross-Device Sync:** Users can optionally sync policies via Nostr

## Non-Goals

1. **Not** replacing the existing per-kind rules system (still available for granular control)
2. **Not** fetching policies from untrusted sources
3. **Not** auto-approving connections (first connection still prompts)
4. **Not** implementing relay selection UI for policy fetch

## Success Metrics

1. Reduced number of approval prompts for users with ≥3 connected dApps
2. Zero reports of unexpected auto-signed notes or zaps
3. Successful fetch and cache of official policies within 2 seconds
4. User trust assignments persist across browser restarts
5. Existing per-kind rules continue to work and override trust levels

## Dependencies

- **NIP-78 Support:** Must implement arbitrary custom app data format
- **Signature Verification:** Must verify official Ostrilo pubkey on fetched events
- **Relay Access:** Must configure relay list for policy fetch
- **Cache Layer:** Must implement TTL-based caching in chrome.storage.local

## Risks and Mitigations

| Risk                                            | Impact   | Mitigation                                                               |
| ----------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| Users accidentally enable "High Trust" globally | High     | Prominent warning text + confirmation dialog                             |
| Official pubkey compromise                      | Critical | Use well-protected nsec; rotate if compromised; publish revocation event |
| Relay fetch timeout causes UX lag               | Medium   | Use 2-second timeout; serve stale cache while refetching in background   |
| NIP-78 event format conflicts                   | Low      | Version content JSON; ignore unknown fields                              |

## Open Questions

1. Should we implement NIP-78 sync for user overrides in v1, or defer to a separate sync proposal?
2. What should the official Ostrilo pubkey be, and who controls/rotates the signing key?
3. Which relays should be hardcoded for policy fetch, and what privacy assumptions do they create?
4. Should we show a "Last Updated" timestamp for official policies in UI?
5. Should users be able to disable official policy fetching entirely?
6. Is global High trust allowed, or should the highest global override be Medium?
7. Which exact event kinds belong in Medium and High trust after the protected-kind rule is applied?

## Alternatives Considered

1. **Per-Kind Only:** Status quo - rejected due to popup fatigue
2. **All-or-Nothing Trust:** Rejected due to security concerns (too broad)
3. **Time-Based Grants:** Rejected - doesn't solve repetitive prompts across sessions
4. **Machine Learning:** Rejected - too complex, privacy concerns

## Related Changes

- None (standalone feature)

## References

- NIP-78: Arbitrary Custom App Data - https://github.com/nostr-protocol/nips/blob/master/78.md
- Existing PolicyService: `src/application/services/policy.service.ts`
- Existing evaluate logic: `src/domain/policy/evaluate.ts`
