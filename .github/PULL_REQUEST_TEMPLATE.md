## What this changes

<!-- What behaviour differs after this pull request, and why. Link the issue or
     the OpenSpec change directory this implements. -->

## Verification

Run these locally and tick what passed. If a command could not run, say so below
with the exact command and the verbatim error — a check that could not run is a
result to report, never a silent pass.

- [ ] `pnpm run compile`
- [ ] `pnpm run lint`
- [ ] `pnpm run test`
- [ ] `pnpm run build`
- [ ] `pnpm run build:firefox`
- [ ] `pnpm audit --audit-level high`
- [ ] Specs updated if behaviour changed (`openspec/` delta, or the change is archived)

Non-blocking, but run them and address findings in the files you changed. Never
disable a rule to move a number.

- [ ] `pnpm run doctor` — score: <!-- fill in -->
- [ ] `pnpm run slop:changes`

## If this touches the UI

- [ ] Follows [`docs/design/DESIGN_RULES.md`](https://github.com/macro88/ostrilo/blob/main/docs/design/DESIGN_RULES.md)
- [ ] Captured in **both themes** against a **populated** vault via
      `node docs/design-review/capture-screenshots.mjs` (light) and the same
      command with `OSTRILO_DESIGN_REVIEW_THEME=dark`

## If this touches cryptography or key handling

- [ ] Primitives stay in `src/infrastructure/crypto/`, reached through the ports
      in `src/application/ports/crypto.ts`
- [ ] Covered by a test in `tests/security/`

## Notes

<!-- Commands that could not run, follow-up work, anything a reviewer should
     know. If this fixes a vulnerability reported privately, coordinate through
     the advisory rather than describing the exploit here. -->
