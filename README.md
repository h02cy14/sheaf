# Sheaf

A local-first app for long-form writing: novels, articles, research. Break a
manuscript into hundreds of small pieces, see them as an outline or as index
cards, restructure freely, track each piece's status, then compile everything
into one document.

Runs on **Windows, Linux, Android and iOS** from one codebase.
**No ads. No tracking. No account.** Your writing stays in plain files on your
device ([privacy](docs/privacy.md)).

> **Status: Phase 0 (foundations).** The app shell, build pipeline and
> localisation are in place; there is no editor yet. See [PROGRESS.md](PROGRESS.md).

## Repository layout

```
apps/sheaf/            The app: React + TypeScript frontend
  src/                   UI, i18n, platform bridge
  src-tauri/             Rust shell (Tauri 2) shared by all targets
    gen/android/           Generated Android project (committed; has our signing config)
packages/core/         Platform-independent domain logic (project format, compile…)
docs/adr/              Architecture decision records. Start with 0001-stack.md
docs/licences.md       Dependency licence audit
docs/ci.md             CI, test builds, signing, local build commands
docs/privacy.md        What the app sends where (nothing)
scripts/               Repository tooling (dependency guardrails)
```

## Getting started

```bash
pnpm install
pnpm dev          # frontend in a browser
pnpm tauri dev    # the desktop app
pnpm check        # lint, typecheck, tests, formatting, licence checks
```

Full prerequisites and mobile commands: [docs/ci.md](docs/ci.md#building-locally).

## Licence

[Apache-2.0](LICENSE). "Sheaf" is a working name.
