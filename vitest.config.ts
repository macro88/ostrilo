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
