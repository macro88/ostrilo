
## Development Standards

All development work must conform to `docs/development-standards.md`. Before editing, review the standards and the referenced source documents relevant to the change. After editing, verify the work with the checks required by the standards and report any command that could not run.

## UI Design System

All UI work must follow `docs/design/DESIGN_RULES.md`. Do not reintroduce gradients, accent rails, dot-grid backgrounds, the retired Arcade Plush class names, or pink/candy palette choices.

## Driving the Extension

To see the extension actually run — screenshots, console and service-worker
output, a real signing flow — use the loop in `docs/agent-loop.md`. Scratch specs
are gitignored and CI never runs them; promote anything worth keeping into
`tests/e2e/`.

Judge UI from `pnpm run agent:loop:prod`. The agent build keeps its logs and is
unminified, which makes it right for debugging and wrong for deciding whether
something looks correct.

## React Doctor Verification

After code edits, run the pinned local tool with `pnpm run doctor` (which invokes `node_modules/.bin/react-doctor`). Address the findings in the files you changed. Do not disable or suppress a rule to lower the count; fix the cause or explain why the finding does not apply.

Report the score. Do not gate on it. A numeric target is only stable against a fixed rule set, and a blocking target creates pressure to silence rules rather than fix causes.

Never invoke React Doctor with `npx`, `pnpm dlx`, or an `@latest` specifier. That fetches an unpinned dependency tree over the network and executes it on a machine that holds this project's signing keys. If the pinned binary is missing, run `pnpm install --frozen-lockfile`; if the tool still cannot run, say so with the exact command and the verbatim error rather than treating a skipped run as a pass.

## Blocking Verification

These stay blocking, and are not relaxed by the paragraph above:

- `pnpm run compile`
- `pnpm run test` (unit, integration and security suites)
- `pnpm run build` and `pnpm run build:firefox`
- the dependency audit

A code-quality score protects maintainability; the security suite protects the user's keys. Do not treat them as equivalent gates.
