import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    permissions: ["storage", "sidePanel"],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./"), // or "./src" if using src directory
      },
    },
    build: {
      rollupOptions: {
        external: [],
        // Handle crypto dependencies properly for browser extension
        output: {
          globals: {},
        },
      },
      // Ensure dependencies are properly bundled
      commonjsOptions: {
        include: [/node_modules/],
        transformMixedEsModules: true,
      },
    },
    // Optimize dependencies for the browser extension environment
    optimizeDeps: {
      include: [
        "@noble/curves",
        "@noble/hashes",
        "@scure/base",
      ],
    },
  }),
});
