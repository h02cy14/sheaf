# @sheaf/core

**Why this exists:** the logic that decides whether a user keeps their words
(the project format, migrations, compile, word counting, language routing)
has to behave identically on Windows, Linux, Android and iOS, and has to be
testable in plain Node without a WebView or a phone. That logic lives here and
nowhere else.

## Rules

- **No platform imports.** No DOM, no Node built-ins, no `@tauri-apps/*`. The
  `tsconfig.json` leaves out the DOM lib and all ambient types, so breaking
  this rule is a compile error rather than a code-review catch.
- **I/O goes through interfaces.** When core needs the disk, it takes a small
  interface (for example `ProjectFs`) that the app implements over Tauri and
  tests implement in memory or over a temp directory.
- **Tests sit next to the code** as `*.test.ts` and run with `pnpm test`.

## What lands here, by phase

| Phase | Module |
|---|---|
| 1 | Project format: document files, frontmatter, binder ordering, `formatVersion`, migration harness, index rebuild |
| 2 | Snapshots and diff, session and target maths |
| 3 | Language-aware word and character counting, per-paragraph language routing |
| 5 | Compile pipeline (document tree → DOCX / EPUB / HTML / Markdown / text) |

Phase 0 ships the package empty so the workspace, build and CI wiring are
proven before any real code depends on them.
