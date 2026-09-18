---
name: aislop
description: Use after finishing a feature or a bugfix, before committing, or when the user types `/slop`, asks to scan for AI slop, or asks why the aislop score moved. Catches narrative comments, swallowed exceptions, `as any` casts, console leftovers, dead code and oversized functions. Deterministic, no LLM at runtime.
version: "1.0.0"
---

# aislop

Scores authorship habits 0-100: the patterns a coding agent leaves behind that
compile, pass tests, pass lint, and rot the codebase anyway.

It is the companion to [react-doctor](../react-doctor/SKILL.md), not a
replacement. React Doctor judges React correctness, accessibility and bundle
shape. aislop judges whether the code reads like someone meant it.

## After changing code

```bash
pnpm run slop:changes
```

Scores only the files you touched. Fix what it reports in those files before
moving on. The same scan runs automatically after each edit batch via
`.claude/hooks/aislop.sh`, so its findings also arrive as context mid-task -
act on them in that turn rather than deferring.

## Full sweep

```bash
pnpm run slop
```

Scores the whole tree. Work by severity: errors first, then warnings. Errors
are gated in CI; warnings are the backlog the floor is ratcheted against.

## Mechanical fixes

```bash
pnpm run slop:fix
```

`aislop fix --safe` - unused imports, import merging, narrative-comment
removal, and formatters that cannot load project-controlled config. Reversible
by construction, so it is safe to run and commit.

Do not reach for bare `aislop fix` or `aislop fix -f` here. They delete code,
prune dependencies and run lint autofixes, which in this repository means
touching a signer's source on the strength of a heuristic. Make those changes
by hand.

## Suppressions

A finding that genuinely does not apply is suppressed inline, with the rule
named and a reason after `--`:

```ts
// aislop-ignore-next-line ai-slop/hidden-fallback -- options is validated in the caller
const opts = { ...defaults, ...(input || {}) };
```

Never widen this to silence a count: no bare `aislop-ignore-file`, and no
turning a rule off in `.aislop/config.yml` to make a number move. Fix the
cause, or write down why the finding is wrong. A reader who disagrees with the
reason can then argue with it.

## Explaining and tuning rules

```bash
pnpm exec aislop rules            # every rule, severity, fixability, score impact
pnpm exec aislop rules --search   # searchable explorer
pnpm exec aislop doctor           # which engines can run on this machine
```

Severity overrides live under `rules:` in `.aislop/config.yml`.

## Never use npx

Always the pinned binary, through `pnpm run slop*` or `pnpm exec aislop`.
Never `npx aislop@latest`, `pnpm dlx`, or any `@latest` specifier - that
fetches and executes an unpinned dependency tree on a machine holding this
project's signing keys, and it changes the rule set the score is measured
against. If the binary is missing, run `pnpm install --frozen-lockfile`; if it
still cannot run, report the exact command and the verbatim error rather than
treating a skipped scan as a pass.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run slop` | Scan the whole project |
| `pnpm run slop:changes` | Scan only files changed vs HEAD |
| `pnpm run slop:fix` | Apply reversible mechanical fixes |
| `pnpm run slop:ci` | Run the CI gate exactly as the workflow does |
