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
| `src/inspector/` | Per-document metadata (title, synopsis, target, count, dates) |
| `src/status/` | The status bar's counts and the writing-targets dialog |
| `src/history/` | Snapshots: the list, the comparison with the current text, restoring |
| `src/search/` | Project search field and results (served by the local index) |
| `src/editor/grammar/` | Checking inside the editor: what to check, the underlines, the suggestion card |
| `src/language/` | The language dialog and the status bar's language indicator |
| `src/components/` | Small shared pieces: the icon set and the modal dialog |
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

## Counting, targets, history, search

Counts are language-aware (`countText` in `@sheaf/core`): space-delimited
scripts are counted in words, Chinese, Japanese and Korean in characters, and
the project chooses which of the two its targets are measured in. Saved
documents are counted from the index; the documents being typed in are
counted in the editor and pushed into the store, so the status bar keeps up
without re-reading anything.

Snapshots are kept automatically before Sheaf overwrites text it has not kept
in the last half hour, and whenever you ask. Restoring writes a
`before-restore` snapshot first, so a restore can itself be undone. Search
runs against the local SQLite index (trigram), so a two-character Chinese
word finds what it should.

## Spelling, grammar and language

Every paragraph is routed by language before anything is checked
([ADR 0003](../../docs/adr/0003-language-layer.md)). English goes to Harper,
which runs in the Rust shell on a background thread and never touches the
network. Chinese goes nowhere, deliberately, and the status bar says so
rather than staying blank. A LanguageTool server you run yourself can take
the languages Harper cannot, and only if you enter its address.

Checks run 700 ms after typing stops, batched per language, with each
paragraph's result cached so untouched paragraphs are never re-sent.
Underlines follow the text as it is edited; a click — or Ctrl/⌘+. from the
keyboard, which also moves focus into the card — opens a card with the
suggestions, "Ignore", and "Add to the project dictionary".

## Running

`pnpm dev` runs the UI in a browser with projects kept in localStorage
(development only). `pnpm tauri dev` runs the real app. In development
builds, `window.__sheaf` exposes the store and editor bridge for debugging.
