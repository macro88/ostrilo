## 1. Approval Action Semantics

- [x] 1.1 Confirm current approval action flow from `EventDetailView` through `ApprovalRpcHandler` and `ApprovalQueueService`.
- [x] 1.2 Persist `allow` approval actions as per-origin, per-kind `allow` rules for unprotected event kinds.
- [x] 1.3 Keep `allow_once` as one-time signing without policy mutation.
- [x] 1.4 Preserve `deny_remember` policy persistence and existing deny behavior.
- [x] 1.5 Add a defensive protected-kind guard so remembered allow cannot persist for kind `1` or kind `9734`.

## 2. Approval UI Copy And Controls

- [x] 2.1 Update approval detail copy so the remember option clearly says it applies to this site and this event kind.
- [x] 2.2 Show the event kind label near the remembered decision copy.
- [x] 2.3 Prevent remembered allow affordances for protected kinds and explain that they always require approval before signing.
- [x] 2.4 Keep UI styling aligned with `docs/design/DESIGN_RULES.md`.

## 3. Settings Visibility And Policy Management

- [x] 3.1 Ensure Settings permissions updates when a remembered policy is created from an approval window.
- [x] 3.2 Expand common event-kind labels to include profile, contacts, mute list, pin list, relay list, and application data kinds.
- [x] 3.3 Expand per-origin quick policy controls for common unprotected client policy kinds.
- [x] 3.4 Ensure protected kinds are not presented as auto-allow candidates in Settings.
- [x] 3.5 Verify users can change a remembered `allow` rule back to `ask` or `deny`.

## 4. Tests

- [x] 4.1 Add approval RPC tests proving `allow` persists unprotected per-kind allow rules.
- [x] 4.2 Add approval RPC tests proving `allow_once` does not persist rules.
- [x] 4.3 Add protected-kind tests proving kind `1` and kind `9734` cannot be persisted as remembered allow.
- [x] 4.4 Add policy/settings tests proving remembered rules appear in stored origin policies and can be changed.
- [x] 4.5 Add UI tests for remember-scope copy, protected-kind disabled copy, and common event-kind labels.
- [x] 4.6 Add Playwright E2E proving first matching request prompts, remembered allow is saved, second matching request auto-signs, and Settings shows the rule.

## 5. PRD And Documentation

- [x] 5.1 Update `docs/v2-prd.md` status notes after implementation to reflect the shipped state of `UX-018`.
- [x] 5.2 Update user-facing or developer docs only if the approval/settings behavior becomes externally relevant beyond the UI itself.

## 6. Verification

- [x] 6.1 Run `openspec validate fix-remembered-site-signing-policies --strict`.
- [x] 6.2 Run `pnpm run compile`.
- [x] 6.3 Run focused Vitest suites for approval RPC, policy service, settings UI, and event-kind labels.
- [x] 6.4 Run relevant Playwright extension tests for approval, NIP-07 signing, and settings permissions.
- [x] 6.5 Run `pnpm run build` and `pnpm run build:firefox`.
- [x] 6.6 Run `npx react-doctor@latest` until it reports `No issues found!` and `100 / 100`.
