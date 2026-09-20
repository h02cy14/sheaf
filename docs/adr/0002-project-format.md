# ADR 0002: Project file format

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** project owner, lead engineer

## Context

This is the decision hardest to change later: every user's work lives in it.
The brief (§4) requires that:

- a project is a **directory**, recoverable with a text editor if Sheaf disappears;
- **one file per document**, so a sync conflict damages one scene, not the novel;
- `project.db` is a **rebuildable cache**, proven by a test;
- the format is **versioned**, with a migration harness from day one;
- **every write is atomic**;
- it survives the failure Scrivener is notorious for: cloud-folder sync
  corrupting a bundle.

## Decision

### Layout

```
My Novel.sheaf/                 ← any folder name; ".sheaf" is a convention, not a requirement
  project.json                  ← marker + format version + project-level settings
  docs/
    01J9ZK3D7Q0W6Y8V4T2R5N1M0P.md   ← one file per binder item (text or folder)
    …
```

That was the whole format in Phase 1. Phase 2 added one sibling folder:

```
  snapshots/
    01J9ZK3D7Q0W6Y8V4T2R5N1M0P/                 ← one folder per document
      2026-09-20T08-14-55-021Z-auto-7Q0W6Y.md   ← a past version, same file format
      2026-09-20T09-02-11-880Z-manual-3D7Q0W.md
```

Snapshots are ordinary document files, named after the moment they were
kept, why they were kept (`auto`, `manual`, `before-restore`) and a short
random suffix so two writes in the same millisecond cannot collide. They sit
inside the project, so they travel with it — copy the folder and the history
comes along — and because each one is a separate small file, a sync client
has nothing to merge. Nothing here is ever rewritten, only added.

Later phases add more sibling folders (`research/`); every one of them is
plain files.

### `project.json`

```json
{
  "format": "sheaf-project",
  "formatVersion": 1,
  "id": "01J9ZK…",
  "title": "My Novel",
  "created": "2026-09-18T10:00:00.000Z",
  "roots": { "manuscript": "Manuscript", "research": "Research", "trash": "Trash" }
}
```

Unknown keys are preserved when Sheaf rewrites the file.

### A document file: Markdown with YAML frontmatter

```markdown
---
id: 01J9ZK3D7Q0W6Y8V4T2R5N1M0P
title: The Lighthouse
kind: text
parent: manuscript
order: a1
created: 2026-09-18T10:00:00.000Z
modified: 2026-09-18T10:42:17.311Z
synopsis: Mara arrives on the island.
---

The ferry left her on the jetty with **one bag** and *no plan*.
```

- **The filename is the document's ID**, never its title. Renaming a scene
  touches one line inside one file, not a file move (moves are what sync
  clients handle worst).
- **Structure lives in each document, not in a central file.** `parent` is
  the containing folder's ID (or a root: `manuscript`, `research`, `trash`).
  `order` is a **fractional index** (`a0`, `a0V`, `a1`…): moving a scene
  between two others writes *only the moved file*, with a key that sorts
  between its neighbours. There is no `binder.json` whose corruption or sync
  conflict could scramble the whole manuscript.
- **Trash is a location, not a deletion.** Trashing sets `parent: trash` and
  remembers `trashedFrom`; restoring puts it back. Phase 1 has no permanent delete.
- **Unknown frontmatter keys are preserved**, so a file written by a newer
  Sheaf survives a round trip through an older one.

### Why Markdown, not a JSON document model

| | Markdown + YAML | ProseMirror JSON |
|---|---|---|
| Recover words with any text editor | ✅ it's just prose | ⚠ technically possible, miserable in practice |
| Readable diffs, mergeable sync conflicts | ✅ line-based | ❌ one long line or deep nesting |
| Lossless round trip | ⚠ must be engineered and tested | ✅ free |
| Rich features (footnotes, comments, citations) | ⚠ needs defined extensions | ✅ free |

Recoverability and sync safety are the brief's requirements; lossless round
trip is our engineering problem. So the editor schema is restricted to what
has an exact Markdown form, and **round-trip tests guard it**. Phase 1's
schema: paragraphs, headings 1–3, bold, italic, block quotes, bullet and
numbered lists, hard breaks, scene breaks (`* * *`). Later features use
established extensions: Pandoc footnotes `[^1]`, Pandoc citations `[@key]`,
CriticMarkup comments `{>> <<}`.

**CJK emphasis.** Standard CommonMark fails to parse bold that ends in CJK
punctuation followed by a CJK character (`**「重要」**的`), which would
silently drop formatting on reopen. Sheaf parses with the CJK-friendly
emphasis extension (`markdown-it-cjk-friendly`), and the round-trip tests
include these cases.

### `project.db`: a cache, kept *outside* the project folder

The SQLite index (binder tree, metadata, file fingerprints; later, search
and snapshot indexes) lives in the app's **local data directory**
(`<app-local-data>/index/<project-id>.db`), **not inside the project folder**.

- A SQLite file inside a Dropbox/iCloud/OneDrive folder is exactly how
  bundles get corrupted: the sync client copies it mid-write, or merges two
  devices' copies. Keeping the cache out means sync only ever sees plain text.
- It's a cache, so losing it costs one rescan. On open, Sheaf compares each
  file's size and modification time with the cache, re-reads only what
  changed, and rebuilds from scratch if the cache is missing, corrupt, from
  another schema version, or points at a different folder. A test deletes
  and corrupts the cache and proves the rebuilt project is identical.

### Atomic writes and crash safety

Every write goes to a temporary file in the same folder, is flushed to disk
(`fsync`), then renamed over the target; on Unix-like systems the directory
is also flushed. A crash leaves either the old file or the new one, never a
half-written one. Stray temporary files from a crash are removed on open.

Autosave writes on a short debounce (about half a second after typing
pauses, and at least every two seconds while typing continues), plus
immediately when switching documents or when the app is hidden or closed.

### Conflict detection

- **On open:** two files claiming the same `id` (the typical
  `… (conflicted copy).md` or `… 2.md` from a sync client) are both kept,
  and reported. Neither is overwritten.
- **Before every save:** if the file on disk changed since Sheaf last read or
  wrote it (another device, another program), Sheaf does **not** overwrite
  it. Unsaved edits go to a new sibling document titled "… (conflict copy)",
  the editor reloads the disk version, and the user is told. Nothing is lost.
- **Broken structure** (a `parent` that doesn't exist, a cycle): the
  documents are shown under the Manuscript root and reported; files aren't
  rewritten until the user moves them.

### Versioning and migrations

`project.json.formatVersion` is the single format version. On open:

- **older:** migrations run in sequence (`1→2`, `2→3`…). Before the first
  migration touches anything, the files it will modify are copied to
  `.sheaf-backup/<timestamp>-v<from>/`. `formatVersion` is bumped last, so an
  interrupted migration re-runs from a consistent state;
- **newer:** the project is refused with an explanation, never "upgraded" by
  an older app.

The harness exists and is tested before any real migration is needed.

## What we are giving up

- **Speed of a single database file.** Opening means listing a folder and
  stat-ing every file; the cache makes the common case fast (only changed
  files are read).
- **Human-readable structure.** The tree is recoverable, but reading it by
  hand from `parent`/`order` fields is tedious. The words themselves are
  plain text.
- **Arbitrary rich formatting.** Only what Markdown can express exactly is
  allowed in the editor. That is a feature for a manuscript tool, but it is a limit.
- **Per-machine cache.** Opening a project on a new machine always starts
  with a full scan.

## Consequences

- `@sheaf/core` owns parsing, serialisation, the tree, migrations and the
  index logic; it's tested in Node against a real SQLite (`node:sqlite`).
- The Rust shell owns durable I/O and the SQLite connection used by the app,
  and only works inside a project folder it has been handed.
- Revisit if round-trip fidelity becomes a blocker for Phase 6 features
  (footnotes, comments, citations).
