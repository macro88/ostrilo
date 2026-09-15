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
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs
    );
  }
  return newest;
}

export default async function globalSetup() {
  const mode = process.env.OSTRILO_E2E_BUILD_MODE ?? "production";
  const suffix = mode === "production" ? "" : `-${mode}`;
  const outputManifest = path.resolve(
    process.cwd(),
    ".output",
    `chrome-mv3${suffix}`,
    "manifest.json"
  );

  if (process.env.OSTRILO_E2E_SKIP_BUILD === "1") return;

  // Never skip under CI: a stale artifact there is a wrong green, not three
  // seconds saved. Locally the check is mtime-driven rather than flag-driven,
  // so it cannot skip a build it needed.
  if (
    !process.env.CI &&
    !process.env.OSTRILO_E2E_FORCE_BUILD &&
    existsSync(outputManifest)
  ) {
    const built = statSync(outputManifest).mtimeMs;
    const sources = Math.max(
      newestMtime(path.resolve(process.cwd(), "src")),
      ...["wxt.config.ts", "package.json", "tsconfig.json"].map(
        (f) => statSync(path.resolve(process.cwd(), f)).mtimeMs
      )
    );
    if (sources < built) {
      console.log(`[global-setup] reusing chrome-mv3${suffix} (${mode}, sources unchanged)`);
      return;
    }
  }

  const args = mode === "production" ? ["build"] : ["build", "-m", mode];

  // The build emits ~45 lines of Rollup @__PURE__ and chunk-size warnings on
  // every run, which buries the result whenever output is tailed. Keep them for
  // the case where they matter — a failure — and summarise otherwise.
  const result = spawnSync(localBin("wxt"), args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`wxt build failed with exit code ${result.status}`);
  }

  console.log(`[global-setup] built chrome-mv3${suffix} (${mode})`);
}
