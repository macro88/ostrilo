import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd()),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    exclude: [
      "**/tests/e2e/**", // E2E handled by Playwright
      "**/node_modules/**",
      "**/dist/**",
    ],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
