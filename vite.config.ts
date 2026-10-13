import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The app version comes from the VERSION file at the repo root.
const version = readFileSync(new URL("./VERSION", import.meta.url), "utf8").trim();

// Tauri expects a fixed port and does not want Vite to clear its output.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
    // Fonts stay real files instead of data: URLs, which a strict Content-Security-Policy
    // (font-src 'self', as on the website's live demo) refuses to load.
    assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
  },
  test: { environment: "node" },
} as any);
