# scripts

**Why this exists:** repository tooling that CI runs and that doesn't belong to
any package.

| Script | Run with | Purpose |
|---|---|---|
| `check-deps.mjs` | `pnpm check:deps` | Fails if a shipped JS dependency has a licence off the allowlist, or if any ads/analytics package appears in the lockfile. The Rust equivalent is `cargo deny` with `/deny.toml`. Policy: [docs/licences.md](../docs/licences.md). |
| `check-source-chars.mjs` | `pnpm check:chars` | Fails if source files contain invisible or bidirectional characters (a NUL byte once slipped into a Markdown test fixture). |
| `e2e-native-forcequit.mjs` | `node scripts/e2e-native-forcequit.mjs <sheaf.exe>` | Phase 1 acceptance, against the built Windows app: types 5,000 words across 20 documents through the real editor, kills the process outright, then checks the files on disk and the relaunched app. |
| `e2e-native-history.mjs` | `node scripts/e2e-native-history.mjs <sheaf.exe>` | Phase 2 acceptance, against the built Windows app: keeps a snapshot, destroys the paragraph, restores it, and checks the snapshot files the Rust layer wrote. |
