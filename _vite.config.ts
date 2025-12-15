import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import commonjs from "vite-plugin-commonjs"; // Import the plugin

export default defineConfig({
  plugins: [react(), tailwindcss(), commonjs()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"), // or "./src" if using src directory
    },
  },
});
