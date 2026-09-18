# Dependency licences

Sheaf is licensed under **Apache-2.0**. Every dependency is audited before it
is added and recorded here. Anything copyleft or commercially restricted is
raised with the project owner **before** adoption.

## How this is enforced

Review alone isn't enough, so CI blocks violations:

| Check | Tool | Scope | Fails CI when |
|---|---|---|---|
| JS licences | `scripts/check-deps.mjs` | everything shipped in the app bundle (`pnpm licenses --prod`) | a licence is not on the permissive allowlist |
| JS ads/tracking | `scripts/check-deps.mjs` | the entire lockfile, dev dependencies included | an ad, analytics or third-party crash-reporting package appears |
| Rust licences | `cargo-deny` (`deny.toml`) | all crates for our 4 targets | a licence is not allowed, or an MPL crate is not individually excepted |
| Rust bans | `cargo-deny` | all crates | a known telemetry crate appears (Sentry, PostHog, Aptabase…) |
| Rust sources | `cargo-deny` | all crates | a crate comes from outside crates.io |

Permissive allowlist: MIT, MIT-0, Apache-2.0 (including LLVM-exception),
BSD-2-Clause, BSD-3-Clause, ISC, Zlib, 0BSD, CC0-1.0, Unlicense, Unicode-3.0,
BSL-1.0, BlueOak-1.0.0.

## ⚑ Items for the owner's attention

| Component | Licence | Why it's here | Assessment |
|---|---|---|---|
| `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short` (Rust) | MPL-2.0 | Pulled in by Tauri (`tauri-utils` HTML/CSP handling) | Weak, **file-level** copyleft. We use them unmodified from crates.io, so there are no obligations on our code. Allowed as named exceptions only. |
| `option-ext` (Rust) | MPL-2.0 | Pulled in by `dirs` via Tauri | Same as above. |
| WebKitGTK, GTK 3 (Linux system libraries) | LGPL-2.1+ | The Linux WebView. Tauri links them dynamically. | `.deb`/`.rpm` depend on the distro's copies, so we distribute nothing. The **AppImage bundles them** as replaceable shared libraries, which LGPL permits; it needs a notice and a pointer to their source (to add before any public release). Unavoidable for Tauri on Linux. |
| `Swatinem/rust-cache` (GitHub Action) | LGPL-3.0 | CI build cache only | Never shipped or linked into the app, so no effect on our licence. Replaceable with `actions/cache` if preferred. |

## Direct dependencies (Phase 0)

### Shipped in the app

| Package | Licence | Purpose |
|---|---|---|
| `react`, `react-dom` | MIT | UI framework (ADR 0001) |
| `i18next`, `react-i18next` | MIT | UI localisation |
| `@tauri-apps/api` | Apache-2.0 OR MIT | Frontend ↔ Rust bridge |
| `tauri` (crate) | Apache-2.0 OR MIT | Application shell, all targets |
| `serde` (crate) | MIT OR Apache-2.0 | Serialising data across the bridge |

Transitive JS in the bundle: `@babel/runtime`, `html-parse-stringify`,
`scheduler`, `use-sync-external-store` (all MIT). Transitive Rust: about 420
crates, overwhelmingly `MIT OR Apache-2.0`. The only non-permissive ones are
the MPL items above.

Android platform libraries added by the Tauri template (AndroidX, Material
Components, Kotlin stdlib) are Apache-2.0.

### Build, test and CI only (never shipped)

| Package | Licence |
|---|---|
| `vite`, `@vitejs/plugin-react`, `vitest` | MIT |
| `typescript` | Apache-2.0 |
| `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `@eslint-community/eslint-plugin-eslint-comments`, `globals` | MIT |
| `prettier` | MIT |
| `@tauri-apps/cli`, `tauri-build` | Apache-2.0 OR MIT |
| `@types/*` | MIT |
| GitHub Actions: `actions/*`, `pnpm/action-setup`, `dtolnay/rust-toolchain` | MIT |
| `EmbarkStudios/cargo-deny-action` | Apache-2.0 |
| Installer tooling downloaded by Tauri at build time: WiX 3 (MSI), NSIS (setup.exe), linuxdeploy (AppImage) | MS-RL / zlib / MIT. These are build tools; their licences don't cover the installers they produce |

## Heads-up for later phases

Checked early so no phase gets blocked by a surprise licence:

| Phase | Candidate | Licence | Note |
|---|---|---|---|
| 1 | ProseMirror (`prosemirror-*`) | MIT | ✅ |
| 1 | React Aria Components | Apache-2.0 | ✅ |
| 1 | Zustand | MIT | ✅ |
| 1 | `rusqlite` (bundled SQLite) | MIT (SQLite: public domain) | ✅ |
| 3 | Harper | Apache-2.0 | ✅ |
| 3 | `lingua-rs` / `whatlang` | Apache-2.0 / MIT | ✅ |
| 3 | `nspell` (Hunspell-compatible, JS) | MIT | ✅ engine. **Dictionaries vary by language** (some GPL/LGPL/MPL). Download on demand and show each dictionary's licence; never bundle GPL ones. |
| 3 | LanguageTool | LGPL-2.1 | Separate process or server only, never linked (brief §7). ✅ with that constraint. |
| 5 | `docx` (npm) | MIT | ✅ |
| 5 | Typst (optional desktop PDF) | Apache-2.0 | ✅ |
| 6 | `citeproc-js` | CPAL-1.0 / AGPL-3.0 | ⚠ **Avoid.** Use `hayagriva` (Apache-2.0, Rust, reads CSL styles) instead. |
| 6 | CSL style files | CC-BY-SA-3.0 | Data, not code. Ship unmodified with attribution. |
