# CI Verification And Supply-Chain Gates

How Ostrilo's automated checks are configured, what blocks a merge, and why.

Established by the OpenSpec change `restore-security-test-assurance`.

## Why this document exists

Before this change, `.github/workflows/` contained exactly one workflow, and it
ran a React code-quality linter. Nothing ran the typechecker, the test suites,
the builds, or a dependency audit. 37 Vitest files and 19 Playwright specs had
no bearing on whether a change could merge, and a test committed red stayed red
without anyone noticing.

## Workflows

| Workflow | File | Trigger | Required |
|---|---|---|---|
| Verify | `verify.yml` | pull request, push to `main` | Yes (see below) |
| E2E | `e2e.yml` | nightly 03:00 UTC, dispatch, push to `main`, PR labelled `run-e2e` | No |
| React Doctor | `react-doctor.yml` | pull request, push to `main` | No |

### Verify

Three jobs, none using `continue-on-error`:

- **`verify`** — `pnpm install --frozen-lockfile`, `pnpm run compile`, `pnpm run test`.
  One Vitest invocation collects `tests/unit`, `tests/integration` and
  `tests/security`; `vitest.config.ts` excludes only `tests/e2e`.
- **`build`** — `pnpm run build` and `pnpm run build:firefox`.
- **`audit`** — `pnpm audit --audit-level high`.

`--frozen-lockfile` is not only about reproducibility. It also runs the
supply-chain policy declared in `pnpm-workspace.yaml`, so a lockfile containing
a trust-downgraded package fails the build rather than installing quietly.

### E2E is deliberately not required

The Playwright suite builds the extension, starts a fixture HTTP server and
drives a persistent Chromium extension context with `workers: 1` and
`retries: 2` on CI. That is where the real user-flow coverage lives, so it must
run often — but a flaky required check teaches contributors to re-run until
green and eventually to bypass the gate, which recreates false assurance in a
new place.

Promotion criteria: individual specs may become required once they have
demonstrated a stable pass rate across several weeks of nightly runs. Promote
per-spec, not wholesale. The suite must be green before a release tag.

## Audit threshold

`pnpm audit --audit-level high`. High and critical block; moderate and below are
reported but do not fail the build.

Rationale: this project's dependency tree is dominated by build tooling (wxt,
web-ext-run, esbuild) whose advisories usually cannot reach the shipped
extension. Blocking on moderate would produce steady noise against findings that
do not affect a user's keys, and a gate that is routinely overridden is not a
gate. High and critical are rare enough to be worth stopping for.

### Accepted exceptions

| Advisory | Package | Severity | Status |
|---|---|---|---|
| esbuild dev-server arbitrary file read on Windows | `esbuild` | low | Accepted. Below threshold. Affects `wxt dev` on Windows only; no release path. |

Two advisories were fixed rather than accepted when this gate was introduced:

- **`shell-quote`** GHSA-395f-4hp3-45gv (high, quadratic-complexity DoS in
  `parse()`). The workspace already had an override pinning `shell-quote` to
  `1.8.4` — which is itself the vulnerable version, since the advisory covers
  `<=1.8.4`. No `1.8.5` was ever published, so the override moved to `1.10.0`.
- **`adm-zip`** (high, crafted ZIP triggers a 4GB allocation; plus a moderate
  symlink-traversal advisory). Overridden to `0.6.1`, which clears both.

Both reach the tree through `wxt > web-ext-run`, so neither shipped in the
extension bundle. They were fixed anyway: a build machine holding signing keys
is a valuable target in its own right.

## Supply-chain policy

`pnpm-workspace.yaml` declares:

- `minimumReleaseAge: 1440` — a package must be at least 24 hours old. This
  delays adoption of a compromised release long enough for it to be pulled.
- `trustPolicy: no-downgrade` — a package cannot be installed if an earlier
  version carried provenance attestation and this one does not.

**Do not relax either setting to unblock an install.** They are what caught the
issues recorded above. When a package is refused, replace the untrusted edge
with a reviewed `overrides` entry naming an exact provenance-attested version.
An override is visible, diffable and revocable; a trust exception silently
disables the check for everything underneath it.

### Provenance review on sensitive updates

Record provenance status when updating any of `@noble/curves`, `@noble/hashes`,
`@scure/base`, `wxt`, `react`, or `react-dom`. A version that loses provenance
relative to an earlier release must not be adopted automatically; it needs a
recorded decision in the pull request that introduces it.

### Executable tooling is never fetched unpinned

React Doctor is an exact-version `devDependency` invoked through
`node_modules/.bin/react-doctor` via `pnpm run doctor`. `npx`, `pnpm dlx` and
`@latest` are not used anywhere in `package.json`, `.git/hooks/pre-commit`, or
`.claude/hooks/react-doctor.sh`.

The reason is specific: those invocations fetch a full transitive dependency
tree over the network and execute it after every file edit, on the machine that
holds this project's signing keys. Both hooks now run the pinned binary or fail
loudly — a security tool that could not run is a failure to report, never a
silent pass.

### React Doctor baseline

First successful run after pinning, 2026-09-13, react-doctor 0.9.14:

```
Score: 51 / 100    18 warnings, 17 findings across 11 files
```

All 11 are pre-existing and none is in a file the `restore-security-test-assurance`
change touched. Recorded as a baseline so later runs can be compared; the score
is reported, not gated. Before this change the tool had not run at all, because
every invocation was refused by the supply-chain policy.

## Making Verify required

Landing the workflow and making it required are deliberately separate steps, so
that whatever a clean runner surfaces gets fixed before the gate starts blocking.

To enable, in **Settings → Branches → Branch protection rules** for `main`,
require these status checks:

- `Typecheck and tests`
- `Extension builds`
- `Dependency audit`

Also enable "Require branches to be up to date before merging".

Do **not** add `Playwright extension suite` or `React Doctor`.

Verify the gate works by opening a pull request that deliberately breaks a
security test and confirming it cannot merge.

## Reproducible builds

A user installing a signer from a store cannot audit what they received. A
published checksum and a documented reproduce procedure are the difference
between trusting the source and trusting the publisher.

Toolchain recorded for release builds:

- Node 22 (CI), pnpm `11.5.2` (from `packageManager` in `package.json`)
- wxt `0.20.26`

**Measured, not assumed.** Two consecutive `pnpm run build` runs from the same
source and lockfile produce byte-identical JavaScript and `manifest.json`:

```
build 1: ee6f591ca2b286da0bd34c0461cf30f247c35349a0f6a41e4490d1d98a79adbf
build 2: ee6f591ca2b286da0bd34c0461cf30f247c35349a0f6a41e4490d1d98a79adbf
```

(combined SHA-256 over every `.js` file plus the manifest, 2026-09-13, Node
v24.16.0 / pnpm 11.5.2 / wxt 0.20.26.)

So the bundler output itself is already deterministic. The remaining known
nondeterministic input is archive metadata: `pnpm zip` records file timestamps.
Set `SOURCE_DATE_EPOCH` when producing release archives so those are fixed too.
That is where any remaining verification effort should go, not the bundle.

To reproduce and compare a release:

```bash
git checkout <release-tag>
pnpm install --frozen-lockfile
SOURCE_DATE_EPOCH=<epoch from the release notes> pnpm run build
shasum -a 256 .output/chrome-mv3/*.js .output/chrome-mv3/manifest.json
```

Compare against the checksums published with the release tag.
