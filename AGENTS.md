
## Development Standards

All development work must conform to `docs/development-standards.md`. Before editing, review the standards and the referenced source documents relevant to the change. After editing, verify the work with the checks required by the standards and report any command that could not run.

## UI Design System

All UI work must follow `docs/design/DESIGN_RULES.md`. Do not reintroduce gradients, accent rails, dot-grid backgrounds, the retired Arcade Plush class names, or pink/candy palette choices.

Judge a UI change in **both themes**, against a **populated** vault. The
screenshot runner does both:

```bash
pnpm run build
node docs/design-review/capture-screenshots.mjs
OSTRILO_DESIGN_REVIEW_THEME=dark node docs/design-review/capture-screenshots.mjs
```

Two invocations rather than one two-pass run: the runner drives onboarding from
an empty vault, and that happens once per browser profile. Its second phase
unlocks that vault and seeds a second key, a long key name, a cached profile,
three relays, three sites at different trust levels, signed and denied activity,
and a two-site approval queue. Decide from those captures. A fresh vault hides
layout bugs that appear only once a surface has rows in it — home cards shrinking
and clipping their rows survived a full design review that way. Deep Ink is a
role reassignment, not an inversion, so it cannot be inferred from the light
capture either.

Record what the review found in `docs/design-review/README.md`.

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

## aislop Verification

After code edits, run `pnpm run slop:changes` (which invokes `node_modules/.bin/aislop`). It scores what agents leave behind - narrative comments, swallowed exceptions, `as any` casts, console leftovers, dead code, oversized functions. Address the findings in the files you changed.

The same scan runs automatically after each edit batch through `.claude/hooks/aislop.sh`, so findings also arrive as context mid-task. Act on them in that turn.

Unlike React Doctor, this one gates. `.github/workflows/aislop.yml` fails a pull request whose changed files score below the `ci.failBelow` floor in `.aislop/config.yml`, and fails a push to `main` whose whole-project score falls below it. Reproduce a CI failure locally with `pnpm run slop:ci` - the scanner is deterministic, so the same tree always gives the same score.

The floor is a ratchet, not a target. Raise it as the warning backlog comes down; do not lower it to admit a change.

Do not disable a rule or suppress a finding to move the number. A finding that genuinely does not apply is suppressed on its own line, naming the rule and giving a reason: `// aislop-ignore-next-line <rule> -- why it does not apply`. Anything wider - `aislop-ignore-file`, or an `off` entry in the config - needs the same justification written down and is a change to the gate, not to the code.

`pnpm run slop:fix` applies only reversible mechanical fixes. Bare `aislop fix` and `aislop fix -f` delete code and prune dependencies on a heuristic; make those changes by hand.

Never invoke aislop with `npx`, `pnpm dlx`, or an `@latest` specifier, for the same reason as React Doctor, and for one more: an unpinned release changes the rule set the gate measures against. aislop's own installer and its published CI snippets both use unpinned invocations - do not copy them. The version is pinned exactly in `devDependencies` so CI and local runs agree.

## Blocking Verification

These stay blocking, and are not relaxed by the paragraph above:

- `pnpm run compile`
- `pnpm run test` (unit, integration and security suites)
- `pnpm run build` and `pnpm run build:firefox`
- the dependency audit

A code-quality score protects maintainability; the security suite protects the user's keys. Do not treat them as equivalent gates.
