# Improve Approval Queue UX - Completion Summary

## Date
June 11, 2026

## Status
All OpenSpec tasks are complete.

## Delivered

- Event ID de-duplication now tracks the computed NIP-01 event hash on pending requests.
- Duplicate queued events reuse one visible approval request and attach every caller's resolver, so duplicate callers are all resolved on approval, denial, or timeout.
- Approval window lifecycle is owned by the background script:
  - one tracked approval window ID
  - in-flight focus/create operation lock for concurrent requests
  - badge updates on queue changes and window focus
  - automatic close after the queue empties
- Activity opens or focuses the managed approval window instead of creating an unmanaged duplicate.
- Approval window now targets a 960x640 inbox/detail layout.
- Approval UI now shows a real two-pane approval inbox on desktop:
  - left queue grouped by origin
  - selected request row
  - live per-request countdowns
  - batch approve by origin
  - global deny all
  - right-side event detail pane
- Event detail now shows complete content, formatted tags JSON, event ID, signing pubkey, copy affordances, raw JSON, trust line, and pinned Deny / Approve & sign actions.

## Verification

- `pnpm run compile` passes.
- `pnpm test` passes: 29 test files, 393 tests.
- `pnpm exec vitest run tests/unit/application/approval-queue.service.test.ts` passes: 30 tests.
- `pnpm exec playwright test tests/e2e/approval-queue-ux.spec.ts --project=chromium-extension` passes: 4 tests.
- `pnpm run test:e2e:smoke` passes: 1 test.
- `pnpm run test:e2e` passes: 18 passed, 25 intentionally skipped.
- `pnpm run build` passes for Chrome MV3.
- `pnpm run build:firefox` passes for Firefox MV2.

## Notes

- The mandatory `modern-web-guidance` package could not be fetched in the sandbox and was not available in npm offline cache. The escalation to fetch and execute it was rejected by the policy reviewer, so implementation followed the local design rules and existing repository patterns.
- `openspec/AGENTS.md` is referenced by the managed AGENTS block but is not present in this checkout. The OpenSpec CLI status/instructions output and `.codex/skills/openspec-apply-change/SKILL.md` were used as the apply authority.
