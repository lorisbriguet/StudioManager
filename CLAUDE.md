# StudioManager: notes for agents

The rules an agent needs before changing this repo. What the app does and how it is laid out is in [the README](README.md); how a release goes out is in [RELEASING.md](RELEASING.md); the UI rules are in [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md); the backlog is [IDEAS.md](IDEAS.md).

## Checks before a commit

Run the commands in [RELEASING.md, step 1](RELEASING.md#1-pre-release-validation-all-must-pass): `npx tsc --noEmit`, `npx vitest run`, `npm run lint`, and `cargo test` plus `cargo clippy` for the app and the MCP server.

- Run cargo from inside `src-tauri` (or `src-tauri/mcp`), never from the repo root.
- On a fresh clone, run `bash scripts/build-mcp.sh` and `npx vite build` once before any cargo command in `src-tauri`: the app crate needs the MCP sidecar binary and `dist/`.
- The TypeScript lib has no ES2022 (no `Array.prototype.at`): `npx tsc --noEmit` catches it.

## Version bump

The version lives in several files that must match the tag: see [RELEASING.md, step 3](RELEASING.md#3-version-bump-semver). The Release build workflow refuses a mismatch.

## Money

- Format amounts with `formatMoney` (screens) or `formatMoneyPdf` (PDFs) from `src/lib/money.ts`. ESLint refuses `toFixed(2)` and `toLocaleString("de-CH")` in `src/`.
- The Swiss rules (QR-bill, no VAT, CHF with other currencies tracked in CHF) are in [the README](README.md#swiss-specific-features).

## Database

- The SQL migrations are in `src-tauri/migrations/`.
- Adding a table, column or index in `ensureSchema` means bumping `SCHEMA_FIXUPS_VERSION` in `src/db/index.ts`, or existing databases skip it.

## Rust commands

A new command is registered in three lists: see "Adding a Rust command" in [the README](README.md#building-from-source).

## Agent access

The MCP server (`src-tauri/mcp`) never deletes and backs up before writing: see [Agent access](docs/agent-access.md) before adding a tool.

## Public repo

The repo is public: no client names, addresses, IBANs, IPs or personal paths in code, fixtures, docs or commit messages.
