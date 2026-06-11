import path from "node:path";
import { spawnSync } from "node:child_process";

function localBin(name: string): string {
  const executable = process.platform === "win32" ? `${name}.cmd` : name;
  return path.resolve(process.cwd(), "node_modules", ".bin", executable);
}

export default async function globalSetup() {
  const result = spawnSync(localBin("wxt"), ["build"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`wxt build failed with exit code ${result.status}`);
  }
}
