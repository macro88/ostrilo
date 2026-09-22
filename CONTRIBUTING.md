# Contributing to Ostrilo

Ostrilo is a browser extension that holds Nostr private keys and signs events on
the user's behalf. That shapes everything below: changes are reviewed for what
they do to the user's keys first and for everything else second.

Documentation corrections, accessibility findings, and tests covering refusal,
locking and recovery are all genuinely useful contributions, and none of them
require touching cryptography.

**Found a vulnerability? Do not open an issue.** Read
[SECURITY.md](SECURITY.md) and use the private channel described there.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## The one thing to read first

[`AGENTS.md`](AGENTS.md) is this repository's working contract: the design-system
rules, the screenshot workflow, the React Doctor and aislop policies, and the
blocking verification gate. It is addressed to coding agents, but the rules are
the same for humans, and it is kept current because every agent session reads it.
**Read it before your first change.** This guide is the human-facing entry point
and deliberately does not restate it.

The binding standards themselves live in
[`docs/development-standards.md`](docs/development-standards.md), with the
architecture in [`docs/architecture_primer.md`](docs/architecture_primer.md) and
[`docs/developers_readme.md`](docs/developers_readme.md).

## Setup

- **Node.js 22** — the major version pinned in [`.nvmrc`](.nvmrc) and used by CI.
- **pnpm 11.5.2** — pinned in the `packageManager` field of
  [`package.json`](package.json). Use Corepack or match it exactly; a different
  pnpm can rewrite the lockfile.
- Git and a desktop browser.

```sh
git clone https://github.com/macro88/ostrilo.git
cd ostrilo
pnpm install --frozen-lockfile
pnpm run build
```

`--frozen-lockfile` is not optional. It also runs the supply-chain policy
declared in `pnpm-workspace.yaml`, so a lockfile carrying a trust-downgraded
package fails here rather than in CI.

Load `.output/chrome-mv3` as an unpacked extension in Chromium, or
`.output/firefox-mv3/manifest.json` as a temporary add-on in Firefox. The README
has the [step-by-step version](README.md#get-started). `pnpm run dev` and
`pnpm run dev:firefox` give you WXT's watch modes, but judge release behaviour
from a production build.

## Start with a proposal, not a pull request

**This is the least obvious thing about the repository, and the most likely to
waste your first afternoon.** Substantive changes — new behaviour, changed
behaviour, anything touching the security model — begin as an OpenSpec change
under `openspec/changes/`, not as a pull request against `src/`.

Specifications are the source of truth here. They live in
`openspec/specs/<capability>/spec.md`, one directory per capability
(`key-vault`, `session-auto-lock`, `rpc-privilege-boundary`, and so on), and
they are written as requirements, not descriptions. A change proposes a **delta**
against them.

A change directory contains:

- `proposal.md` — **Why** (the defect or gap, cited to specific files and lines),
  **What Changes** (the decisions, stated as outcomes), **Capabilities** (which
  capability specs are added to or modified), and **Impact** (files, specs, tests
  and docs affected, plus an explicit *Not in scope*).
- `design.md` — the reasoning and the alternatives that were rejected.
- `tasks.md` — a numbered checklist worked through in order, ending in a
  verification section that runs the gate below.
- `specs/<capability>/spec.md` — the delta itself. Sections are
  `## ADDED Requirements`, `## MODIFIED Requirements` or `## REMOVED
  Requirements`; each holds a `### Requirement:` written with SHALL, followed by
  `#### Scenario:` blocks in GIVEN / WHEN / THEN form.

Implementation follows the approved proposal. Once it ships, the delta is merged
into the main specs and the change is archived to
`openspec/changes/archive/<YYYY-MM-DD>-<change-id>/`.

Read one end to end before writing your own —
`openspec/changes/archive/2026-09-20-gate-autosign-activity-on-idle/` is a good
example of the expected depth, and
[`openspec/project.md`](openspec/project.md) carries the project context that
proposals are written against.

**What does not need a proposal:** typo and documentation fixes, a test for
existing behaviour, a dependency bump, or an obvious bug fix that changes no
specified requirement. If you are unsure, open a draft pull request containing
just the proposal's `## Why` section and ask there — a paragraph is cheaper than
writing either artifact twice, and the issue tracker takes bug reports only.

## The verification gate

These are blocking. Run them locally before you open a pull request; CI
(`.github/workflows/verify.yml`) runs them again, plus a secret scan.

```sh
pnpm run compile            # tsc --noEmit
pnpm run lint               # one rule: crypto libraries stay in the adapter directory
pnpm run test               # unit, integration and security suites
pnpm run build              # Chromium MV3
pnpm run build:firefox      # Firefox MV3
pnpm audit --audit-level high
```

E2E tests (`pnpm run test:e2e`) run on their own schedule rather than as a
required check, because a flaky required check teaches people to re-run until
green. Run them for changes to user-facing workflows. See
[testing](docs/TESTING.md) and [CI verification](docs/ci-verification.md).

If a required command cannot run, say so in the pull request with the exact
command and the verbatim error. A check that could not run is a result to
report, never a silent pass.

## The non-blocking tools

```sh
pnpm run doctor         # React Doctor — report the score, do not gate on it
pnpm run slop:changes   # aislop — scores what agents leave behind
```

Address the findings in the files you changed.

**A rule is never disabled to move a number.** Fix the cause, or explain why the
finding does not apply. A finding that genuinely does not apply is suppressed on
its own line, naming the rule and giving the reason:
`// aislop-ignore-next-line <rule> -- why it does not apply`. Anything wider —
`aislop-ignore-file`, or an `off` entry in `.aislop/config.yml` — is a change to
the gate rather than to the code, and needs its justification written down.

aislop does gate pull requests: `.github/workflows/aislop.yml` fails a pull
request whose changed files score below the `ci.failBelow` floor in
`.aislop/config.yml` (currently 70). The floor is a ratchet — raise it as the
warning backlog comes down, never lower it to admit a change. Reproduce a CI
failure locally with `pnpm run slop:ci`; the scanner is deterministic.

Never invoke either tool with `npx`, `pnpm dlx`, or an `@latest` specifier. That
fetches an unpinned dependency tree and executes it on a machine that may hold
signing keys, and for aislop it also changes the rule set the gate measures
against. Both are pinned in `devDependencies`; if a binary is missing, run
`pnpm install --frozen-lockfile`.

## Cryptography stays behind the ports

Cryptographic primitives live in `src/infrastructure/crypto/` and nowhere else.
Every other layer reaches them through the ports in
`src/application/ports/crypto.ts` — `CryptoAead`, `CryptoKdf`, `Schnorr`,
`CryptoHash`, `Bech32Codec` — and receives an adapter by injection.

This is enforced, not advisory. `eslint.config.js` fails any `@noble/*` or
`@scure/*` import outside the adapter directory, and
`tests/security/crypto-single-implementation.test.ts` fails if a primitive gains
a second implementation anywhere under `src/` — including inside the adapter
directory, where the import itself is legitimate. If you need a primitive that
has no port, add the port; do not add the import.

The same inward-pointing rule governs the rest of the hexagonal architecture:
domain depends on nothing, application on domain, infrastructure on both, and UI
reaches application services through RPC rather than touching storage or crypto
directly.

## UI work

Follow the [Inkline design rules](docs/design/DESIGN_RULES.md). Do not
reintroduce gradients, accent rails, dot-grid backgrounds, retired Arcade Plush
class names, or pink/candy palette choices.

Judge every UI change **in both themes, against a populated vault**:

```sh
pnpm run build
node docs/design-review/capture-screenshots.mjs
OSTRILO_DESIGN_REVIEW_THEME=dark node docs/design-review/capture-screenshots.mjs
```

Two invocations rather than one two-pass run: the runner drives onboarding from
an empty vault, and that happens once per browser profile. Its second phase
unlocks that vault and seeds a second key, a long key name, a cached profile,
three relays, three sites at different trust levels, signed and denied activity,
and a two-site approval queue.

A fresh vault hides layout bugs that only appear once a surface has rows in it —
home cards shrinking and clipping their rows survived a full design review that
way. The dark theme is a role reassignment rather than an inversion, so it cannot
be inferred from the light capture either. Record what the review found in
[`docs/design-review/README.md`](docs/design-review/README.md).

## Pull requests

- Branch from `main`. Conventional commit messages are preferred.
- Keep the change scoped to one thing. A refactor bundled with a behaviour change
  is two reviews wearing one hat.
- Fill in [the pull request checklist](.github/PULL_REQUEST_TEMPLATE.md), and say
  which gate commands you actually ran.
- **Update the specs if behaviour changed.** A pull request that changes
  specified behaviour without its spec delta is incomplete.
- Keep roadmap intentions separate from verified behaviour, in code comments,
  documentation and the pull request description alike.

## Reporting bugs

Use the [bug report form](.github/ISSUE_TEMPLATE/bug_report.yml). It asks for the
browser, the source revision you built, reproduction steps and the expected
result, because without those a signer bug usually cannot be reproduced at all.

Remove keys and personal data first. Never paste an `nsec`, a hex private key, a
passphrase or a vault file into an issue — not even one you believe is disposable.

Security vulnerabilities do not belong in the issue tracker at all. They go
through [SECURITY.md](SECURITY.md).
