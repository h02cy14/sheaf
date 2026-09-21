# Progress

_Last updated: 2026-09-21, end of Phase 3 working session._

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

## Phase 3: Language layer

**Done when (brief §9):** "a mixed English/Chinese document checks the
English and silently leaves the Chinese alone, and CJK typing on a phone is
flawless." **Met on the desktop app**, proved by
`scripts/e2e-native-ime.mjs`, which drives the real WebView's IME: it
composes 你好 through `Input.imeSetComposition` (the same path a keyboard
uses), cancels a composition part-way, and then checks that no pinyin
survived, that the English mistake is underlined, that **nothing Chinese is
ever marked**, that a suggestion applies in one tap, and that an Arabic
paragraph lays itself out right to left. The phone half of the sentence is
still unverified — see below.

### Done

- **Per-paragraph language detection**, ours, in `@sheaf/core`: script first
  (Han, kana, Hangul, Arabic, Hebrew, Cyrillic, Greek, Thai, Devanagari),
  then a stopword vote for Latin-script languages. It reports how sure it is,
  and a short paragraph defers to the language the writer declared for the
  document, then the project — never to a guess. Overrides at both levels.
- **Chinese is never checked**, by rule rather than by setting: not when
  checking is on, not when a LanguageTool endpoint exists. The same calm
  treatment covers any language with no engine. The status bar says
  `中文 · 未启用语法检查` (or "Chinese · no grammar checking, by design"),
  follows the cursor from paragraph to paragraph, and never offers to turn
  anything on.
- **English spelling and grammar offline**, via Harper (Apache-2.0) compiled
  into the Rust shell. It runs on a background thread, 700 ms after typing
  stops, batched per language, with each paragraph's result cached so
  untouched paragraphs are never re-sent. Underlines follow the text as it is
  edited; a click opens a card with suggestions, "Ignore" and "Add to the
  project dictionary". Both lists live in `project.json` and travel with the
  project.
- **LanguageTool, if you run one yourself.** Sheaf speaks to its HTTP API and
  links none of it (it is LGPL). It is contacted only when the writer enters
  an address, and only over plain `http://` — refusing `https://` means the
  endpoint can only be a machine on their own network, never a cloud service.
  Enforced in three places, and the HTTP client is built without TLS at all.
- **Bidi**: every paragraph, heading and list item renders with `dir="auto"`,
  so an Arabic paragraph inside an English manuscript reads right to left and
  an English paragraph inside an Arabic one does not. Nothing about it
  reaches the Markdown file.
- **IME correctness**, tested rather than assumed: composition start, update
  and cancel, candidate selection, and what lands on disk afterwards.
- **[ADR 0003](docs/adr/0003-language-layer.md)** records why detection is
  ours rather than `lingua-rs`, why Harper is in Rust rather than WASM (with
  the size measured), why LanguageTool is http-only, and what each choice
  gives up.
- **Tests:** 196 core + 49 app (TypeScript) + 18 Rust, all passing, plus
  three native acceptance scripts. Lint, typecheck, Prettier, the licence
  audit and the character check all pass.

### Not done / open

- **⚑ For the owner:** Harper brings a small machine-learning stack (`burn`)
  with it for its part-of-speech tagger. That is **+8 MB** in the Windows
  binary (8.7 MB → 16.9 MB) and about a minute of build time, and it adds one
  **MPL-2.0** crate (`colored`) to the tree — weak, file-level copyleft, used
  unmodified, now a named exception in `deny.toml` and recorded in
  [docs/licences.md](docs/licences.md). Worth knowing before the mobile
  download size matters.
- **Spelling for languages other than English.** Harper covers English.
  Hunspell dictionaries for other languages vary in licence (some GPL) and
  need downloading on demand, which is its own design and its own decision;
  the routing and the indicator already handle "no engine for this language"
  correctly.
- **CJK typing on a phone** is still unverified on hardware — the acceptance
  sentence's second half. The desktop WebView's IME path is now covered by an
  automated test; an Android phone and an iPhone need a person.
- **Detection is deliberately narrow.** A paragraph in a language outside the
  stopword lists reads as "some Latin language we have no engine for", which
  leads to the same outcome as a correct guess: nothing is checked, and the
  indicator says so.
- **Harper's own suggestions** are as good as Harper is; Sheaf shows them
  unchanged. The one thing Sheaf guarantees is that they never appear for
  text that should not have been checked.

## Phase 2: Writing management

**Done when (brief §9):** "I can recover an accidentally deleted paragraph
from yesterday."
**Met**: a test writes a paragraph, lets the clock roll over to the next day,
overwrites the text, and gets the lost paragraph back through the snapshot
Sheaf kept automatically before that overwrite — and the restore itself is
undoable, because restoring keeps the current text first
(`packages/core/src/project/session.test.ts`).

### Done

- **Language-aware counting** (a Phase 3 item, brought forward because a
  target number is meaningless without it). Space-delimited scripts are counted in words
  (`Intl.Segmenter`, hyphenated compounds count once), Chinese, Japanese and
  Korean in characters, and a mixed paragraph gets both. A project chooses
  which number its targets use. No letter-spacing hacks, no word segmenter to
  get wrong (brief §7).
- **Targets and pace.** Targets for the manuscript, for the session and for
  each document, with a finish-by date that turns into "2,381 words a day —
  21 days left". Progress shows in the status bar as it is typed: saved
  documents come from the index, the ones being written are counted in the
  editor. Nothing nags; a missed target only changes a line of text.
- **Snapshots.** Before overwriting text it has not kept in the last half
  hour, Sheaf writes the old version to `snapshots/<document id>/` as a plain
  Markdown file; you can also keep one at any time. The history panel lists
  them, compares any of them with the current text (paragraph diff, then word
  or CJK-character diff inside a changed paragraph), and restores — either
  over the document or as a copy beside it. Restoring writes a
  `before-restore` snapshot first. Nothing is ever deleted.
- **Full-text search.** Substring search over titles, synopses and text from
  the binder, served by the local SQLite index with the **trigram**
  tokenizer, so a two-character Chinese word ("灯塔") matches without a word
  segmenter. Results show where the match was and a snippet around it.
- **Split editor** (Ctrl/⌘+\): two documents side by side, each with its own
  undo history and autosave; the status bar follows the pane you are typing
  in. **Focus mode** (Ctrl/⌘+Shift+D, Escape leaves): everything but the text
  disappears, and typewriter scrolling keeps the line you are writing near
  the middle of the pane. **Ctrl/⌘+F** puts the cursor in the search field.
- **All of it in English and 简体中文**, including the new dialogs; the locale
  test keeps the two files in step, placeholders and plural categories
  included.
- **No new dependencies.** Counting, diffing and search use what was already
  there (`Intl`, SQLite, ProseMirror), so the licence audit is unchanged.
- **Proved on the real app:** `scripts/e2e-native-history.mjs` drives the
  installed Windows build — writes a paragraph, keeps a snapshot, destroys
  the paragraph, restores it — and checks the snapshot files on disk,
  including the `before-restore` one. Phase 1's force-quit test still passes
  against the Phase 2 build (20/20 documents, 5,000 words, 0 temp files).
- **Upgrading from Phase 1 costs one rescan:** the index gained columns and a
  search table, so a cache written by the installed Phase 1 build can't be
  read. A test replaces a cache with the Phase 1 layout and proves the
  project opens identically and search works straight away — the cache is
  rebuilt, never repaired.
- **Tests:** 177 core + 34 app (TypeScript) + 11 Rust, all passing, plus the
  two native tests; lint, typecheck, Prettier, licence and
  invisible-character checks pass.

### Not done / open

- **Snapshot housekeeping:** snapshots accumulate; there is no pruning policy
  yet (a per-document cap or an age limit is a Phase 3 decision). They are
  small Markdown files, but a long novel edited daily will collect thousands.
- **Search is substring-only:** no whole-word, case-sensitive or regular
  expression modes, no replace, and results are not ranked. The index stores
  what is needed for those; the UI does not offer them yet.
- **Diff granularity:** paragraphs are matched by similarity, so a paragraph
  rewritten wholesale shows as a delete plus an insert rather than a rewrite.
- **Typewriter scrolling** keeps the caret away from the edges by using
  ProseMirror's scroll margin; on a phone keyboard it has not been tried on
  hardware yet.

## Phase 1: The writing core

**Done when (brief §9):** "I can write 5,000 words across 20 documents,
force-quit the app, and lose nothing." **Met on the real Windows app**: an
automated test types 20 × 250 words through the actual editor, kills the
process with `taskkill /F`, finds all 5,000 words on disk and no temp files,
and the relaunched app shows all 20 documents (`scripts/e2e-native-forcequit.mjs`).
In CI it is informational for now: on GitHub's Windows Server runner the app
starts but the WebView2 debug port never appears (see open items).

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
- **Native test in CI:** on the `windows-2025` runner, WebView2 (v152) is present and the app runs, but its remote-debugging port never opens, so the step can't drive the UI. The step now prints running processes and listening ports on failure. Candidates: the runner's non-interactive session, or WebView2 needing a GPU/desktop. Until solved, the test runs locally and the core-level tests (same scenario, real disk) run in CI.
- **Bundle size:** 1.1 MB of minified JS (React Aria, ProseMirror, markdown-it). Fine for desktop; consider code-splitting for mobile.
- **Android `INTERNET` permission**, `rust-advisories` (6 unmaintained, 0 vulnerabilities) and **iOS signing**: unchanged from Phase 0 (see below).

## Phase 0: Foundations (done)

- Stack: [ADR 0001](docs/adr/0001-stack.md). Tauri 2 on all targets, React 19, ProseMirror, Zustand, SQLite via Rust, with kill criteria for the mobile shell.
- Monorepo, strict TypeScript, lint guardrails (`any`, Tauri-only-in-platform, core stays platform-free), i18n with auto-discovered locales, licence/ads/tracking guardrails, CSP blocking all network access.
- Public repo <https://github.com/h02cy14/sheaf>, identifier `io.github.h02cy14.sheaf`. CI builds Windows, Linux, Android and iOS on every push and publishes the rolling [`dev-build`](https://github.com/h02cy14/sheaf/releases/tag/dev-build) pre-release. The Windows installer was installed and run from CI output on 2026-09-19.
- Android dev signing key in `%USERPROFILE%\.sheaf-signing\` and repo secrets.
- Still open: install on a real phone; iOS signing needs the owner's Apple secrets (docs/ci.md); Android `INTERNET` permission in release builds; one emulator-only ANR seen once.

## Next

1. Owner review of Phases 1–3: try the `dev-build` on a PC and a phone.
   Chinese input on a real phone is the one acceptance criterion an automated
   test cannot reach, so that is the thing to try first.
2. Phase 4 on your go-ahead — structure views: the corkboard, the outliner,
   metadata, labels and status, and collections. *Done when* (brief §9): I
   can restructure a 60-scene novel by dragging cards and see the result in
   the manuscript.
