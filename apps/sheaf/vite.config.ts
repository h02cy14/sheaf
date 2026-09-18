import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Set by `tauri android dev` / `tauri ios dev` so a phone can reach the dev
// server over the LAN. Unset for desktop and for plain browser development.
const devHost = process.env["TAURI_DEV_HOST"];

export default defineConfig({
  plugins: [react()],
  // Keep Rust compiler output visible when run under `tauri dev`.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: devHost ?? false,
    ...(devHost ? { hmr: { protocol: "ws", host: devHost, port: 1421 } } : {}),
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // Oldest engines we support: WebView2/Android WebView (Chromium) and
    // WKWebView/WebKitGTK (Safari 15-era WebKit). See docs/adr/0001-stack.md.
    target: ["es2022", "chrome105", "safari15"],
    sourcemap: Boolean(process.env["TAURI_ENV_DEBUG"]),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
