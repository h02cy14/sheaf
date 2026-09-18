# src-tauri: the native shell

**Why this exists:** some guarantees can't be made from inside a WebView:
durable writes (fsync plus atomic rename), a real SQLite, background threads
for grammar and language detection. This Rust crate provides them, and the
same code runs on all four targets. Desktop links it from `src/main.rs`;
Android and iOS load it through `tauri::mobile_entry_point` in `src/lib.rs`.

## Contents

| Path | Purpose |
|---|---|
| `src/lib.rs` | App setup and commands. Phase 0 has one: `app_info` |
| `tauri.conf.json` | Window, bundle and **content security policy** (blocks all network access) |
| `capabilities/` | Tauri permission grants. Keep them minimal; justify each addition |
| `icons/` | Generated. Don't edit; regenerate from `../assets/icon.svg` |
| `gen/android/` | Generated Android project, **committed** because it carries our signing config (`app/build.gradle.kts`) and manifest tweaks |
| `gen/apple/` | Not committed yet: CI generates it on macOS each run. Commit it once iOS needs native code |

## Rules

- Every command the frontend can call is listed in `generate_handler!` and
  mirrored by a typed wrapper in `../src/platform/`.
- Commands must never panic on bad input. Return `Result<_, String>`
  (or a serialisable error type) so the UI can show a message.
- The identifier `io.github.h02cy14.sheaf` (`tauri.conf.json`) becomes
  permanent once published to a store. Changing it means re-running
  `pnpm tauri android init`, then re-applying the signing block in
  `gen/android/app/build.gradle.kts` and `windowSoftInputMode` in the manifest.
