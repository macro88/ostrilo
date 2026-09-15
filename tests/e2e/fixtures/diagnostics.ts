/**
 * Captures what the extension said while a test ran.
 *
 * Playwright reports what it asserted; it does not report what the code under
 * test logged. For an extension whose interesting work happens in an MV3
 * service worker, that is most of the signal. `ConsoleMessage.worker()` is
 * non-null for service-worker output, so every line here carries its source.
 *
 * The production build compiles every `console.*` call to an empty function
 * (`wxt.config.ts` drops console in production), so this file is only useful
 * against a build that keeps them — see `pnpm run agent:build`.
 */
import fs from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, TestInfo } from "@playwright/test";
import { artifactDir } from "./screenshots";

type Line = { t: number; type: string; source: string; text: string };

/**
 * No current call site logs key material: the RPC path logs `message.type` and
 * a status string. But this file persists whatever a future careless
 * `console.log(message)` emits, so mask the two shapes that matter before
 * anything reaches disk.
 */
function redact(text: string): string {
  return text
    .replace(/\bnsec1[a-z0-9]{50,}\b/gi, "[nsec redacted]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[64-hex redacted]");
}

function basenameOf(url: string): string {
  try {
    return path.basename(new URL(url).pathname) || url;
  } catch {
    return url;
  }
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
      ? `sw:${basenameOf(worker.url())}`
      : page
        ? basenameOf(page.url())
        : "unknown";
    lines.push({
      t: Date.now() - started,
      type: msg.type(),
      source,
      text: redact(msg.text()),
    });
  });

  context.on("weberror", (err) => {
    const page = err.page();
    lines.push({
      t: Date.now() - started,
      type: "uncaught",
      source: page ? basenameOf(page.url()) : "unknown",
      text: redact(err.error().stack ?? String(err.error())),
    });
  });

  return async function flush(): Promise<void> {
    // Which artifact produced this output. The failure this guards against is
    // debugging a stale or wrong-variant build: the fix appears not to work,
    // the logs look plausible, and correct code starts getting changed.
    let fingerprint = `# extension=${meta.extensionPath} mode=${meta.mode}`;
    try {
      const bg = statSync(path.join(meta.extensionPath, "background.js"));
      fingerprint += ` background.js ${bg.size} bytes mtime ${bg.mtime.toISOString()}`;
    } catch {
      fingerprint += " background.js MISSING";
    }

    const body = lines
      .map(
        (l) =>
          `[${String(l.t).padStart(6)}ms] ${l.type.padEnd(8)} ${l.source} :: ${l.text}`
      )
      .join("\n");

    // `testInfo.outputDir` is cleaned by Playwright. The screenshot tree is
    // written only when a run asks for it, so the main suite does not sprout a
    // directory per test in a tree that exists for reviewing screenshots.
    const targets = [testInfo.outputDir];
    if (process.env.OSTRILO_E2E_SCREENSHOT_DIR) {
      targets.push(artifactDir(testInfo));
    }

    for (const dir of targets) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "console.log"),
        `${fingerprint}\n${body}\n`,
        "utf8"
      );
    }

    await testInfo.attach("console.log", {
      path: path.join(testInfo.outputDir, "console.log"),
      contentType: "text/plain",
    });

    // Opening the popup alone produces ~21 lines of RPC ping-pong, so errors
    // lead. A plain tail would bury them.
    if (testInfo.status !== testInfo.expectedStatus) {
      const errors = lines.filter(
        (l) => l.type === "error" || l.type === "uncaught"
      );
      if (errors.length > 0) {
        console.error(`\n--- extension errors (${errors.length}) ---`);
        for (const l of errors) console.error(`${l.source} :: ${l.text}`);
      }
      console.error("--- last 20 console lines ---");
      for (const l of lines.slice(-20)) {
        console.error(`${l.type} ${l.source} :: ${l.text}`);
      }
    }
  };
}
