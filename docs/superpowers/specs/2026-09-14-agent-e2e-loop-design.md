# Agent E2E Loop — Design

Date: 2026-09-14
Status: approved for implementation planning

## Problem

An agent working on Ostrilo cannot see the extension run. It can read code and run
`vitest`, but every question about real behaviour — does this button work, what does
this screen look like, why does signing fail — costs a guess.

The repository already builds and drives the extension. `playwright.config.ts` loads
`.output/chrome-mv3` into a persistent Chromium context, `tests/e2e/fixtures/extension.ts`
opens the popup, options, and side panel, and `tests/e2e/agent-smoke.spec.ts` walks
onboarding through to a NIP-07 signature while capturing twelve screenshots. Measured on
this machine: 6.5–7.8 s per smoke run, five runs, zero flakes.

What is missing is a disposable lane through that harness, and the ability to see what
the extension said while it ran.

## Goal

An agent can open the extension, drive a flow, read screenshots and logs, change source,
rerun, and confirm the fix — and leave regression coverage behind.

## Non-goals

- A long-lived browser or CDP daemon. Rejected: it leaves an unauthenticated debugging
  port open on a machine holding signing keys.
- Hot reload. `wxt dev` is broken in this repository (see Constraints) and a full build
  costs 3.0 s.
- An MCP browser server. `chrome-devtools-mcp` works and its extension tools drive
  Ostrilo, but installing it means `npx @latest`, which `AGENTS.md` bans for this repo.
- Firefox. The fixture is Chromium-only; `pnpm run build:firefox` stays a blind gate.

## Constraints discovered

Each was measured, not assumed.

**`wxt dev` cannot be used.** WXT relaxes only `script-src` in serve mode, but
`EXTENSION_PAGES_CSP` (`wxt.config.ts:25-36`) also pins `connect-src`. The dev websocket
is blocked, so there is no HMR and no auto-reload, and pages render unstyled. Worse, in
MV3 serve mode WXT writes no `content_scripts` key and registers the script at runtime
over that same dead socket, so `window.nostr` is never injected.

**The production build has no logs.** `wxt.config.ts:154` drops `console` and `debugger`
when the mode is production. Every call site compiles to an empty function. An agent
debugging against `pnpm run test:e2e` sees nothing the extension said.

**`chrome.runtime.reload()` is a one-way trip.** In an automated Chromium the extension
does not come back: no service worker, and its pages return `ERR_BLOCKED_BY_CLIENT` for
the life of the browser.

**Privileged RPC needs no new seam.** Any extension page satisfies
`isTrustedExtensionSender` (`src/infrastructure/messaging/rpc-router.ts:82-92`), so the
popup is already a full RPC gateway. That is the seam the existing sixteen specs use.
Nothing under `src/` has to change, which keeps `tests/security/test-seam-safety.test.ts`
green.

## Design

### Build mode

The loop builds with `wxt build -m agent`, producing `.output/chrome-mv3-agent`.

Verified on this machine: 3.0 s; 35 `console.log`, 38 `console.warn` and 24
`console.error` calls preserved in `background.js`; manifest **byte-identical to
production**, including the static content script and the strict CSP; and no
`Debug (Dev Mode)` panel, which `-m development` does ship
(`src/ui/features/settings/components/AdvancedTab.tsx:66`).

The mode name matters. `wxt dev` and `wxt build -m development` both resolve to
`.output/chrome-mv3-dev` (`resolve-config.mjs:65-68`), so a stale `wxt dev` artifact —
the one with no content script — would sit exactly where a `-m development` build
belongs, and an mtime check cannot tell them apart. A private mode name removes the
collision.

`agent:loop:prod` runs the same spec against `.output/chrome-mv3`. Any screenshot judged
as UI, and any fix that must survive minification, goes through it.

### The scratch lane

Scratch specs are `tests/e2e/*.scratch.spec.ts`: gitignored, run by a second Playwright
project named `agent-scratch`, and excluded from `chromium-extension` by `testIgnore`.
`pnpm run test:e2e` pins `--project=chromium-extension`, so CI sees exactly today's
sixty-three tests.

The loop:

```bash
cp tests/e2e/fixtures/scratch-template.ts tests/e2e/loop.scratch.spec.ts
pnpm run agent:loop 2>&1 | tail -40
# read the screenshots and console.log, edit src/, rerun
cp tests/e2e/loop.scratch.spec.ts tests/e2e/<feature>.spec.ts   # promote
pnpm run agent:clean                                            # or discard
```

Headed by default, so the window is visible. `await page.pause()` halts the spec with
Playwright Inspector attached, which is how a human takes over mid-run.

Cost: source edit to screenshot about 8 s; spec-only edit 4–5 s, because the build is
skipped when nothing under `src/` is newer than the output manifest. The skip is disabled
under CI.

### Seeing what happened

**Screenshots.** `captureStepScreenshot` writes into
`test-results/agent/<mode>/<test-slug>/`. The mode goes in the path because a dev-mode
screenshot and a production screenshot must not be confusable on disk. `agent:loop`
clears `test-results/agent` first, so the directory holds one run.

**Console, including the service worker.** A new `tests/e2e/fixtures/diagnostics.ts`
registers `context.on("console")` and `context.on("weberror")` and writes `console.log`
beside the screenshots. `ConsoleMessage.worker()` is non-null for service-worker
messages, so every line is labelled `[sw]`, `[popup]` or `[dapp]`. This is the single
biggest capability the harness lacks today and costs about eighty lines.

Diagnostics writes to `testInfo.outputDir`, which Playwright cleans, and mirrors into the
screenshot root only when `OSTRILO_E2E_SCREENSHOT_DIR` is set. Wiring it unconditionally
into the shared fixture would otherwise add a directory per test to a tree nothing purges.

Merely opening the popup produces twenty-one console lines, nearly all RPC ping-pong, so
the failure summary prints errors first and the tail second.

**Redaction.** Before writing, `diagnostics.ts` masks anything matching
`nsec1[a-z0-9]{50,}` or a bare 64-hex string. No current call site logs key material —
the RPC path logs `message.type` and a status string — but the file persists whatever a
future careless `console.log(message)` emits.

### Guarding against the wrong build

The worst failure mode is debugging a stale or wrong-variant artifact: the fix appears not
to work, the logs look plausible, and the agent starts changing correct code. Three
mitigations, in order of strength:

1. The fixture reads the loaded `manifest.json` and throws unless `content_scripts` has
   exactly one entry, in the same named-remedy style as the existing "Built extension not
   found" throw (`tests/e2e/fixtures/extension.ts:35-39`). This converts the silent case
   into a loud one.
2. The rebuild decision is mtime-driven, not flag-driven, so the default path cannot skip
   a build it needed.
3. `console.log` opens with a fingerprint line recording the extension path, `background.js`
   size and mtime, and the mode.

### New files

| Path | Contents |
|---|---|
| `tests/e2e/fixtures/agent.ts` | What seven specs hand-roll today: `sendExtensionRpc`, `seedUnlockedVault`, `grantKindAllow`, `completeCreateKeyOnboarding`, `waitForApprovalPage`, `resolveNextApproval`. No new capability. |
| `tests/e2e/fixtures/diagnostics.ts` | Console and `weberror` capture, labelling, redaction, fingerprint. |
| `tests/e2e/fixtures/scratch-template.ts` | A compiling starting point. Type-checked by `pnpm run compile`, never run. |
| `tests/e2e/agent-screens.spec.ts` | Seeds a vault and screenshots popup, options, side panel and approval. No assertions. Committed, run only by the `agent-scratch` project. |
| `docs/agent-loop.md` | The runbook. |

### Modified files

| Path | Change |
|---|---|
| `playwright.config.ts` | Add the `agent-scratch` project with its own `outputDir`; add `testIgnore` for scratch specs to `chromium-extension`. |
| `tests/e2e/global-setup.ts` | Honour `OSTRILO_E2E_BUILD_MODE`; skip the build on mtime outside CI; pipe build output and print it only on failure. |
| `tests/e2e/fixtures/extension.ts` | Derive the extension path from the build mode; assert the manifest's provenance; attach diagnostics; navigate the initial `about:blank` page so `error-context.md` carries an ARIA snapshot. |
| `tests/e2e/fixtures/screenshots.ts` | Export `artifactDir(testInfo)`; resolve `OSTRILO_E2E_SCREENSHOT_DIR` to an absolute path; purge the run's directory. |
| `.gitignore` | `tests/e2e/*.scratch.spec.ts` |
| `AGENTS.md` | Link to `docs/agent-loop.md`. |

### Scripts

```json
"agent:build":     "wxt build -m agent",
"agent:loop":      "OSTRILO_E2E_BUILD_MODE=agent OSTRILO_E2E_HEADED=1 playwright test --project=agent-scratch",
"agent:loop:prod": "OSTRILO_E2E_HEADED=1 playwright test --project=agent-scratch",
"agent:screens":   "OSTRILO_E2E_BUILD_MODE=agent playwright test --project=agent-scratch tests/e2e/agent-screens.spec.ts",
"agent:clean":     "node -e \"fs.rmSync('test-results/agent',{recursive:true,force:true})\" && rm -f tests/e2e/*.scratch.spec.ts"
```

The `agent-scratch` project matches both `*.scratch.spec.ts` and `agent-screens.spec.ts`;
`chromium-extension` ignores both, so CI never runs either.

`agent:screens` seeds a vault and screenshots the four surfaces with no assertions. Most
visual questions are "what does this look like now", and that should cost one command
rather than a spec edit.

## Separate fix: stale screenshots

`test-results/e2e-screenshots/` is outside Playwright's `outputDir` and nothing purges it.
It currently holds eighteen files for a twelve-screenshot test — six orphans from an older
revision of the flow, still present after five fresh runs. An agent globbing that
directory to review the UI silently reads day-old screenshots of a different journey.

Fix: `captureStepScreenshot` clears a test's own screenshot directory the first time that
test writes to it within a run, so a directory holds the current run's captures and nothing
else. This applies to both `test-results/e2e-screenshots/` (the main suite) and
`test-results/agent/` (the scratch lane), and removes orphans left by a renamed or deleted
step without touching other tests' output.

## Security

- No production code changes, so no new test seam. `test-seam-safety.test.ts` scans `src/`
  and the top level of `tests/`; everything new lives in `tests/e2e/fixtures/`.
- No new RPC method, namespace, permission, or page. `PAGE_REACHABLE_NAMESPACES` and
  `LOCKED_REACHABLE_METHODS` are untouched, so `lock-gate.test.ts` and
  `rpc-privilege-boundary.test.ts` stay green.
- No daemon, no debugging port, no new listening socket. The only server remains the
  existing `http-server` on `127.0.0.1:8765`.
- No new dependency, so `pnpm audit` and the dependency trust policy are unaffected.
- The agent build restores logs that production strips. Containment: `.output/` and
  `test-results/` are gitignored and excluded from the AMO source archive, `wxt zip` never
  builds in this mode, the output directory is distinct, and captured logs are redacted and
  must not be pasted into commits or issues.
- Real Argon2id vaults are written under `test-results/` exactly as they are today. No warm
  profile is introduced outside that tree — the reason is recorded at `wxt.config.ts:126-129`,
  where 278 MB of Playwright output once reached the Mozilla source archive.

## Known traps, recorded rather than fixed

Out of scope by decision; they belong in `docs/agent-loop.md`.

- **The dev certificate expires and is then reused forever.** `make-dev-cert.ts` mints with
  `-days 1` but short-circuits on `existsSync` alone. The current cert reads
  `notAfter=Sep 14 15:27:12 2026 GMT`. Remedy when it bites: `rm -rf test-results/e2e-tls/`.
- **`reuseExistingServer` adopts an orphaned `http-server`** holding the old certificate in
  memory, and `ignoreHTTPSErrors` makes the health check pass anyway.
- **`pnpm exec playwright install chromium` is enforced nowhere.** The browser works on this
  machine only because another project seeded the shared cache; `~/Library/Caches/ms-playwright/.links`
  has no entry for this repository.
- **Node is v24.16.0 locally against `.nvmrc` 22**, which CI pins. Every timing here was
  measured on the wrong Node.
- **Rate limits apply within a run**, not just across runs: six disclosures per origin per
  minute, ten approval enqueues, five pending per origin, twenty global. A scratch spec
  signing eleven times throws `ApprovalRateLimitError`, which reads as a bug in the code
  under test.
- **`docs/TESTING.md` claims forty-seven tests in fourteen files.** Measured: sixty-three in
  sixteen, of which twenty-four are switched off.
- **`docs/design-review/capture-screenshots.mjs` is probably broken.** It drives an
  `http://127.0.0.1` origin, but the content script matches `https://*/*` only, and its
  backup-step selectors predate the transcription-verification gate. Not verified.

## Verification

The loop is proven by using it: drive the extension to find a real defect, fix it, and show
the before and after screenshots.

`pnpm run compile` type-checks `tests/e2e/**`, scratch specs included, so a half-written
scratch spec fails a blocking gate. Run `pnpm run agent:clean` before the gates.

Gates, unchanged from `AGENTS.md`: `pnpm run compile`, `pnpm run lint`, `pnpm run test`,
`pnpm run build`, `pnpm run build:firefox`, the dependency audit, and `pnpm run doctor`
reported but not gated. `pnpm run test:e2e` must stay at 39 passed, 24 skipped.
