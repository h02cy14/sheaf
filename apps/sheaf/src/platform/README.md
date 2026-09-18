# platform: the shell bridge

**Why this exists:** it keeps the frontend independent of Tauri. This folder
is the only code allowed to import `@tauri-apps/*`, and an ESLint rule fails
the build otherwise. If Tauri on mobile ever fails one of the kill criteria in
ADR 0001, a Capacitor build implements this same interface and nothing else in
the UI changes.

## Rules

- Export plain TypeScript functions and types (`detectRuntime()`, and later
  `readDocument()`, `writeDocumentAtomic()` and so on). Never re-export Tauri's own API.
- Every Rust command has exactly one typed wrapper here, and its types mirror
  the Rust structs (see `AppInfo`).
- The frontend must still start in a plain browser (`pnpm dev`) with no native
  shell. Wrappers detect that and degrade explicitly, never with a crash.
