# @sheaf/core

**Why this exists:** the logic that decides whether a user keeps their words
(the project format, migrations, the Markdown round trip, the binder
structure, conflict-safe saving) has to behave identically on Windows, Linux,
Android and iOS, and has to be testable in plain Node without a WebView or a
phone. That logic lives here and nowhere else.

## Rules

- **No platform imports.** No DOM, no Node built-ins, no `@tauri-apps/*`.
  The `tsconfig.json` has no DOM lib or ambient types and ESLint blocks those
  imports, so breaking this rule fails the build.
- **I/O goes through interfaces:** `ProjectFs` (files in one project folder)
  and `SqlDatabase` (the index cache). The app implements them over the Rust
  shell; tests use `MemoryFs` or the real-disk/`node:sqlite` adapters in
  `project/node-adapters.testutil.ts`.
- **Tests sit next to the code** as `*.test.ts`.

## Modules

| Path | What it does |
|---|---|
| `ids.ts` | Document ids (ULIDs), which are also filenames |
| `order.ts` | Fractional order keys: a reorder rewrites one file |
| `editor/schema.ts` | The ProseMirror schema: only what Markdown can express exactly |
| `editor/markdown.ts` | Lossless Markdown ⇄ ProseMirror, CJK-aware, verified per block with a tag fallback |
| `format/docfile.ts` | A document file: YAML frontmatter + Markdown body; unknown keys preserved |
| `format/project-file.ts` | `project.json` and the format version |
| `format/layout.ts` | Where things live inside a project folder |
| `project/fs.ts` | The `ProjectFs` interface and `MemoryFs` |
| `project/index-store.ts` | The rebuildable SQLite index cache, and recovery from a corrupt one |
| `project/tree.ts` | Binder tree from `parent`/`order`, with orphan and cycle repair |
| `project/migrations.ts` | Format migration harness (backup first, bump version last) |
| `project/open.ts` | Opening: migrate, scan, reconcile with the cache, detect sync-conflict copies |
| `project/session.ts` | The open project: per-file write queue, conflict-safe saves, binder operations |

What the format looks like on disk, and why: [ADR 0002](../../docs/adr/0002-project-format.md).

## Tests worth knowing about

- `editor/markdown.test.ts`: round trips, escaping traps, CJK emphasis, and a
  3,000-document fuzz test.
- `project/index-rebuild.test.ts`: deletes and corrupts `project.db` on a
  real disk and proves the project reopens identically (brief §4).
- `project/session.test.ts`: 5,000 words across 20 documents survive a
  "force-quit", saves never overwrite outside changes, and the migration harness.
