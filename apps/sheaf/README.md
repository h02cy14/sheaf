# @sheaf/app

**Why this exists:** this is the application itself: the React frontend that
every user sees, plus the Tauri shell (`src-tauri/`) that turns it into an app
on Windows, Linux, Android and iOS. One frontend, one Rust core, four targets
(ADR 0001).

## Layout

| Path | What it is |
|---|---|
| `src/home/` | Landing screen: New project, your projects, language |
| `src/project/` | The project screen: binder, editor, inspector (drawers on narrow screens) |
| `src/binder/` | Binder tree (React Aria): selection, drag and drop, item menu, keyboard moves |
| `src/editor/` | The writing surface: `EditorController` (ProseMirror view, loading, autosave), toolbar, title |
| `src/inspector/` | Per-document metadata (title, synopsis, dates) |
| `src/state/` | App state (Zustand) and per-device conveniences (recent projects, last document) |
| `src/i18n/`, `src/locales/` | Localisation; adding a language needs no code change (see its README) |
| `src/platform/` | The **only** place that talks to Tauri; also the browser-preview storage |
| `src/styles/base.css` | Design tokens (light and dark), global accessibility defaults |
| `src-tauri/` | Rust shell; see its README |
| `assets/icon.svg` | Master app icon; `pnpm tauri icon assets/icon.svg --ios-color "#1f3a5f"` regenerates every platform icon |

## How text gets to disk

Typing → ProseMirror transaction → `Autosaver.markDirty` → 0.5 s after the
last keystroke (at most 2 s while typing continues) → `serializeMarkdown` →
`ProjectSession.saveBody` → conflict check → atomic write in Rust. Switching
documents, closing the project, closing the window and backgrounding the app
flush immediately. No Save button.

## Running

`pnpm dev` runs the UI in a browser with projects kept in localStorage
(development only). `pnpm tauri dev` runs the real app. In development
builds, `window.__sheaf` exposes the store and editor bridge for debugging.
