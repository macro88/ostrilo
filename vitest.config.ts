import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@/components": path.resolve(process.cwd(), "./src/ui/components"),
      "@/hooks": path.resolve(process.cwd(), "./src/ui/hooks"),
      "@/lib": path.resolve(process.cwd(), "./src/ui/lib"),
      "@/assets": path.resolve(process.cwd(), "./src/assets"),
      "@/infrastructure": path.resolve(process.cwd(), "./src/infrastructure"),
      "@/application": path.resolve(process.cwd(), "./src/application"),
      "@/domain": path.resolve(process.cwd(), "./src/domain"),
      "@": path.resolve(process.cwd(), "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    testTimeout: 10000, // 10 seconds for crypto operations
    hookTimeout: 10000, // 10 seconds for setup/teardown
    teardownTimeout: 10000,
    exclude: [
      "**/tests/e2e/**", // E2E handled by Playwright
      "**/node_modules/**",
      "**/dist/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/tests/**",
        "**/entrypoints/**", // Browser extension entrypoints
        "**/components/ui/**", // shadcn/ui components
        "**/*.config.*",
        "**/node_modules/**",
        "**/dist/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    // Performance optimizations
    isolate: true, // Proper isolation to avoid worker thread issues
    pool: "threads",
    maxWorkers: 4,
  },
});
