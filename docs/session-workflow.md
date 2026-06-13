# Session Workflow And Build Order

Use this as the restart point for multi-session roadmap work. The current product status lives in `docs/v2-prd.md`; active implementation scope lives in OpenSpec changes.

## Resume Checklist

1. Read `docs/development-standards.md`.
2. Read `docs/v2-prd.md` rows for the slice and record the target requirement IDs.
3. Read the relevant OpenSpec change, starting with `proposal.md`, `design.md`, and `tasks.md`.
4. Run `openspec list` and, for the active change, `openspec validate <change-id> --strict`.
5. Check `git status --short` and preserve unrelated worktree changes.
6. Implement only the next unchecked task group unless the user widens scope.

## Build Order

Use this order to choose the next slice. PRD refs are the rows to update in `docs/v2-prd.md` as the slice moves.

| Order | Slice | Primary PRD refs | OpenSpec direction | Done means |
|-------|-------|------------------|--------------------|------------|
| 1 | Trust policy hardening | Epic 1 `SEC-008`, `SEC-012`; Epic 3 `UX-003`; Epic 5 `PERF-011` | Apply `add-trust-level-policy-system` | Protected kinds, trust constants, evaluation order, RPC guard, Medium Trust UI/settings filtering, and tests are complete. |
| 2 | Durable per-site signing permissions | Epic 3 `UX-018` | Apply `fix-remembered-site-signing-policies` | Remembered allow from approval persists visible origin+kind rules, future matching unprotected requests auto-sign, protected kinds still require approval, and settings can revoke the rule. |
| 3 | Secure input and zeroization cleanup | Epic 1 `SEC-001`, `SEC-003`, `SEC-011`; Epic 8 `KEYMGMT-008` | Propose if no accepted change exists | Sensitive password/key material is removed from React state where practical, reveal/export paths are tightened, and zeroization coverage is verified. |
| 4 | Auto-lock and session proof | Epic 1 `SEC-012`, `SEC-013`; Epic 5 `PERF-008` | Propose if no accepted change exists | Timeout/session-grant behavior is proven across popup, side panel, background restart boundaries, and signing requests. |
| 5 | Security automation | Epic 1 `SEC-004`, `SEC-005`, `SEC-017`; Epic 5 `PERF-003`, `PERF-004`, `PERF-009` | Propose if no accepted change exists | CSP/build-output checks, secrets scanning, dependency audit, bundle-size guardrails, and memory-leak checks are in CI or documented local gates. |
| 6 | Approval intelligence and activity polish | Epic 1 `SEC-008`; Epic 3 `UX-001`, `UX-003`, `UX-006`, `UX-013` | Propose if no accepted change exists | NIP-aware previews, risk copy, richer activity filtering/search, result/date filters, and CSV export are shipped. |
| 7 | Developer contract | Epic 4 `DEV-002`, `DEV-006`, `DEV-010`, `DEV-013` | Propose if no accepted change exists | Public types, capability detection, versioning/deprecation rules, and concise dApp-facing docs are published. |
| 8 | Protocol depth | Epic 2 `PROTO-001`, `PROTO-002`, `PROTO-007`, `PROTO-008`, `PROTO-009`, `PROTO-011`, then `PROTO-003`, `PROTO-005`, `PROTO-006`, `PROTO-010`, `PROTO-012` | Use one focused change per NIP family | Explicit NIP support is implemented, tested, and reflected in capability/developer docs. |
| 9 | Sync and backup | Epic 6 `SYNC-001`, `SYNC-002`, `SYNC-003`, `SYNC-006`; Epic 1 `SEC-011`; Epic 8 `KEYMGMT-008` | Keep NIP-78/decentralized sync separate | Browser sync conflicts, encrypted backup formats, QR transfer, and backup/restore UX are complete. |

If a slice has no clean PRD home, amend `docs/v2-prd.md` before implementation rather than tracking it only in this workflow file.

## Per-Slice Workflow

1. If no accepted OpenSpec change exists, use the `openspec-propose` skill to create the proposal, design, specs, and tasks.
2. If an OpenSpec change exists and is ready for implementation, use the `openspec-apply-change` skill to work through the next unchecked tasks.
3. Confirm the PRD epic, version, and requirement IDs the slice is expected to move.
4. Implement domain/application logic first.
5. Add infrastructure/RPC wiring.
6. Add UI only after contracts are stable.
7. Add focused unit tests, then integration/E2E where the workflow crosses extension boundaries.
8. Update docs only for behavior users or dApp developers need to know.
9. Update `docs/v2-prd.md` statuses and roadmap notes with the actual shipped progress.
10. Run the verification gate.
11. Commit the completed slice and open a PR when the work is ready for review.
12. After the PR is accepted or merged, use the `openspec-archive-change` skill to sync/archive the change.

If implementation reveals a scope or design issue, update the OpenSpec artifacts before continuing.

## PRD Progress Rule

Treat `docs/v2-prd.md` as the progress ledger.

1. Move a row from `⬜` to `🔄` when a narrower shipped slice partially satisfies it.
2. Move a row to `✅` only when the full requirement wording is satisfied and verified.
3. Refresh the Current Implementation Snapshot and roadmap gap lists when user-visible, dApp-visible, or security behavior changes.
4. Before archiving an OpenSpec change, confirm the PRD rows, snapshot, and roadmap all match the shipped behavior.

## Git Handoff Gate

Commit and PR are the review handoff, not the start of a slice.

1. Confirm the work is on a feature branch for the slice before staging or committing.
2. Commit only after implementation, docs, PRD progress updates, and verification are complete for the chosen slice.
3. Include code, tests, OpenSpec artifacts, and PRD/doc updates needed to explain the same slice; leave unrelated worktree changes unstaged.
4. Open a draft PR if review should start but checks, product signoff, or follow-up cleanup are still pending.
5. Mark the PR ready only when the verification gate passes and the slice is ready to merge.
6. Archive OpenSpec after the PR is accepted or merged; use a follow-up commit/PR for archival if the implementation PR has already merged.

## Verification Gate

Always run the checks required by `docs/development-standards.md`.

For code changes, the default gate is:

- `openspec validate <change-id> --strict`
- `pnpm run compile`
- focused Vitest suites for changed logic
- relevant Playwright extension tests for approval, NIP-07, options, onboarding, or policy behavior
- `pnpm run build` and `pnpm run build:firefox` when extension wiring or build output changes
- `npx react-doctor@latest` until it reports `No issues found!` and `100 / 100`

For docs-only changes, verify local references and run `git diff --check`.

## Handoff Format

End each session with:

- what changed
- PRD requirement IDs moved or intentionally left unchanged
- what passed
- what could not run
- commit/PR status
- next unchecked task
- any scope that must remain deferred
