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
| aislop | `aislop.yml` | pull request, push to `main` | No |
| Badges | `badges.yml` | push to `main`, dispatch | No |

### Verify

Four jobs, none using `continue-on-error`:

- **`verify`** — `pnpm install --frozen-lockfile`, `pnpm run compile`,
  `pnpm run lint`, `pnpm run test:coverage`. One Vitest invocation collects
  `tests/unit`, `tests/integration` and `tests/security`; `vitest.config.ts`
  excludes only `tests/e2e`. It fails below 80% lines, functions and statements
  or 70% branches overall, and below 90% (80% branches) in each of `src/domain`,
  `src/application` and `src/infrastructure`, where keys and the RPC boundary
  live.
- **`build`** — `pnpm run build` and `pnpm run build:firefox`, then the manifest
  and key-handling-bundle assertions against the built output with
  `OSTRILO_REQUIRE_BUILD_OUTPUT=1`.
- **`audit`** — `pnpm audit --audit-level high`.
- **`secrets`** — `gitleaks/gitleaks-action` over the commits the current push or
  pull request introduces. On both of those triggers the action passes
  `--log-opts=--no-merges --first-parent <base>^..<head>`, so the scan covers
  that commit range and not the repository's whole history. `fetch-depth: 0` on
  the checkout is what gives git the ancestry needed to resolve that range; a
  shallow clone cannot. PR commenting is disabled so the workflow keeps its
  read-only token; findings are reported through the job's exit code and run log.
  The job holds `pull-requests: read` in addition to `contents: read`: on a
  pull request the action resolves the commit range through the pulls API
  before scanning, and without that scope it failed with "Resource not
  accessible by integration" on every PR while passing on every push to main.

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

### Badges

The README's coverage, aislop and React Doctor badges read shields.io endpoint
files from the `badges` branch, which `badges.yml` rewrites on every push to
`main`. The branch holds one orphan commit, force-pushed each run, so it carries
the latest numbers and no history.

It is the only workflow with `contents: write`, and it is split so that the
write token never meets third-party code. The `measure` job installs
dependencies and runs the tools with a read-only token and without persisted
checkout credentials. The `publish` job holds the write token, installs
nothing, and refuses any value from `measure` that is not an integer.

It reports and does not gate: the thresholds live in `verify.yml` and
`aislop.yml`, and React Doctor is deliberately never a gate.

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
| GHSA-vfj7-8cjw-p6xm, stack exhaustion on deeply nested brace patterns | `braces` | high | Accepted 2026-10-06 via `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`. No patched release exists: the advisory names `>=3.0.4` and npm's latest is `3.0.3`. Reached only through `aislop` and `shadcn > micromatch`, which glob paths this repository supplies; no untrusted pattern reaches it. Remove the ignore the day a patched version is published. |
| GHSA-86w9-cpqp-85rv, PKCS#1 v1.5 verification accepts extra nested DigestAlgorithm elements | `node-forge` | high | Accepted 2026-10-06 via `auditConfig.ignoreGhsas`. No patched release exists: the advisory names `>=1.4.1` and npm's latest is `1.4.0`. Reached only through `wxt > web-ext-run > @devicefarmer/adbkit`, the Android debugging path, which nothing in this repository invokes. Remove the ignore the day a patched version is published. |

An ignored advisory is a hole in the gate with a name on it. Each entry in
`ignoreGhsas` has a row here, and a row here says why the finding cannot reach
the shipped extension or a developer's keys; an entry without a row is a change
to the gate with no record. A high or critical advisory **with** a patched
release is never ignored, it is overridden.

Three advisories were fixed by `overrides` on 2026-10-06, before the first
public release: `brace-expansion` (GHSA-6j4f-fj2g-mc7p, GHSA-qhr7-859c-m2p7),
`source-map-js` (GHSA-68fv-2mgg-jv7q) and `proxy-addr` (GHSA-jqcg-44mw-7w3h).
All three sit in dev tooling. `brace-expansion` is overridden within each of its
two majors, because its 5.x line is ESM-only and a single override would have
pushed the CommonJS consumers under `minimatch@3` onto it.

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

## Manifest and build-output assertions

`tests/security/manifest-assertions.test.ts` reads the generated
`.output/<target>/manifest.json` for both targets and asserts the content
security policy, the permission set, the web-accessible resource declaration,
the content-script match list, the manifest version, the absence of a persistent
background context, and the absence of any scaffold placeholder string. It also
asserts that the production bundles contain no `console` call, no `.map` file
and no `sourceMappingURL` comment.

Added by the OpenSpec change `harden-manifest-and-build`. The full policy and
the reasoning behind each value are in `docs/extension-manifest.md`.

It asserts on **generated output**, not on `wxt.config.ts`. That distinction is
the whole point: the Firefox `sidebar_action` block shipped for months carrying
WXT's scaffold placeholders, and none of them appear anywhere in the config.

**Known gap: the suite skips in CI today.** It needs real build output, so it
skips — with a message naming the required build command — when
`.output/<target>/manifest.json` is absent. The `verify` job runs `pnpm run test`
without building, and the `build` job builds without running tests, so in CI
these assertions currently skip rather than run.

Closing it is one line in `verify.yml`: add `pnpm run test:manifest` to the
`build` job, after the two build steps. That script builds both targets and then
runs this suite, so it is correct to run anywhere. Until that lands, the
assertions are a local and pre-commit gate only.

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

Scope the rule to `main` only. The `badges` branch is force-pushed by
`badges.yml`, so a rule matching it (for example `*`) must allow force pushes
from GitHub Actions, or the badges stop updating.

Verify the gate works by opening a pull request that deliberately breaks a
security test and confirming it cannot merge.

## Reproducible builds

A user installing a signer from a store cannot audit what they received. A
published checksum and a documented reproduce procedure are the difference
between trusting the source and trusting the publisher.

Toolchain pinned for release builds:

- Node: `.nvmrc` pins `22`, which is also the version every CI job installs.
  Before this pin there was no constraint at all — `openspec/project.md` merely
  described the development environment as "Node.js 24.x", which is not the same
  thing as requiring it.
- pnpm `11.5.2`, from `packageManager` in `package.json`.
- wxt `0.20.26`, an exact devDependency.

The determinism measurement below was taken on Node v24.16.0, before the pin.
Determinism *across* Node majors has not been measured; see the gap table.

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

### The exact release commands

```bash
git checkout <release-tag>
nvm use                                    # reads .nvmrc
corepack pnpm install --frozen-lockfile    # pnpm 11.5.2, from packageManager
SOURCE_DATE_EPOCH=<epoch from the release notes> pnpm run zip          # Chrome
SOURCE_DATE_EPOCH=<epoch from the release notes> pnpm run zip:firefox  # Firefox + sources
```

`pnpm run zip` and `pnpm run zip:firefox` build first, so they are the only two
commands a release needs. They produce, in `.output/`:

| Artifact | Contents |
|---|---|
| `ostrilo-<version>-chrome.zip` | The unpacked Chrome extension, minus the excluded files below. |
| `ostrilo-<version>-firefox.zip` | The same for Firefox. |
| `ostrilo-<version>-sources.zip` | The source archive AMO requires, built from an explicit allowlist. |

### What the archives may contain

Both are governed by explicit allowlists in `wxt.config.ts`, because both tool
defaults fail open: `zip.exclude` defaults to empty, so everything in the output
ships, and `zip.excludeSources` enumerates what to omit, so anything new is
included. Neither reads `.gitignore`.

- **Extension archive.** `zip.exclude` drops `**/*.map` and the unreferenced
  root `icon.png` (659 KB) and `icon.svg` (200 KB), which are copied from
  `public/` and pointed at by no manifest key — the `icons` block references the
  sized files `@wxt-dev/auto-icons` generates from `src/assets/icon.png`. Result:
  24 files, 1.2 MB.
- **Sources archive.** WXT's source filter is `include-match OR NOT
  exclude-match`, so `excludeSources: ["**/*"]` paired with an explicit
  `includeSources` allowlist makes the archive fail closed: a new top-level
  directory is excluded by default rather than shipped by default. Result: 169
  files, 1.8 MB, containing only `src/`, `public/`, `package.json`,
  `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `wxt.config.ts`, `tsconfig.json`,
  `components.json`, `LICENSE` and `README.md`.

  This one was a real finding, not a tidiness exercise. Under the defaults the
  sources archive was 4,701 files and 277 MB, of which 4,313 files came from
  `test-results/` — including `chromium-user-data/Default/Local Extension
  Settings`, the extension's own vault storage captured from end-to-end runs.
  That was the archive that would have been uploaded to Mozilla.

Verified after the change: extracting `ostrilo-<version>-sources.zip` into a
clean directory and running `pnpm install --frozen-lockfile && pnpm run
build:firefox` succeeds, and produces a `manifest.json` byte-identical to the
one built in the repository.

### Obtaining and comparing digests

```bash
# Per-file digests of the built extension
shasum -a 256 .output/chrome-mv3/manifest.json \
              .output/chrome-mv3/*.js \
              .output/chrome-mv3/chunks/*.js

# One digest for the whole build, order-stable
find .output/chrome-mv3 -type f \( -name '*.js' -o -name 'manifest.json' \) \
  | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256

# Digests of the published archives
shasum -a 256 .output/*.zip
```

Publish the archive digests with the release tag. A user who wants to check a
release rebuilds from the tag and compares the per-file digests, or compares the
whole-build digest.

### What still blocks a byte-identical comparison

| Gap | Status |
|---|---|
| No pinned Node version | **Fixed.** `.nvmrc` pins `22`. |
| No documented build procedure | **Fixed.** The commands above. |
| No published digests | **Fixed.** The procedure above; publishing them is a release-time step. |
| Archive timestamps | **Mitigated.** `pnpm zip` records file timestamps; set `SOURCE_DATE_EPOCH` when producing release archives. |
| Store re-signing | **Deferred, structural.** Both the Chrome Web Store and AMO re-sign uploads, so the installed artifact is never byte-identical to the uploaded one. Comparison has to be against the uploaded archive, or per-file against the unpacked install. |
| Cross-machine and cross-Node-major determinism | **Deferred, unverified.** Two consecutive builds on one machine are byte-identical (measured above). Nobody has built on two machines, or on two Node majors, and diffed the result. Until someone has, determinism is an assumption. A CI job that builds twice and diffs is the natural next step. |
