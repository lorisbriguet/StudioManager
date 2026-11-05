# Releasing StudioManager

Step-by-step guidelines for publishing a new release on GitHub. Follow in order; every gate must pass before moving on. (Claude Code users: the `GitPublisher` skill automates this process — these are the same rules in human-readable form.)

**Building on GitHub instead of this Mac:** after the version bump, the changelog and the tag (steps 3, 5, 7 up to `git push origin main --tags`), run Actions › **Release build** › Run workflow with the version (`gh workflow run release.yml -f version=X.Y.Z`) and approve it when it asks (the `release` environment). It runs the gates of steps 1 and 2, builds and signs (step 4), writes `latest.json` (step 6) and creates a **draft** release with the three assets. Download the `.dmg` from the draft, smoke-test it, then publish the draft and do step 8. One-time setup: the updater key as the `TAURI_SIGNING_PRIVATE_KEY` secret of the `release` environment (`gh secret set TAURI_SIGNING_PRIVATE_KEY --env release < ~/.tauri/StudioManager.key`). The workflow is [.github/workflows/release.yml](.github/workflows/release.yml).

---

## 0. Prerequisites (one-time setup)

- `gh` CLI authenticated against `lorisbriguet/StudioManager`.
- Tauri updater signing key at `~/.tauri/StudioManager.key`. **Never commit it.** Its public key is pinned in `src-tauri/tauri.conf.json` — if the private key is ever lost, shipped apps can no longer auto-update.
- Node **20.19+ or 22.12+** (Vite 7 requirement) and stable Rust.
- Use **npm 11** for installs and lockfile changes (`npx -y npm@11 install`): npm 10.9 crashes with `Cannot read properties of null (reading 'edgesOut')` on Vitest 4's peer set.
- On this machine: the repo lives on Synology Drive, which corrupts `node_modules` and `src-tauri/target`. Build with a **local** cargo target dir (see step 4) and run `npm ci` if node_modules acts up. Ideally exclude both folders from sync.

## 1. Pre-release validation (all must pass)

```bash
npx tsc --noEmit        # zero errors
npx vitest run          # all tests green
npm run lint            # exit 0, zero findings
(cd src-tauri/mcp && CARGO_TARGET_DIR=~/cargo-target-studiomanager-mcp cargo test && CARGO_TARGET_DIR=~/cargo-target-studiomanager-mcp cargo clippy --all-targets -- -D warnings)
```

Run `bash scripts/build-mcp.sh` once on a fresh clone before any `cargo` command in `src-tauri` (it creates the git-ignored `src-tauri/binaries/studiomanager-mcp-<triple>` that Tauri's externalBin requires). The `studiomanager-mcp` crate (`src-tauri/mcp`) needs Rust 1.88+. Never run `cargo fmt` there: it reformats the files it shares with the app through `#[path]` includes.

- Working tree contains only the changes meant for this release; no debug code, `console.log` leftovers, or commented-out hacks.
- No secrets/PII in the diff (keys, IBANs, personal paths). `scripts/migrate-data.mjs` was deleted in the 2026-08 audit for exactly this reason — anything similar must read personal values from env, never hardcode them. Note the repo is PUBLIC.
- If the release changes the data layout, run `scripts/rehearse-org-upgrade.sh` against the real folder first and recommend Backup Now in the release notes.
- **Open pull requests and branches:** run `gh pr list --state open` and `git branch -r --no-merged origin/main`. Every PR or branch meant for this release is merged first; any other is left out on purpose and named in the release notes. 3.3.0 shipped without the agent Upkeep tools because their PR (#22) was never merged, while the installed app had been built from that branch.
- **Agent tools:** the MCP protocol test (`src-tauri/mcp/tests/protocol.rs`) lists every tool group that must ship (money, Upkeep). A release that removes a tool on purpose updates that list in the same PR and says so in the changelog. After installing the release, reconnect the agent tools in Claude Code (`/mcp` › studiomanager › Reconnect) and check that `get_machine` answers. See [Agent access](docs/agent-access.md).

## 2. Design-system compliance audit (required)

Grep gates from [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) — all must return **0**:

```bash
grep -rnE 'bg-gray-|text-gray-|border-gray-|divide-gray-' src --include='*.tsx' | wc -l
grep -rn 'dark:' src --include='*.tsx' | grep -v '// ' | grep -vE 'dark: boolean|darkMode' | wc -l
grep -rnE '>[✕←→✓▸↑↓]<' src --include='*.tsx' | wc -l
```

Plus the checklist: badges/tags `rounded-full`, inputs/selects `rounded-lg`, small buttons `rounded-md`, lucide icons at standard sizes, all user-visible strings through `useT()`/`getLabels()`, status colors from `statusColors.ts`. EN/FR key parity in `src/i18n/ui.ts` must be exact (equal counts, FR accent-free).

## 3. Version bump (SemVer)

Decide the bump from the actual changes: MAJOR = breaking, MINOR = features, PATCH = fixes only. Then update the version in **all four places** — they must match exactly:

1. `package.json` → `"version"`
2. `src-tauri/tauri.conf.json` → `"version"`
3. `src-tauri/Cargo.toml` → `version` (then run a build/`cargo check` so `Cargo.lock` updates)
4. [README.md](README.md) → the version badge

## 4. Build (signing is load-bearing)

```bash
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/StudioManager.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
CARGO_TARGET_DIR=~/cargo-target-studiomanager npm run tauri build
```

`scripts/build-mcp.sh` runs automatically as part of `beforeBuildCommand` (and `beforeDevCommand`), before the frontend build. It builds the `studiomanager-mcp` server in release mode into `~/cargo-target-studiomanager-mcp` and copies it to `src-tauri/binaries/studiomanager-mcp-<target-triple>` (git-ignored), which Tauri bundles as `Contents/MacOS/studiomanager-mcp`. Check it is there after the build, and that `StudioManager.app/Contents/MacOS/studiomanager-mcp --print-data-dir` ends in `ch.studiomanager.app`. A `universal-apple-darwin` target builds both architectures and joins them with `lipo`; it needs both rustup targets installed (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`). See [docs/agent-access.md](docs/agent-access.md) for the feature itself.

**Without the signing env vars the build still succeeds but produces an invalid update signature** — users' updaters download to 100% then fail with "Update check failed". Never skip them.

Build outputs (under `$CARGO_TARGET_DIR/release/bundle/`):
- `dmg/StudioManager_X.Y.Z_aarch64.dmg`
- `macos/StudioManager.app.tar.gz` + `StudioManager.app.tar.gz.sig`

Smoke-test the built .dmg app (launch, open a few pages, create+delete a draft invoice) before publishing.

## 5. Changelog + docs

- Write the changelog from real commits/changes, grouped: Features / Fixes / Refactors / Breaking. Concise, user-facing wording; no noise.
- Update [README.md](README.md): version badge, feature list if features shipped, remove anything now inaccurate.
- Keep [IDEAS.md](IDEAS.md) in sync (move shipped items to the Done section).

## 6. latest.json (the auto-updater manifest)

The in-app updater fetches `releases/latest/download/latest.json`. **If it's missing or malformed, every installed app shows "Update check failed".** Exact format:

```json
{
  "version": "X.Y.Z",
  "notes": "Release description",
  "pub_date": "YYYY-MM-DDTHH:MM:SSZ",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of StudioManager.app.tar.gz.sig>",
      "url": "https://github.com/lorisbriguet/StudioManager/releases/download/vX.Y.Z/StudioManager.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "<same signature>",
      "url": "https://github.com/lorisbriguet/StudioManager/releases/download/vX.Y.Z/StudioManager.app.tar.gz"
    }
  }
}
```

The signature is the literal contents of the `.sig` file from step 4. The `url` must reference the tag you are about to create (`vX.Y.Z`).

## 7. Commit, tag, release

```bash
git add <release files>            # only what belongs in the release
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z                     # tag == version, always v-prefixed
git push origin main --tags

gh release create vX.Y.Z \
  --title "StudioManager vX.Y.Z" \
  --notes-file <changelog file> \
  StudioManager_X.Y.Z_aarch64.dmg \
  StudioManager.app.tar.gz \
  latest.json
```

**Every release must carry all three assets** (.dmg, .app.tar.gz, latest.json). Use `gh release upload vX.Y.Z <file> --clobber` to replace an asset.

## 8. Post-release validation

- `git status` clean; tag, `package.json`, `tauri.conf.json`, `Cargo.toml`, [README](README.md) badge all agree.
- `curl -sL https://github.com/lorisbriguet/StudioManager/releases/latest/download/latest.json` returns the new version with a non-empty signature.
- On an installed previous version: Settings → check for updates → the update downloads AND installs (this is the real signature test).
- Menu bar, by hand on the installed build (no test covers macOS windows, Spaces or focus): see [Menu bar checks](#menu-bar-checks) below.
- Note follow-ups/risks in [IDEAS.md](IDEAS.md).

### Menu bar checks

Run these with Agents and **Show in menu bar** on (see [the menu bar guide](docs/menu-bar.md)). Each line is one thing that broke before or that only a real Mac shows.

1. **Login:** log out and in. StudioManager starts with its window hidden, and the icon is in the menu bar.
2. **Close vs quit:** close the main window: the icon stays and the Dock icon stays. Click the Dock icon: the window comes back. Cmd+Q: the icon goes away.
3. **Focus:** in Finder, click the icon. The panel opens, Finder's menus stay in the menu bar, and the main window does not come forward. Type in the panel: the keys go to the panel.
4. **Closing the panel:** click the desktop, another app, then the main window. Each closes the panel, and the app you clicked keeps the focus.
5. **Spaces:** switch to another Space and click the icon. The panel opens on that Space, with no jump back to the first one.
6. **Full screen:** put another app in full screen and click the icon. The panel shows over it.
7. **Needs you:** start an agent that asks a question. The icon turns amber and the Agents tab lists it under Needs you. Answer from the panel: the icon goes back to normal.
8. **Usage:** after a Claude Code reply, the Usage tab shows the plan limits with a reset time.
9. **Day:** run a command routine by hand. It asks first, then shows Running and then Done with its last output line. Run a long one (for example a script that sleeps a minute) and Cmd+Q while it runs: the script stops too (`ps` no longer lists it), and after a restart the Day tab shows it as Interrupted.
10. **Theme and language:** switch dark/light and FR/EN in Settings. The open panel follows without a restart.

## Demo build (never published)

`npm run build:demo` builds **StudioManager Demo** from `src-tauri/tauri.demo.conf.json`: identifier `ch.studiomanager.demo`, own data folder at `~/Library/Application Support/ch.studiomanager.demo/`, updater pointed at a manifest that does not exist, no updater artefacts, so no signing key is needed. It installs next to the real app and bundles its own copy of the MCP server, which resolves the demo data folder (`--print-data-dir` ends in `ch.studiomanager.demo`) and registers as `studiomanager-demo`. Use it for presentations only; the release procedure above always uses the plain `npm run tauri build`. The demo build sets `VITE_DEMO_BUILD=1`, which enables the Settings › Data › Demo data card and disables the startup update check.

## Common failure modes

| Symptom | Cause |
|---|---|
| "Update check failed" immediately | `latest.json` missing from the release or malformed |
| Update downloads to 100% then fails | Build ran without `TAURI_SIGNING_PRIVATE_KEY` (invalid signature) |
| Updater never sees the release | Tag/URL mismatch (`latest.json` url vs actual tag), or release marked draft/pre-release |
| Build flakiness on this machine | Synology-synced `target`/`node_modules` — use local `CARGO_TARGET_DIR`, re-run `npm ci` |
