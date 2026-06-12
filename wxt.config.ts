import { defineConfig } from "wxt";
import "@wxt-dev/module-react";
import "@wxt-dev/auto-icons";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/auto-icons"],
  srcDir: "src",
  entrypointsDir: "extension",
  manifest: {
    permissions: ["storage", "sidePanel", "windows"],
    // Make injected script accessible to all HTTP/HTTPS pages for NIP-07 provider
    web_accessible_resources: [
      {
        resources: ["injected.js"],
        matches: ["http://*/*", "https://*/*"],
      },
    ],
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },

  },
  vite: () => ({
    // Cast because wxt bundles its own vite types; tailwindcss() returns Plugin[] from root Vite
    plugins: tailwindcss() as unknown as any[],
    css: {
      // Tailwind Vite plugin currently expects PostCSS pipeline; LightningCSS lacks createIdResolver
      transformer: "postcss",
    },
    assetsInclude: ["**/*.glb", "**/*.gltf"],
    resolve: {
      alias: {
        "@/components": path.resolve(__dirname, "./src/ui/components"),
        "@/hooks": path.resolve(__dirname, "./src/ui/hooks"),
        "@/lib": path.resolve(__dirname, "./src/ui/lib"),
        "@/assets": path.resolve(__dirname, "./src/assets"),
        "@/infrastructure": path.resolve(__dirname, "./src/infrastructure"),
        "@/application": path.resolve(__dirname, "./src/application"),
        "@/domain": path.resolve(__dirname, "./src/domain"),
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        external: [],
        output: {
          globals: {},
        },
      },
      commonjsOptions: {
        include: [/node_modules/],
        transformMixedEsModules: true,
      },
    },
    optimizeDeps: {
      include: ["@noble/curves", "@noble/hashes", "@scure/base", "three"],
    },
  }),
});
