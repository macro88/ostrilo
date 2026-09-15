# Agent E2E Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an agent a disposable lane through the existing Playwright harness, so it can drive the extension, read screenshots and console output, change source, and rerun.

**Architecture:** A second Playwright project (`agent-scratch`) runs gitignored `*.scratch.spec.ts` files against a private `-m agent` build. A new diagnostics fixture captures page and service-worker console into a file beside the screenshots. Nothing under `src/` changes.

**Tech Stack:** Playwright 1.63, WXT 0.20.26, pnpm, TypeScript, Node 22 (`.nvmrc`).

**Spec:** `docs/superpowers/specs/2026-09-14-agent-e2e-loop-design.md`

## Global Constraints

- **Nothing under `src/` may change.** `tests/security/test-seam-safety.test.ts` walks every file under `src/` and fails on any import matching `tests/`, `vitest`, or `@playwright/*`.
- **No new file at the top level of `tests/`.** Rule 7.4 of the same suite rejects any non-`.test.`/`.spec.` file there. Everything new goes in `tests/e2e/fixtures/`.
- **No new RPC method, namespace, or permission.** `lock-gate.test.ts` and `rpc-privilege-boundary.test.ts` enumerate them and fail on change.
- **`pnpm run test:e2e` must stay at 39 passed, 24 skipped.** It pins `--project=chromium-extension`.
- **No new runtime or dev dependency.**
- **Build mode name is `agent`**, producing `.output/chrome-mv3-agent`. Never `development` — that collides with `pnpm dev`.
- **Fixture server origin is `https://localhost:8765`.** The content script matches `https://*/*` only.
- Blocking gates (`AGENTS.md`): `pnpm run compile`, `pnpm run lint`, `pnpm run test`, `pnpm run build`, `pnpm run build:firefox`, dependency audit. `pnpm run doctor` is reported, not gated.

## File Structure

| File | Responsibility |
|---|---|
| `tests/e2e/fixtures/diagnostics.ts` | Capture console + weberror, label by source, redact secrets, write `console.log`. |
| `tests/e2e/fixtures/agent.ts` | RPC helper, vault seeding, policy grants, approval helpers. Consolidates what seven specs hand-roll. |
| `tests/e2e/fixtures/scratch-template.ts` | Compiling starting point to copy. Type-checked, never run. |
| `tests/e2e/agent-screens.spec.ts` | Seeds and screenshots four surfaces, no assertions. Committed; `agent-scratch` project only. |
| `tests/e2e/fixtures/extension.ts` | *(modify)* Build-mode path, manifest provenance assertion, attach diagnostics, navigate `pages()[0]`. |
| `tests/e2e/fixtures/screenshots.ts` | *(modify)* Export `artifactDir`, resolve dir to absolute, purge per test per run. |
| `tests/e2e/global-setup.ts` | *(modify)* Build mode, mtime skip, quiet-on-success. |
| `playwright.config.ts` | *(modify)* `agent-scratch` project with own `outputDir`; `testIgnore` on `chromium-extension`. |
| `docs/agent-loop.md` | Runbook, including the known traps. |

---

### Task 1: Screenshot directory purge and `artifactDir`

Fixes the audit's top-ranked friction: `test-results/e2e-screenshots/` is outside Playwright's `outputDir`, nothing purges it, and it currently holds six orphan PNGs from an older revision of the smoke flow.

**Files:**
- Modify: `tests/e2e/fixtures/screenshots.ts`

**Interfaces:**
- Produces: `artifactDir(testInfo: TestInfo): string` — absolute path to this test's artifact directory. `captureStepScreenshot(page, testInfo, name): Promise<string>` — unchanged signature.

- [ ] **Step 1: Verify the stale-orphan problem exists**

```bash
ls -1 test-results/e2e-screenshots/chromium-extension/*/ | wc -l
```
Expected: more files than the 12 the smoke test writes (currently 18). If the directory is absent, run `pnpm run test:e2e:smoke` once first.

- [ ] **Step 2: Replace the path computation with `artifactDir` and add the purge**

Replace the body of `tests/e2e/fixtures/screenshots.ts` between the imports and `captureStepScreenshot` with:

```ts
const DEFAULT_SCREENSHOT_DIR = path.join(
  process.cwd(),
  "test-results",
  "e2e-screenshots"
);

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/**
 * Absolute artifact directory for one test. `OSTRILO_E2E_SCREENSHOT_DIR` is
 * resolved rather than used verbatim: `testInfo.attach({ path })` resolves a
 * relative path against the worker cwd, which is not the repo root when a
 * command is run from a subdirectory.
 */
export function artifactDir(testInfo: TestInfo): string {
  const root = process.env.OSTRILO_E2E_SCREENSHOT_DIR
    ? path.resolve(process.env.OSTRILO_E2E_SCREENSHOT_DIR)
    : DEFAULT_SCREENSHOT_DIR;
  return path.join(
    root,
    testInfo.project.name,
    slug(testInfo.titlePath.join(" "))
  );
}

/**
 * This tree sits outside Playwright's `outputDir`, so Playwright never cleans
 * it. Without this, a renamed or deleted step leaves its PNG behind forever and
 * anything reading the directory to review the current UI silently sees a
 * screenshot of a flow that no longer exists.
 *
 * Purged once per test per run, on first write, so the steps within a test
 * accumulate normally.
 */
const purged = new Set<string>();

async function purgeOnce(dir: string): Promise<void> {
  if (purged.has(dir)) return;
  purged.add(dir);
  await fs.rm(dir, { recursive: true, force: true });
}
```

Add `TestInfo` to the type import at the top (it is already imported).

- [ ] **Step 3: Call the purge from `captureStepScreenshot`**

Replace the first four lines of `captureStepScreenshot`'s body with:

```ts
  const dir = artifactDir(testInfo);
  await purgeOnce(dir);
  const screenshotPath = path.join(dir, `${slug(name)}.png`);
```

Leave the `fs.mkdir`, `page.screenshot` and `testInfo.attach` calls as they are.

- [ ] **Step 4: Verify the purge works and paths are unchanged**

```bash
touch test-results/e2e-screenshots/chromium-extension/*/99-orphan.png
pnpm run test:e2e:smoke 2>&1 | tail -5
ls -1 test-results/e2e-screenshots/chromium-extension/*/ | wc -l
```
Expected: smoke passes, and the count is exactly 12 — the orphan and the six old orphans are gone.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/screenshots.ts
git commit -m "fix(e2e): purge a test's screenshot directory once per run

The tree sits outside Playwright's outputDir, so nothing cleaned it. A
renamed step left its PNG behind forever, and anything reading the
directory to review the UI saw a flow that no longer exists."
```

---

### Task 2: Diagnostics — console and service-worker capture

The single biggest capability the harness lacks. Today a failing run tells you what Playwright asserted, never what the extension said.

**Files:**
- Create: `tests/e2e/fixtures/diagnostics.ts`

**Interfaces:**
- Consumes: `artifactDir` from Task 1.
- Produces: `attachDiagnostics(context: BrowserContext, testInfo: TestInfo, meta: { extensionPath: string; mode: string }): () => Promise<void>` — registers listeners, returns a flush function to call at teardown.

- [ ] **Step 1: Write the file**

```ts
import fs from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, TestInfo } from "@playwright/test";
import { artifactDir } from "./screenshots";

type Line = { t: number; type: string; source: string; text: string };

/**
 * No current call site logs key material — the RPC path logs `message.type`
 * and a status string. But this file persists whatever a future careless
 * `console.log(message)` emits, so mask the two shapes that matter before
 * anything reaches disk.
 */
function redact(text: string): string {
  return text
    .replace(/\bnsec1[a-z0-9]{50,}\b/gi, "[nsec redacted]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[64-hex redacted]");
}

export function attachDiagnostics(
  context: BrowserContext,
  testInfo: TestInfo,
  meta: { extensionPath: string; mode: string }
): () => Promise<void> {
  const lines: Line[] = [];
  const started = Date.now();

  context.on("console", (msg) => {
    const worker = msg.worker();
    const page = msg.page();
    const source = worker
      ? `sw ${path.basename(new URL(worker.url()).pathname)}`
      : page
        ? path.basename(new URL(page.url()).pathname) || page.url()
        : "unknown";
    lines.push({
      t: Date.now() - started,
      type: msg.type(),
      source,
      text: redact(msg.text()),
    });
  });

  context.on("weberror", (err) => {
    lines.push({
      t: Date.now() - started,
      type: "uncaught",
      source: path.basename(new URL(err.page().url()).pathname),
      text: redact(err.error().stack ?? String(err.error())),
    });
  });

  return async function flush(): Promise<void> {
    let fingerprint = `# extension=${meta.extensionPath} mode=${meta.mode}`;
    try {
      const bg = statSync(path.join(meta.extensionPath, "background.js"));
      fingerprint += ` background.js ${bg.size} bytes mtime ${bg.mtime.toISOString()}`;
    } catch {
      fingerprint += " background.js MISSING";
    }

    const body = lines
      .map((l) => `[${String(l.t).padStart(6)}ms] ${l.type.padEnd(8)} ${l.source} :: ${l.text}`)
      .join("\n");

    // testInfo.outputDir is cleaned by Playwright. The screenshot tree is only
    // written when a run explicitly asks for it, so the main suite does not
    // sprout a directory per test in a tree nothing purges.
    const targets = [testInfo.outputDir];
    if (process.env.OSTRILO_E2E_SCREENSHOT_DIR) targets.push(artifactDir(testInfo));

    for (const dir of targets) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "console.log"), `${fingerprint}\n${body}\n`, "utf8");
    }
    await testInfo.attach("console.log", {
      path: path.join(testInfo.outputDir, "console.log"),
      contentType: "text/plain",
    });

    // Opening the popup alone produces ~21 lines of RPC ping-pong, so errors
    // lead. A plain tail would bury them.
    if (testInfo.status !== testInfo.expectedStatus) {
      const errors = lines.filter((l) => l.type === "error" || l.type === "uncaught");
      if (errors.length) {
        console.error(`\n--- extension errors (${errors.length}) ---`);
        for (const l of errors) console.error(`${l.source} :: ${l.text}`);
      }
      console.error(`--- last 20 console lines ---`);
      for (const l of lines.slice(-20)) console.error(`${l.type} ${l.source} :: ${l.text}`);
    }
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run compile`
Expected: PASS. If `msg.worker()` errors as unknown, confirm `playwright-core` is 1.63 — the method landed there.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/fixtures/diagnostics.ts
git commit -m "feat(e2e): capture page and service-worker console to a file

A failing run reported what Playwright asserted and never what the
extension said. ConsoleMessage.worker() distinguishes MV3 service-worker
output from page output, so each line carries its source."
```

---

### Task 3: Build-mode path, provenance assertion, diagnostics wiring

The `content_scripts` assertion converts the spec's stated worst failure mode — silently debugging a build with no `window.nostr` — from silent into loud.

**Files:**
- Modify: `tests/e2e/fixtures/extension.ts`

**Interfaces:**
- Consumes: `attachDiagnostics` from Task 2.
- Produces: unchanged fixture names (`extensionContext`, `extensionId`, `openPopup`, `openSidepanel`, `openOptions`).

- [ ] **Step 1: Replace the hard-coded extension path**

Replace line 19 (`const extensionPath = ...`) with:

```ts
const buildMode = process.env.OSTRILO_E2E_BUILD_MODE ?? "production";
// WXT maps {production: "", development: "-dev"} and otherwise `-${mode}`
// (resolve-config.mjs). `agent` therefore lands in .output/chrome-mv3-agent,
// which `pnpm dev` can never write to.
const outputSuffix = buildMode === "production" ? "" : `-${buildMode}`;
const extensionPath = path.resolve(
  process.cwd(),
  ".output",
  `chrome-mv3${outputSuffix}`
);
```

- [ ] **Step 2: Add the provenance assertion after the existing "not found" throw**

Immediately after the `if (!fs.existsSync(extensionPath)) { ... }` block:

```ts
    // A `wxt dev` artifact has no `content_scripts` key — WXT registers the
    // script at runtime over a websocket this repo's connect-src blocks — so
    // `window.nostr` is never injected. Same directory shape, no content
    // script, and the failure reads as a bug in the code under test.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8")
    );
    if (manifest.content_scripts?.length !== 1) {
      throw new Error(
        `Extension at ${extensionPath} has ${manifest.content_scripts?.length ?? 0} content_scripts, expected 1. ` +
          `This is a 'wxt dev' artifact, not a build. Run: pnpm run agent:build`
      );
    }
```

- [ ] **Step 3: Reuse the initial page, and attach diagnostics**

Playwright's fallback ARIA snapshot in `error-context.md` comes from
`context.pages()[0]`, which `launchPersistentContext` leaves at `about:blank`
because every fixture calls `newPage()`. Handing that page to the first opener
makes the snapshot show the real UI, and benefits all 16 specs.

Immediately after `launchPersistentContext` returns, before `await use(context)`:

```ts
    const flush = attachDiagnostics(context, testInfo, {
      extensionPath,
      mode: buildMode,
    });
```

Then replace the three `open*` fixtures' `extensionContext.newPage()` call with a
shared helper defined above `test.extend`:

```ts
/**
 * error-context.md snapshots context.pages()[0]. A persistent context opens it
 * at about:blank and every fixture used to call newPage(), so that snapshot was
 * always empty. Hand the blank page to the first caller instead.
 */
async function openExtensionPage(
  context: BrowserContext,
  url: string
): Promise<Page> {
  const blank = context.pages().find((p) => p.url() === "about:blank");
  const page = blank ?? (await context.newPage());
  await page.goto(url);
  return page;
}
```

and have each opener call it, e.g. for `openPopup`:

```ts
    const open = async () =>
      openExtensionPage(extensionContext, `chrome-extension://${extensionId}/popup.html`);
```

Do the same for `openSidepanel` (`sidepanel.html`) and `openOptions` (`options.html`).

Then in the existing `finally`, before `context.close()`:

```ts
    } finally {
      await flush().catch(() => {});
      await context.close();
    }
```

Add the import: `import { attachDiagnostics } from "./diagnostics";`

- [ ] **Step 4: Verify the whole suite is unchanged**

Run: `pnpm run test:e2e 2>&1 | tail -5`
Expected: `39 passed, 24 skipped`. Any other number means the shared fixture broke something.

- [ ] **Step 5: Verify the provenance assertion fires**

```bash
node_modules/.bin/wxt build -m agent
python3 - <<'PY'
import json,pathlib
p=pathlib.Path('.output/chrome-mv3-agent/manifest.json'); m=json.loads(p.read_text())
cs=m.pop('content_scripts'); p.write_text(json.dumps(m))
pathlib.Path('/tmp/cs.json').write_text(json.dumps(cs))
PY
OSTRILO_E2E_BUILD_MODE=agent OSTRILO_E2E_SKIP_BUILD=1 pnpm exec playwright test tests/e2e/agent-smoke.spec.ts 2>&1 | grep -c "not a build"
```
Expected: at least 1. Then restore: `node_modules/.bin/wxt build -m agent`.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/fixtures/extension.ts
git commit -m "feat(e2e): select build by mode and assert the artifact's provenance

A wxt dev artifact registers its content script at runtime over a socket
this repo's connect-src blocks, so window.nostr is never injected. It
otherwise looks like a build. Refuse to run against one by name."
```

---

### Task 4: Global setup — build mode, staleness skip, quiet output

**Files:**
- Modify: `tests/e2e/global-setup.ts`

**Interfaces:**
- Produces: honours `OSTRILO_E2E_BUILD_MODE`, `OSTRILO_E2E_SKIP_BUILD`, `OSTRILO_E2E_FORCE_BUILD`.

- [ ] **Step 1: Rewrite the default export**

```ts
import path from "node:path";
import { spawnSync } from "node:child_process";
import { statSync, existsSync, readdirSync } from "node:fs";

function localBin(name: string): string {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  return path.resolve(process.cwd(), "node_modules", ".bin", executable);
}

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs);
  }
  return newest;
}

export default async function globalSetup() {
  const mode = process.env.OSTRILO_E2E_BUILD_MODE ?? "production";
  const suffix = mode === "production" ? "" : `-${mode}`;
  const outputManifest = path.resolve(process.cwd(), ".output", `chrome-mv3${suffix}`, "manifest.json");

  if (process.env.OSTRILO_E2E_SKIP_BUILD === "1") return;

  // Never skip under CI: a stale artifact there is a wrong green, not a
  // saved three seconds.
  if (!process.env.CI && !process.env.OSTRILO_E2E_FORCE_BUILD && existsSync(outputManifest)) {
    const built = statSync(outputManifest).mtimeMs;
    const sources = Math.max(
      newestMtime(path.resolve(process.cwd(), "src")),
      ...["wxt.config.ts", "package.json", "tsconfig.json"].map((f) =>
        statSync(path.resolve(process.cwd(), f)).mtimeMs
      )
    );
    if (sources < built) {
      console.log(`[global-setup] reusing ${mode} build (sources unchanged)`);
      return;
    }
  }

  const args = mode === "production" ? ["build"] : ["build", "-m", mode];
  // The build emits ~45 lines of Rollup @__PURE__ and chunk-size warnings on
  // every run, which buries the result when output is tailed.
  const result = spawnSync(localBin("wxt"), args, { cwd: process.cwd(), encoding: "utf8" });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`wxt build failed with exit code ${result.status}`);
  }
  console.log(`[global-setup] built chrome-mv3${suffix} (${mode})`);
}
```

- [ ] **Step 2: Verify CI behaviour is unchanged**

```bash
CI=true pnpm run test:e2e 2>&1 | tail -5
```
Expected: `39 passed, 24 skipped`, and a build ran (no "reusing" line).

- [ ] **Step 3: Verify the skip works locally**

```bash
pnpm run test:e2e:smoke 2>&1 | grep -E "reusing|built"
pnpm run test:e2e:smoke 2>&1 | grep -E "reusing|built"
```
Expected: first prints `built`, second prints `reusing`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/global-setup.ts
git commit -m "feat(e2e): build by mode, skip when sources are unchanged

Every invocation rebuilt unconditionally, which is ~40% of a smoke
iteration spent rebuilding an unchanged extension. The skip is
mtime-driven so it cannot be wrong by omission, and is disabled under CI."
```

---

### Task 5: The `agent-scratch` project and scripts

**Files:**
- Modify: `playwright.config.ts`, `package.json`, `.gitignore`

**Interfaces:**
- Produces: project `agent-scratch`; scripts `agent:build`, `agent:loop`, `agent:loop:prod`, `agent:screens`, `agent:clean`.

- [ ] **Step 1: Add the project and the ignore**

Replace the `projects` array in `playwright.config.ts`:

```ts
  projects: [
    {
      name: "chromium-extension",
      testMatch: /.*\.spec\.ts/,
      testIgnore: [/.*\.scratch\.spec\.ts/, /agent-screens\.spec\.ts/],
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        ignoreHTTPSErrors: true,
      },
    },
    {
      // Its own outputDir: both projects sharing test-results/e2e meant a
      // scratch run purged the error-context.md and failure screenshots of the
      // suite failure it was written to investigate.
      name: "agent-scratch",
      testMatch: [/.*\.scratch\.spec\.ts/, /agent-screens\.spec\.ts/],
      outputDir: "test-results/agent-out",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        ignoreHTTPSErrors: true,
        trace: "retain-on-failure",
      },
    },
  ],
```

- [ ] **Step 2: Add the scripts to `package.json`**

```json
    "agent:build": "wxt build -m agent",
    "agent:loop": "node -e \"fs.rmSync('test-results/agent',{recursive:true,force:true})\" && OSTRILO_E2E_BUILD_MODE=agent OSTRILO_E2E_HEADED=1 OSTRILO_E2E_SCREENSHOT_DIR=test-results/agent playwright test --project=agent-scratch",
    "agent:loop:prod": "node -e \"fs.rmSync('test-results/agent',{recursive:true,force:true})\" && OSTRILO_E2E_HEADED=1 OSTRILO_E2E_SCREENSHOT_DIR=test-results/agent playwright test --project=agent-scratch",
    "agent:screens": "OSTRILO_E2E_BUILD_MODE=agent OSTRILO_E2E_SCREENSHOT_DIR=test-results/agent playwright test --project=agent-scratch tests/e2e/agent-screens.spec.ts",
    "agent:clean": "node -e \"fs.rmSync('test-results/agent',{recursive:true,force:true})\" && rm -f tests/e2e/*.scratch.spec.ts",
```

- [ ] **Step 3: Add the gitignore entry**

Append to `.gitignore` under `# Test artifacts`:

```
tests/e2e/*.scratch.spec.ts
```

- [ ] **Step 4: Verify CI's project is unaffected**

Run: `pnpm run test:e2e 2>&1 | tail -3`
Expected: `39 passed, 24 skipped`.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts package.json .gitignore
git commit -m "feat(e2e): add the agent-scratch project and loop scripts

Scratch specs are gitignored and excluded from the project CI pins, and
the project gets its own outputDir so a scratch run cannot purge the
failure artifacts it was written to investigate."
```

---

### Task 6: `agent.ts` — the shared driving helpers

Consolidates the `rpc`/`rpcOk`/`sendExtensionRpc` wrappers that seven specs each hand-roll.

**Files:**
- Create: `tests/e2e/fixtures/agent.ts`

**Interfaces:**
- Produces:
  - `DAPP_ORIGIN = "https://localhost:8765"`, `DAPP_URL`, `TEST_PASSWORD`
  - `sendExtensionRpc<T>(page: Page, message: Record<string, unknown>): Promise<T>`
  - `seedUnlockedVault(page: Page, opts?: { password?: string; label?: string }): Promise<void>`
  - `grantKindAllow(page: Page, origin: string, kind: number, password?: string): Promise<void>`
  - `openDapp(context: BrowserContext): Promise<Page>`
  - `waitForApprovalPage(context: BrowserContext, extensionId: string): Promise<Page>`
  - `resolveNextApproval(page: Page, action: string): Promise<void>`

- [ ] **Step 1: Write the file**

```ts
import { expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

export const DAPP_ORIGIN = "https://localhost:8765";
export const DAPP_URL = `${DAPP_ORIGIN}/test-page.html`;
export const TEST_PASSWORD = "Marigold-Trellis-Pebble-2026!";

type RpcResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: number; message: string; data?: { errorCode?: string; details?: string } } };

/** Any extension page satisfies isTrustedExtensionSender, so the popup is a
 *  full privileged RPC gateway. This is the seam every existing spec uses. */
export async function sendExtensionRpc<T>(
  page: Page,
  message: Record<string, unknown>
): Promise<T> {
  const response = await page.evaluate(
    (rpcMessage) =>
      new Promise<RpcResponse<T>>((resolve, reject) => {
        const chromeApi = (globalThis as any).chrome;
        if (!chromeApi?.runtime?.sendMessage) {
          reject(new Error("Extension runtime API is not available"));
          return;
        }
        chromeApi.runtime.sendMessage(rpcMessage, (value: RpcResponse<T>) => {
          const lastError = chromeApi.runtime.lastError;
          if (lastError) reject(new Error(lastError.message));
          else resolve(value);
        });
      }),
    message
  );

  if (!response.ok) {
    const e = response.error;
    throw new Error(
      `RPC ${String(message.type)} failed: ${e.data?.errorCode ?? e.message}${e.data?.details ? `: ${e.data.details}` : ""}`
    );
  }
  return response.data;
}

/**
 * Seeds a usable vault without walking onboarding.
 *
 * The reload at the end is not optional. Seeding over RPC does not tell the
 * popup's React tree to re-read vault state: state.getLock reports unlocked
 * while the page still renders "Ostrilo is Locked" with a disabled Unlock
 * button. Existing specs never notice because they assert on RPC results, not
 * on rendered UI. A screenshot taken without this reload shows a lock screen.
 */
export async function seedUnlockedVault(
  page: Page,
  opts: { password?: string; label?: string } = {}
): Promise<void> {
  const password = opts.password ?? TEST_PASSWORD;
  const label = opts.label ?? "Agent Loop Key";

  await sendExtensionRpc(page, { type: "vault.generate", password, label });
  await sendExtensionRpc(page, { type: "vault.unlock", password });
  // Without this grant getPublicKey() does not fail — it queues an approval and
  // blocks for 60s, which reads as flakiness rather than a missing grant.
  await sendExtensionRpc(page, {
    type: "policy.setOrigin",
    origin: DAPP_ORIGIN,
    patch: { identityDisclosure: "allow" },
  });
  await sendExtensionRpc(page, {
    type: "settings.update",
    patch: { onboardingCompleted: true, onboardingCompletedAt: Date.now() },
  });

  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: label })).toBeVisible({
    timeout: 15_000,
  });
}

/** Standing permission to sign without prompting. Password-gated by design. */
export async function grantKindAllow(
  page: Page,
  origin: string,
  kind: number,
  password: string = TEST_PASSWORD
): Promise<void> {
  await sendExtensionRpc(page, {
    type: "policy.setKindRule",
    origin,
    kind,
    mode: "allow",
    password,
  });
}

export async function openDapp(context: BrowserContext): Promise<Page> {
  const dapp = await context.newPage();
  await dapp.setViewportSize({ width: 900, height: 700 });
  await dapp.goto(DAPP_URL);
  await expect(dapp.locator("#status")).toHaveText("window.nostr available");
  return dapp;
}

export async function waitForApprovalPage(
  context: BrowserContext,
  extensionId: string
): Promise<Page> {
  const prefix = `chrome-extension://${extensionId}/approval.html`;
  const existing = context.pages().find((p) => p.url().startsWith(prefix));
  const approvalPage =
    existing ??
    (await context.waitForEvent("page", {
      predicate: (p) => p.url().startsWith(prefix),
      timeout: 10_000,
    }));
  await approvalPage.setViewportSize({ width: 960, height: 640 });
  await approvalPage.waitForLoadState("domcontentloaded");
  return approvalPage;
}

/** Resolves the first pending approval without a click. Carries the same
 *  policy side effects as pressing the button. */
export async function resolveNextApproval(page: Page, action: string): Promise<void> {
  await expect
    .poll(async () => {
      const data = await sendExtensionRpc<{ requests: Array<{ id: string }> }>(page, {
        type: "approval.getAll",
      });
      return data.requests.length;
    }, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const data = await sendExtensionRpc<{ requests: Array<{ id: string }> }>(page, {
    type: "approval.getAll",
  });
  await sendExtensionRpc(page, {
    type: "approval.resolve",
    requestId: data.requests[0].id,
    action,
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm run compile`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/fixtures/agent.ts
git commit -m "feat(e2e): shared driving helpers for scratch specs

Seven specs each hand-roll an rpc/rpcOk wrapper. This consolidates them
and adds the reload that seeding needs before any screenshot is taken."
```

---

### Task 7: The scratch template and the screens spec

**Files:**
- Create: `tests/e2e/fixtures/scratch-template.ts`, `tests/e2e/agent-screens.spec.ts`

**Interfaces:**
- Consumes: everything from Task 6, `captureStepScreenshot` from Task 1.

- [ ] **Step 1: Write the template**

`tests/e2e/fixtures/scratch-template.ts`:

```ts
/**
 * Copy to `tests/e2e/<anything>.scratch.spec.ts` and edit. Scratch specs are
 * gitignored and are never run by CI.
 *
 *   cp tests/e2e/fixtures/scratch-template.ts tests/e2e/loop.scratch.spec.ts
 *   pnpm run agent:loop 2>&1 | tail -40
 *
 * Artifacts land in test-results/agent/agent-scratch/<test-slug>/:
 * the PNGs, plus console.log with page and service-worker output.
 *
 * Use `await page.pause()` to stop with the browser open and Inspector
 * attached — that is how a human takes over mid-run.
 */
import { test, expect } from "./extension";
import { captureStepScreenshot } from "./screenshots";
import { seedUnlockedVault, openDapp, grantKindAllow, DAPP_ORIGIN } from "./agent";

test("scratch", async ({ openPopup, extensionContext }, testInfo) => {
  const popup = await openPopup();
  await seedUnlockedVault(popup);
  await captureStepScreenshot(popup, testInfo, "01-home");

  await grantKindAllow(popup, DAPP_ORIGIN, 1);
  const dapp = await openDapp(extensionContext);
  const pubkey = await dapp.evaluate(() => window.testGetPublicKey());
  expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
  await captureStepScreenshot(dapp, testInfo, "02-dapp");
});
```

- [ ] **Step 2: Write the screens spec**

`tests/e2e/agent-screens.spec.ts`:

```ts
/**
 * Answers "what does the extension look like right now" in one command:
 *
 *   pnpm run agent:screens
 *
 * No assertions beyond what is needed to know a surface finished rendering.
 * Run by the agent-scratch project only; CI's project ignores this file.
 */
import { test } from "./fixtures/extension";
import { captureStepScreenshot } from "./fixtures/screenshots";
import { seedUnlockedVault } from "./fixtures/agent";

test("current surfaces", async ({ openPopup, openOptions, openSidepanel }, testInfo) => {
  const popup = await openPopup();
  await seedUnlockedVault(popup);
  await captureStepScreenshot(popup, testInfo, "01-popup-home");

  await popup.getByRole("button", { name: "Activity" }).click();
  await captureStepScreenshot(popup, testInfo, "02-popup-activity");

  await popup.getByRole("button", { name: "Settings" }).click();
  await captureStepScreenshot(popup, testInfo, "03-popup-settings");

  const sidepanel = await openSidepanel();
  await sidepanel.setViewportSize({ width: 520, height: 700 });
  await captureStepScreenshot(sidepanel, testInfo, "04-sidepanel");

  const options = await openOptions();
  await options.setViewportSize({ width: 1280, height: 900 });
  await captureStepScreenshot(options, testInfo, "05-options");
});
```

- [ ] **Step 3: Run it**

Run: `pnpm run agent:screens 2>&1 | tail -10`
Expected: `1 passed`. If a selector misses, fix it against the real UI rather than loosening it.

- [ ] **Step 4: Verify the artifacts**

```bash
ls test-results/agent/agent-scratch/*/
head -1 test-results/agent/agent-scratch/*/console.log
```
Expected: five PNGs and `console.log`, whose first line reads `# extension=.../.output/chrome-mv3-agent mode=agent background.js <N> bytes mtime ...`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/scratch-template.ts tests/e2e/agent-screens.spec.ts
git commit -m "feat(e2e): scratch template and a no-assertion screens pass

Most visual questions are 'what does this look like now', which should
cost one command rather than a spec edit and a build."
```

---

### Task 8: The runbook

**Files:**
- Create: `docs/agent-loop.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write `docs/agent-loop.md`**

Cover, in this order: the one-time `pnpm exec playwright install chromium` step; the loop commands from Task 5; where artifacts land; the state-seeding table (free vs password-gated RPC, from the spec); the rate limits that apply *within* a run (6 disclosures/origin/min, 10 approval enqueues, 5 pending/origin, 20 global); the rule that UI judgements use `agent:loop:prod` because the agent build is unminified; the instruction that captured `console.log` is not pasted into commits or issues; and the "Known traps" section copied from the spec, including `rm -rf test-results/e2e-tls/` for the expired certificate.

State counts as commands to run, never as numbers in prose — `docs/TESTING.md` already drifted that way.

- [ ] **Step 2: Link it from `AGENTS.md`**

Add under the Development Standards section:

```markdown
## Driving the Extension

To see the extension actually run — screenshots, console output, a real
signing flow — use the loop in `docs/agent-loop.md`. Scratch specs are
gitignored; promote anything worth keeping into `tests/e2e/`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/agent-loop.md AGENTS.md
git commit -m "docs: runbook for the agent E2E loop"
```

---

### Task 9: Full verification

- [ ] **Step 1: Clean up scratch state**

Run: `pnpm run agent:clean`

- [ ] **Step 2: Run every blocking gate**

```bash
pnpm run compile && pnpm run lint && pnpm run test
pnpm run build && pnpm run build:firefox
pnpm audit --audit-level high
```
Expected: all pass. `pnpm run test` must show no new failures in `tests/security/`.

- [ ] **Step 3: Confirm the E2E baseline is untouched**

Run: `pnpm run test:e2e 2>&1 | tail -3`
Expected: `39 passed, 24 skipped` — the same numbers as before this work.

- [ ] **Step 4: Report the doctor score**

Run: `pnpm run doctor`
Report the number. Do not gate on it.

- [ ] **Step 5: Commit any fixes, then stop for review**

---

## Self-Review

**Spec coverage:** `-m agent` (T3/T4/T5) · scratch lane (T5) · diagnostics (T2) · seeding with reload (T6) · provenance assertion (T3) · separate `outputDir` (T5) · `pages()[0]` fix (T3) · screenshot purge (T1) · `agent:screens` (T7) · runbook and traps (T8) · gates (T9). No gaps.

**Type consistency:** `artifactDir(testInfo)` defined T1, consumed T2. `attachDiagnostics(context, testInfo, meta)` defined T2, called T3 with `{ extensionPath, mode }`. `sendExtensionRpc`/`seedUnlockedVault`/`grantKindAllow`/`openDapp` defined T6, consumed T7. `DAPP_ORIGIN` exported T6, imported T7.

**Known risk:** Task 7's selectors are written from the smoke spec and the design-review script. If the UI has drifted, fix the selector against the real UI — do not loosen it into a match that hides a regression.
