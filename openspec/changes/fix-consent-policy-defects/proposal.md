## Why

Ostrilo's policy engine is sound where it matters most: `evaluatePolicy` fails closed on a locked vault, honours an explicit `deny` before anything else, forces protected kinds to `ask` before consulting trust levels or session grants, and defaults an unknown origin to `ask`. `nostr.signEvent` forces the event `pubkey` to the selected key and recomputes the event id rather than trusting the caller. None of that changes here.

The defects are in the consent decisions that feed that engine. Six of them let a site end up with more authority than the user granted:

1. **Saying no widens the permission.** `PolicyService.setPerKindRule` creates a new origin record with `trustLevel: "medium"` hardcoded, whether the remembered decision was allow or deny. Medium trust auto-allows `DEFAULT_MEDIUM_ALLOW_KINDS = [6, 16, 7, 10002]`, so "deny and remember" on a kind `1` note silently grants that site unprompted reposts, reactions, and relay-list writes.
2. **Only two kinds are protected.** `PROTECTED_KINDS = [1, 9734]`. High trust returns `allow` for everything else, including kind `5` deletion requests, kind `3` contact lists, kind `0` profile metadata, kind `22242` relay auth, and kind `27235` HTTP auth - a bearer credential signed with no prompt.
3. **A fractional kind evades the gate.** `EventKindSchema` is `z.number().min(0).max(65535)` with no `.int()`, and `isProtectedKind` is a `Set.has` test, so `kind: 1.0000001` slips past the always-ask rule for kind `1`.
4. **Approval de-duplication ignores the origin.** The queue de-duplicates on `eventIdHash`, computed without the origin, and appends extra callers to the same `resolvers` array. One user click can therefore return a signature to an origin whose request was never displayed.
5. **Every page reads the user's identity silently.** `handleGetPublicKey` takes no origin, evaluates no policy, prompts for nothing, and logs nothing. The content script does not even send an origin for that method. The content script matches all http/https pages, so every site and every third-party script on it can read and correlate the user's npub.
6. **Grants never expire and settings misreports them.** `sessionTTLMinutes` defaults to `0`, which `setSessionGrant` stores as `expiresAt: 0` - a grant-everything session that lasts until lock. The settings table shows "Ask" for kinds that trust defaults actually allow, never surfaces an active session grant, and offers no way to review or lower an origin's trust level.

## What Changes

- Stop fabricating trust on record creation: `setPerKindRule` and `setOriginPolicy` SHALL NOT invent `trustLevel: "medium"` for a brand-new origin record. A remembered decision stores only that decision.
- **BREAKING** Replace "allow everything not named" with an explicit per-trust-level allowlist of signable kinds, so a newly-registered Nostr kind is never silently signable at high trust.
- Expand the protected-kind set with a documented rationale per kind, covering identity, credential, destructive, and social-graph events.
- Add `.int()` to `EventKindSchema`, audit every other numeric schema for the same gap, and reject non-integer kinds at the RPC boundary.
- Include the origin in the approval de-duplication key so an approval shown for one site can never satisfy another.
- **BREAKING** Gate `nostr.getPublicKey` behind per-origin consent: the content script SHALL send the page origin, the background SHALL evaluate policy, first use SHALL prompt, the grant SHALL be remembered and revocable, and each disclosure SHALL be recorded in the activity log.
- Give session grants a safe non-zero default TTL, enforce expiry, surface an active grant in Settings, and let the user revoke it.
- Make the Settings permissions table show the effective decision - what will actually happen - rather than only explicit rules, and expose trust level for review and downgrade.
- Migrate origin records that already carry an unearned `medium` trust level written by the current `setPerKindRule` bug.

Out of scope: the fail-open `getLockState` default (owned by `implement-session-auto-lock`), React Doctor re-enablement (owned by `restore-security-test-assurance`), and the injected-provider trust boundary (owned by `harden-provider-trust-boundary`).

## Capabilities

### New Capabilities

- `consent-scope-integrity`: A stored consent decision grants exactly the authority the user chose - no fabricated trust level, no implicit widening on deny, and no auto-signing of kinds outside an explicit per-trust-level allowlist.
- `identity-disclosure-consent`: Per-origin consent, origin binding, first-use prompt, remembered grant, and audit logging for `nostr.getPublicKey` public-key disclosure.
- `session-grant-lifecycle`: Bounded lifetime for grant-everything sessions, with a non-zero default TTL, enforced expiry, visible active state, and user revocation.
- `effective-permission-visibility`: The Settings permissions surface reports the effective decision for each origin and kind and exposes trust level for review and downgrade.

### Modified Capabilities

- `nip07-provider`: `Get Public Key` gains a consent gate and an origin parameter; `Pending Request Queue` de-duplicates per origin instead of globally; `Message Security` requires the origin on every forwarded method, not only `signEvent`.
- `rpc-validation`: numeric RPC inputs must be integer-bounded, so a fractional event kind is rejected instead of bypassing kind-keyed policy.

## Impact

- `src/domain/policy/trust-definitions.ts`: expanded protected kinds, new per-trust-level allowlist, and an integer-normalising kind helper.
- `src/domain/policy/evaluate.ts`: consumes the allowlist; existing locked/deny/protected/session/rule/trust/fallback order is preserved.
- `src/application/services/policy.service.ts`: no fabricated `trustLevel` on record creation; session-grant expiry; grant introspection for the UI.
- `src/application/services/settings.service.ts` and `src/domain/types.ts`: non-zero default `sessionTTLMinutes`; migration of unearned trust levels.
- `src/application/services/approval-queue.service.ts`: origin-scoped de-duplication key.
- `src/infrastructure/messaging/handlers/nostr-rpc.ts`: `handleGetPublicKey` accepts and validates an origin, evaluates policy, queues approval, and writes an activity entry.
- `src/infrastructure/messaging/rpc.ts` and `src/extension/content.ts`: `nostr.getPublicKey` carries the page origin.
- `src/infrastructure/validation/schemas.ts`: `.int()` on `EventKindSchema` and the other unbounded numeric schemas.
- `src/ui/features/settings/components/shared/OriginPolicyTable.tsx` and `PermissionsTab.tsx`: effective-decision rendering, trust-level control, live session-grant state.
- Tests: policy evaluation, policy service, approval queue, RPC handlers, validation schemas, and Playwright coverage for identity consent and deny-and-remember.
- Docs: `docs/v2-prd.md` gains requirements for identity-disclosure consent and bounded session grants.
