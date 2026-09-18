# @sheaf/app

**Why this exists:** this is the application itself: the React frontend that
every user sees, plus the Tauri shell (`src-tauri/`) that turns it into an app
on Windows, Linux, Android and iOS. One frontend, one Rust core, four targets
(ADR 0001).

## Layout

| Path | What it is |
|---|---|
| `src/App.tsx` | Phase 0 placeholder screen (see below) |
| `src/i18n/` | Localisation setup. Adding a language needs no code change; see its README |
| `src/locales/<tag>/*.json` | Translation files, one folder per BCP 47 tag |
| `src/platform/` | The **only** place that talks to Tauri; see its README |
| `src/styles/base.css` | Design tokens (light and dark), global accessibility defaults |
| `src-tauri/` | Rust shell; see its README |
| `assets/icon.svg` | Master app icon; `pnpm tauri icon assets/icon.svg --ios-color "#1f3a5f"` regenerates every platform icon |

## The Phase 0 screen

It isn't a product screen. It proves, on each target, that:

- the shell starts and **the Rust bridge answers** (the footer shows OS, CPU
  architecture and version, straight from Rust);
- **i18n and RTL switching** work (language picker, `lang`/`dir` on `<html>`);
- the **software keyboard and IME** can type into a field without covering it;
- the **content security policy** blocks all network access.

## Scripts

`pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm test` · `pnpm tauri <cmd>`
