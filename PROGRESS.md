# Progress

_Last updated: 2026-09-18, end of Phase 0 working session 1._

## Owner decisions and working assumptions

| Question (brief §10) | Answer | Source |
|---|---|---|
| Open source? | **Yes: Apache-2.0**, public GitHub repo | Owner, 2026-09-18 |
| Monetisation | Undecided. **Assumption:** no IAP/licensing layer until the owner decides; nothing in the architecture depends on it | Assumption |
| macOS in scope? | **No** (Tauri would support it cheaply later) | Owner, 2026-09-18 |
| First UI languages | **Assumption:** English + Simplified Chinese | Brief default |
| Sync | **Assumption:** not in v1. The file format (Phase 1) is designed to survive Dropbox/iCloud/Syncthing folder sync; Phase 8 only on go-ahead | Brief default |
| Apple Developer account | Owner **has one**; iOS signing gets wired up from repository secrets | Owner, 2026-09-18 |
| App name | **Sheaf** (working name; needs a trademark search before public launch) | Owner, 2026-09-18 |

## Phase 0: Foundations

### Done

- **Stack decided:** [ADR 0001](docs/adr/0001-stack.md). Tauri 2 on all targets, React 19, ProseMirror, Zustand, SQLite via Rust, with kill criteria for the mobile shell.
- **Monorepo:** pnpm workspace (`apps/sheaf`, `packages/core`) + Cargo workspace; TypeScript 6 strict (with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- **Engineering guardrails, enforced in CI:** `any` is a lint error; eslint-disable comments must give a reason; only `src/platform/` may import Tauri; `@sheaf/core` can't touch DOM, Node or Tauri (compiler + lint); Prettier; rustfmt; clippy `-D warnings`.
- **i18n:** i18next with **auto-discovered locales** (adding a language = adding a folder), type-checked keys, `lang`/`dir` sync for RTL, script-aware language matching (zh-TW is not served zh-Hans). English + 简体中文 shipped.
- **Tests:** 25 unit tests (locale matching + translation completeness: keys, placeholders, CLDR plural categories).
- **Licence and privacy guardrails:** `scripts/check-deps.mjs` (JS licence allowlist + ads/tracking denylist), `deny.toml` (cargo-deny: licences, telemetry-crate bans, sources). Audit in [docs/licences.md](docs/licences.md). Privacy statement in [docs/privacy.md](docs/privacy.md). The CSP blocks all network access (verified in the real Windows app).
- **Phase 0 app** (placeholder screen proving shell, Rust bridge, i18n, keyboard field), with dark mode, reduced motion, iOS Dynamic Type, safe areas, 44 px touch targets.
- **Verified locally:**
  - **Windows:** `pnpm tauri build` → 1.5 MB NSIS installer, 2.2 MB MSI. The app launches, and the Rust bridge reports "Running on Windows (x86_64)" (checked over the WebView2 debug protocol).
  - **Android:** `pnpm tauri android build` → 13.4 MB APK, signed with the dev key. Installed and launched on the emulator (API 36): renders correctly, bridge reports "Running on Android (x86_64)", cold start 564 ms.
- **CI workflow written:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) covers checks, Rust licences, Windows, Linux, Android, iOS, and a rolling `dev-build` pre-release. See [docs/ci.md](docs/ci.md).
- **Android dev signing key** generated at `%USERPROFILE%\.sheaf-signing\` (outside the repo).

### Blocked, needs the owner

1. **GitHub login.** Run `"C:\Program Files\GitHub CLI\gh.exe" auth login`. Until then: no repo, no push, no CI run, and **Linux and iOS builds are unverified** (neither can be built on this Windows machine).
2. **Final bundle identifier.** Temporarily `io.github.placeholder.sheaf`; becomes `io.github.<username>.sheaf` once the GitHub username is known (then `tauri android init` is re-run and the signing block re-applied).

### Open issues and observations

- **Android ANR seen once** on the emulator: a 5 s main-thread stall right after a snapshot boot, while `uiautomator` was switching accessibility on. A clean relaunch showed no stall (564 ms start). Watch for it on real devices.
- **Keyboard/IME not yet verified on a phone.** On the emulator, Gboard's stylus tutorial intercepted scripted input. Real-device keyboard checks are part of ADR 0001's kill criteria at the end of Phase 1.
- **Android `INTERNET` permission** is present (Tauri's dev server needs it). Investigate removing it from release builds, so the OS itself guarantees the app can't reach the network.
- `rust-advisories` CI job is informational: Tauri's Linux stack (gtk-rs 0.18) carries upstream "unmaintained" advisories.

### Next

1. Owner logs in to GitHub → create the public repo, fix the identifier, push, get CI green on all four targets, add the Android signing secrets.
2. Owner installs the Windows installer and the Android APK from the `dev-build` release (Phase 0 "done when").
3. Owner review of Phase 0 → Phase 1 (project format, ADR 0002).
