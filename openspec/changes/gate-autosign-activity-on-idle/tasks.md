## 1. Prerequisites

- [ ] 1.1 Confirm `add-auto-lock-countdown` is archived and merged into `openspec/specs/session-auto-lock/spec.md`; if not, STOP — the `MODIFIED` block here is written against the post-countdown text and applying it first would drop that change's surfaces clause and two scenarios
- [ ] 1.2 Add `idle` to `permissions` in `wxt.config.ts:139` and confirm both `pnpm run build` and `pnpm run build:firefox` emit it in their manifests

## 2. Presence helper

- [ ] 2.1 Add a helper owning the presence decision: reads the configured `autoLockMinutes`, converts to seconds, clamps to the API's 15s floor, and calls `browser.idle.queryState()` with it
- [ ] 2.2 Return presence only for `active`; `idle` and `locked` are absence. Treat a query that throws or returns an unrecognized value as absence, so the failure mode is a vault that locks rather than one that does not
- [ ] 2.3 Add the background throttle in the same helper, so a burst of signatures produces at most one idle query and one activity write per window
- [ ] 2.4 Unit test the helper: each of the three idle states, the clamp, the throttle, and the throw-means-absent path

## 3. Wire it to the auto-sign path

- [ ] 3.1 In `nostr-rpc.ts`, after a successful signature on the auto-sign branch (`:376`), record activity through the helper
- [ ] 3.2 Confirm the check runs AFTER the signature and can never refuse one — a vault that was unlocked and a policy that allowed the request owe the signature regardless of idle state
- [ ] 3.3 Confirm the approval-prompt branch is untouched: an approval resolved by the user already records activity from the UI and must not acquire a second, presence-gated report

## 4. Tests

- [ ] 4.1 `tests/security/auto-lock.test.ts`: an auto-signed request postpones the deadline while `active`
- [ ] 4.2 The same request does NOT postpone it while `idle`, and does not while `locked`
- [ ] 4.3 A signing origin cannot hold the vault open: repeated auto-signed requests across a full idle window still end in a locked vault, with subsequent requests refused with `locked`
- [ ] 4.4 The reading-user case end to end: sign, advance most of the window with the user reported `active`, sign again, and assert the second signature succeeds — this is the defect the change exists to fix and it needs a test that fails without it
- [ ] 4.5 Signature activity is throttled: a burst produces one write, not one per event
- [ ] 4.6 Guard test: the auto-sign path cannot record activity without consulting presence. A test asserting only "signing postpones the deadline" would still pass if a refactor dropped the check and left the call, which is the regression this guards
- [ ] 4.7 Confirm `tests/security/activity-reporting-boundary.test.ts` still passes, and extend its allowlist to cover the new background caller rather than letting the new call site fail it

## 5. Verify

- [ ] 5.1 `pnpm run compile`
- [ ] 5.2 `pnpm run test`
- [ ] 5.3 `pnpm run build` and `pnpm run build:firefox`
- [ ] 5.4 `pnpm run doctor` — address findings in changed files
- [ ] 5.5 `pnpm run slop:changes` — address findings in changed files
- [ ] 5.6 Confirm no new polling, listener, or scheduled work was added: the idle query must run only on a path that is already awake
- [ ] 5.7 Update the auto-lock slider copy, which says the timeout is measured from "your last activity in the extension" and is now too narrow
- [ ] 5.8 CHANGELOG entry: signing from a site keeps the vault open while you are at your machine, and does not keep it open once you leave; note the new `idle` permission and what it does and does not reveal
