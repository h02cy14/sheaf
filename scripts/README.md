# scripts

**Why this exists:** repository tooling that CI runs and that doesn't belong to
any package.

| Script | Run with | Purpose |
|---|---|---|
| `check-deps.mjs` | `pnpm check:deps` | Fails if a shipped JS dependency has a licence off the allowlist, or if any ads/analytics package appears in the lockfile. The Rust equivalent is `cargo deny` with `/deny.toml`. Policy: [docs/licences.md](../docs/licences.md). |
