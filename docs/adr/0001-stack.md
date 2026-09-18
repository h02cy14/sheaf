# ADR 0001: Application stack

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** project owner, lead engineer

## Context

Sheaf is a long-form writing app (novels, articles, research) that must run on
**Windows, Linux, Android and iOS** from one codebase. macOS is out of scope for
now (owner's decision, 2026-09-18). The project is open source under Apache-2.0.

The brief's hardest constraints shape the stack more than feature lists do:

1. **Never lose words.** Atomic writes (temp file, fsync, rename) and a
   rebuildable SQLite cache, behaving identically on all targets.
2. **CJK input must be flawless**, including software keyboards and IMEs on phones.
3. **Offline language tooling.** Harper (grammar) and lingua-rs / whatlang
   (language detection) are Rust libraries.
4. **Local-first, private, no network by default.**
5. **One shared codebase.** Platform code only where a platform demands it.

## Decision

| Layer | Choice | Licence | Arrives in |
|---|---|---|---|
| Language (UI) | TypeScript, strict mode | Apache-2.0 | Phase 0 |
| UI framework | React 19 | MIT | Phase 0 |
| Build | Vite | MIT | Phase 0 |
| **Shell, all four targets** | **Tauri 2** (desktop *and* mobile) | MIT / Apache-2.0 | Phase 0 |
| i18n | i18next + react-i18next | MIT | Phase 0 |
| Editor core | **ProseMirror, used directly** (no Tiptap) | MIT | Phase 1 |
| Accessible widgets | React Aria Components (tree, table, grid list, drag and drop) | Apache-2.0 | Phase 1 |
| State | Zustand | MIT | Phase 1 |
| Index / cache | SQLite through `rusqlite` (bundled SQLite) in the Rust shell | MIT | Phase 1 |
| Tests | Vitest (unit), Playwright (web e2e), Rust `cargo test` | MIT / Apache-2.0 | Phase 0 |
| Packages | pnpm workspaces + Cargo workspace | MIT | Phase 0 |

Rows marked Phase 1 are decided now but not yet installed: nothing enters the
dependency tree before it is used and its licence has been recorded in
[`docs/licences.md`](../licences.md).

## Options considered

### 1. Mobile shell: Tauri on mobile vs Capacitor

This was the brief's explicit open question. Both wrap the **system WebView**
(WebView2 on Windows, WebKitGTK on Linux, Android System WebView, WKWebView on
iOS), so **the choice does not change IME or rendering behaviour**. That is
decided by the WebView and the editor. The difference lies in what sits
underneath the WebView.

| Criterion | Tauri everywhere | Tauri desktop + Capacitor mobile |
|---|---|---|
| Durable file I/O (fsync, atomic rename) | One Rust implementation, all targets | Rust on desktop; `@capacitor/filesystem` has no fsync or atomic-replace guarantee, so we'd write custom Kotlin **and** Swift plugins |
| SQLite | `rusqlite` everywhere: one engine version, one code path | `rusqlite` on desktop + a Capacitor SQLite plugin on mobile: two code paths, two bug surfaces |
| Harper / lingua-rs | Native Rust on every target | WASM on mobile (bigger, slower, worker plumbing) or per-platform bridges |
| Mobile tooling maturity | Younger: smaller plugin ecosystem, rougher CLI edges, fewer answered questions | **Better**: mature plugins (Keyboard, Share, Filesystem), live reload, large community |
| Software keyboard handling | Web standards (VisualViewport, `interactive-widget`), plus a small native plugin if needed | Keyboard plugin with resize modes out of the box |
| Print, share sheet | Needs Kotlin/Swift either way (Tauri mobile plugin API) | Needs Kotlin/Swift either way (some existing plugins) |
| Number of native layers to maintain | 1 (Rust) + thin Kotlin/Swift for print/share | Rust + Kotlin + Swift for the storage core |

**Decision: Tauri on all targets.** The brief's hardest requirements (never
losing words; offline grammar and language detection) live in native code,
and Tauri lets that code be written once. Capacitor's advantages are real but
are mostly developer convenience on mobile, which is cheaper to work around
than maintaining the storage core three times.

**Escape hatch.** Only `apps/sheaf/src/platform/` may import `@tauri-apps/*`
(an ESLint rule enforces this). If Tauri mobile fails us, the same frontend
goes into Capacitor, and the Rust core is exposed to it as a native plugin via
UniFFI. That is a bounded port (weeks, not a rewrite) because no UI code knows
which shell it runs in.

**Kill criteria**, checked on real devices at the end of Phase 1 and Phase 3.
Any one of these triggers a switch of the mobile shell to Capacitor:

1. The software keyboard hides the caret or the editor toolbar on iOS or
   Android, and VisualViewport handling plus ≤200 lines of native code can't fix it.
2. Opening and saving projects through the system document pickers (Android
   SAF, iOS Files) can't be made to work with Tauri plugins plus a small custom plugin.
3. A Tauri mobile build breakage blocks us for more than a week with no fix upstream.

### 2. Desktop shell: Tauri vs Electron

Electron ships its own Chromium, which means one engine on every desktop OS
and the most consistent IME behaviour on Linux. It costs 100 MB+ installers
and much higher memory use, and it has no mobile story, so we would still need a
second native layer for phones. Tauri installers are 5–15 MB and use the
system WebView.

**Cost we accept:** Linux runs on **WebKitGTK**, historically the least
polished of the four engines, both for performance and for IME through
IBus/Fcitx. Linux gets dedicated IME QA time in Phase 3.

### 3. Non-web stacks: Flutter, React Native, Qt

- **Flutter**: one rendering engine everywhere, which is attractive. But rich-text
  editing is its weakest area (super_editor / appflowy_editor are far behind
  ProseMirror), and desktop-Linux IME support has historically lagged. We would
  be writing an editor engine instead of a writing app.
- **React Native**: no Linux target, and serious rich text ends up in a WebView anyway.
- **Qt/QML**: strong native text engine, but C++, LGPL/commercial licensing
  friction on mobile, and a far smaller pool of editor components.

Rejected: **the editor is the product**, and the best editor engines are on the web.

### 4. UI framework: React vs Svelte

React Aria Components provides accessible, keyboard-navigable **tree with
drag-and-drop and multi-select** (binder), **grid list** (corkboard) and
**sortable table** (outliner). These are the app's three structural surfaces,
and accessible drag-and-drop is hundreds of hours of work we don't have to
write. Svelte's equivalents are thinner. ProseMirror is framework-agnostic;
we mount its `EditorView` imperatively and keep document state outside React.

**Giving up:** roughly 45 KB gzipped of framework, and some care around
re-renders near the editor.

### 5. Editor: ProseMirror vs Lexical (Tiptap excluded)

Tiptap is excluded per the brief: its core is MIT but extensions we would need
are commercially licensed.

- **ProseMirror**: a decade in production, and the strongest composition/IME
  handling of any web editor, including Android Gboard, which has had years of
  dedicated work. Its **schema-enforced documents** let us guarantee that
  everything the editor can express round-trips to the on-disk format. Decorations
  are the native mechanism for grammar underlines without touching the document.
  It has a nested-editor pattern for footnotes and `y-prosemirror` for Phase 8 sync.
- **Lexical**: good React ergonomics and active development, but Android IME
  composition bugs recur in its issue tracker, and its node model is looser.

**Decision: ProseMirror.** **Giving up:** a lower-level API, so we write more
plumbing (commands, toolbar state, React glue) ourselves.

### 6. Storage and where logic lives

Plain files on disk are the source of truth; `project.db` is a rebuildable
cache (brief §4). The detailed file format is ADR 0002, due in Phase 1.

- **SQLite runs in Rust** (`rusqlite`, bundled): the same engine, version and
  FTS5 search on every target. We don't need `sql.js` because there is no
  pure-browser target.
- **`packages/core` (TypeScript)** owns format parsing and serialisation,
  migrations, compile, and word counting. It is pure, has no platform imports,
  and is tested in Node. It sits next to ProseMirror, which owns the document model.
- **The Rust shell** owns durability (atomic writes with fsync, directory
  fsync), SQLite, file watching, and later the compute-heavy language tooling
  (Harper, language detection) on a background thread.

### 7. Tooling notes

- **pnpm 10**, not 12. pnpm 12 (a Rust rewrite) hung on Windows during setup,
  so we pinned the mature line.
- **TypeScript 6.0**, not 7.0. `typescript-eslint` supports only TS < 6.1 as of
  this ADR. Revisit when it supports TS 7's native compiler.

## What we are giving up (summary)

1. **One rendering engine.** We ship on two engine families, Chromium (Windows,
   Android) and WebKit (Linux, iOS). Every editor feature is tested on both.
2. **Capacitor's mobile polish**: plugins and tooling we would otherwise get for free.
3. **Linux smoothness.** WebKitGTK is slower and quirkier than WebView2.
4. **Single-language simplicity.** Contributors need TypeScript and Rust, and
   Rust release builds take several minutes per target in CI.
5. **Control over engine versions.** WKWebView tracks the iOS version (minimum
   iOS 15); Android WebView updates through the Play Store (minimum SDK 24),
   so old devices can carry old engines.

## Consequences

- CI builds Windows, Linux, Android and iOS on every push. GitHub-hosted
  runners are free because the repository is public.
- Adding macOS later is mostly a CI job plus signing and notarisation; the code
  already builds for it.
- **Revisit** if a kill criterion fires, when `typescript-eslint` supports
  TS 7, or when Tauri ships a new major version.
