# src-tauri: the native shell

**Why this exists:** some guarantees can't be made from inside a WebView:
durable writes (fsync plus atomic rename), a real SQLite, background threads
for grammar and language detection. This Rust crate provides them, and the
same code runs on all four targets. Desktop links it from `src/main.rs`;
Android and iOS load it through `tauri::mobile_entry_point` in `src/lib.rs`.

## Contents

| Path | Purpose |
|---|---|
| `src/lib.rs` | App setup, handle registries, and every command the frontend can call |
| `src/storage.rs` | Atomic writes (temp → fsync → rename → fsync folder), path validation, temp-file-only deletion. Unit-tested |
| `src/index_db.rs` | SQLite for the index cache (`<app-local-data>/index/<project-id>.db`). Unit-tested |
| `src/error.rs` | `{ code, message }` errors returned to the frontend |
| `tauri.conf.json` | Window, bundle and **content security policy** (blocks all network access) |
| `capabilities/` | Tauri permission grants. Keep them minimal; justify each addition |
| `icons/` | Generated. Don't edit; regenerate from `../assets/icon.svg` |
| `gen/android/` | Generated Android project, **committed** because it carries our signing config (`app/build.gradle.kts`) and `windowSoftInputMode` |
| `gen/apple/` | Not committed yet: CI generates it on macOS each run. Commit it once iOS needs native code |

## Commands

| Command | Does |
|---|---|
| `projects_dir`, `projects_list`, `project_create_folder` | The default projects folder (`Documents/Sheaf` on desktop, app storage on mobile; `SHEAF_PROJECTS_DIR` overrides it for tests) |
| `project_attach` / `project_detach` | Hands out a numeric handle for one project folder |
| `fs_read_text`, `fs_write_text`, `fs_stat`, `fs_list`, `fs_mkdir`, `fs_rename`, `fs_remove_temp` | File access **inside an attached folder only**, by validated relative path |
| `index_open`, `index_destroy`, `db_execute`, `db_execute_many`, `db_query`, `db_close` | The index cache |
| `app_info` | Version, OS, CPU architecture |

## Rules

- Every command the frontend can call is listed in `generate_handler!` and
  has exactly one typed wrapper in `../src/platform/`.
- Commands never panic on bad input: they return `CmdError`.
- Blocking I/O runs in `spawn_blocking`, never on the UI thread.
- Nothing here deletes user files. The only deletion is of Sheaf's own
  leftover `.<name>.<suffix>.tmp` files and its own cache database.
- The identifier `io.github.h02cy14.sheaf` (`tauri.conf.json`) becomes
  permanent once published to a store. Changing it means re-running
  `pnpm tauri android init`, then re-applying the signing block in
  `gen/android/app/build.gradle.kts` and `windowSoftInputMode` in the manifest.
