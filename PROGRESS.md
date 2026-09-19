# Progress

_Last updated: 2026-09-19, end of Phase 1 working session._

## Owner decisions and working assumptions

| Question (brief §10) | Answer | Source |
|---|---|---|
| Open source? | **Yes: Apache-2.0**, public GitHub repo | Owner, 2026-09-18 |
| Monetisation | Undecided. **Assumption:** no IAP/licensing layer until the owner decides; nothing in the architecture depends on it | Assumption |
| macOS in scope? | **No** (Tauri would support it cheaply later) | Owner, 2026-09-18 |
| First UI languages | **Assumption:** English + Simplified Chinese | Brief default |
| Sync | **Assumption:** not in v1. The file format is built to survive Dropbox/iCloud/Syncthing folder sync (ADR 0002); Phase 8 only on go-ahead | Brief default |
| Apple Developer account | Owner **has one**; iOS signing gets wired up from repository secrets | Owner, 2026-09-18 |
| App name | **Sheaf** (working name; needs a trademark search before public launch) | Owner, 2026-09-18 |
| Phase order | Owner asked to go on to Phase 1 ("improve the app … before any other things") before installing the Phase 0 builds on devices | Owner, 2026-09-18 |

## Phase 1: The writing core

**Done when (brief §9):** "I can write 5,000 words across 20 documents,
force-quit the app, and lose nothing." **Met on the real Windows app**: an
automated test types 20 × 250 words through the actual editor, kills the
process with `taskkill /F`, finds all 5,000 words on disk and no temp files,
and the relaunched app shows all 20 documents. It now runs in CI on every push.

### Done

- **Project format: [ADR 0002](docs/adr/0002-project-format.md).** A project is a folder: `project.json` plus `docs/<id>.md` (YAML frontmatter + Markdown). The tree lives in each document (`parent` + fractional `order`), so a move or rename rewrites one file. The Trash is a location; nothing is ever deleted. Unknown frontmatter keys are preserved. `formatVersion` exists, with a tested migration harness (backup first, bump version last, refuse newer formats).
- **Lossless Markdown round trip** (`@sheaf/core`): headings, bold, italic, quotes, lists, scene breaks, hard breaks, and intentionally empty paragraphs. CJK-aware emphasis (`**「重要」**的` survives). Every styled paragraph is re-parsed before writing, and anything Markdown can't express falls back to `<strong>`/`<em>` tags. Guarded by 87 tests, including a 3,000-document fuzz test.
- **project.db is a cache**, kept outside the project folder (`<app-local-data>/index/<project-id>.db`) so sync clients never touch a database. A warm open reads no files. A test deletes and corrupts it on a real disk and proves the project reopens identically (brief §4).
- **Durable storage (Rust):** atomic writes (temp → fsync → rename → fsync folder; retries for Windows file locks); access only inside an attached project folder, via validated relative paths; the only deletion possible is of Sheaf's own temp files. 10 Rust unit tests.
- **Never overwriting someone else's change:** before each save the file is compared with what Sheaf last read or wrote. If it changed elsewhere, the editor's text becomes a "(conflict copy)" sibling and the disk version is shown. Sync-conflict duplicates (`… (conflicted copy).md`) are detected on open, listed, and can be kept as separate documents. Orphans and parent cycles are shown, not hidden.
- **The app:**
  - **Home:** New project (one click → typing in the first chapter), your projects, Open folder (desktop), language.
  - **Binder:** React Aria tree, with multi-select, drag to reorder or move into items, and a per-item menu (open, rename, new here, move up/down/in/out, trash/restore) that works on touch. Keyboard: arrows, Delete → Trash, Alt+Shift+Arrows move items, Ctrl/⌘+N new document, Ctrl/⌘+Shift+N new folder. Accessible drag handle.
  - **Editor:** ProseMirror with toolbar (bold, italic, H1/H2, quote, lists, scene break), Markdown-style typing shortcuts, smart quotes and dashes, undo history kept per document while switching.
  - **Autosave:** 0.5 s after typing pauses (at least every 2 s while typing continues), plus an immediate flush on document switch, project close, window close and app backgrounding. Status shows in the top bar. No Save button.
  - **Inspector:** title, synopsis, type, created/modified.
  - Resumes the last project and document. Responsive: three panes on wide screens, drawers on phones. Dark mode. Everything in English and 简体中文.
- **Tests:** 139 core + 29 app (TypeScript), 10 Rust, plus the native force-quit test. Lint, typecheck, Prettier, licence checks and the new `check:chars` (no invisible characters in source) all pass.

### Not done / open

- **Real-device checks** (ADR 0001 kill criteria): software keyboard, IME and document pickers on an actual Android phone and iPhone. The layout follows the visual viewport, so text should stay visible above the keyboard, but this is unverified on hardware.
- **Folders on mobile:** projects live in app storage on Android/iOS (no SAF / Files picker yet). "Open project folder…" is desktop-only.
- **Drag and drop** was verified through the code paths and keyboard/menu moves. Pointer dragging could not be exercised headlessly; please try it.
- **Bundle size:** 1.1 MB of minified JS (React Aria, ProseMirror, markdown-it). Fine for desktop; consider code-splitting for mobile.
- **Android `INTERNET` permission**, `rust-advisories` (6 unmaintained, 0 vulnerabilities) and **iOS signing**: unchanged from Phase 0 (see below).

## Phase 0: Foundations (done)

- Stack: [ADR 0001](docs/adr/0001-stack.md). Tauri 2 on all targets, React 19, ProseMirror, Zustand, SQLite via Rust, with kill criteria for the mobile shell.
- Monorepo, strict TypeScript, lint guardrails (`any`, Tauri-only-in-platform, core stays platform-free), i18n with auto-discovered locales, licence/ads/tracking guardrails, CSP blocking all network access.
- Public repo <https://github.com/h02cy14/sheaf>, identifier `io.github.h02cy14.sheaf`. CI builds Windows, Linux, Android and iOS on every push and publishes the rolling [`dev-build`](https://github.com/h02cy14/sheaf/releases/tag/dev-build) pre-release. The Windows installer was installed and run from CI output on 2026-09-19.
- Android dev signing key in `%USERPROFILE%\.sheaf-signing\` and repo secrets.
- Still open: install on a real phone; iOS signing needs the owner's Apple secrets (docs/ci.md); Android `INTERNET` permission in release builds; one emulator-only ANR seen once.

## Next

1. Owner review of Phase 1: try the `dev-build` on a PC and a phone (Chinese input especially).
2. Phase 2: targets, session counts, snapshots with diff and rollback, full-text search, split editor, focus mode.
