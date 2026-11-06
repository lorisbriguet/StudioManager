# Releasing StudioManager

Step-by-step guidelines for publishing a new release on GitHub. Follow in order; every gate must pass before moving on. (Claude Code users: the `GitPublisher` skill automates this process — these are the same rules in human-readable form.)

**Building on GitHub instead of this Mac:** after the version bump, the changelog and the tag (steps 3, 5, 7 up to `git push origin main --tags`), start the **Release build** workflow on the tag (`gh workflow run release.yml --ref vX.Y.Z -f version=X.Y.Z`, or Actions › Release build › Run workflow with "Use workflow from" set to the tag) and approve it when it asks (the `release` environment). It runs the gates of steps 1 and 2, builds without the key, then signs on a separate runner (step 4), writes `latest.json` (step 6) and creates a **draft** release with the three assets. A version with a suffix (`3.4.1-rc.1`) becomes a prerelease draft: once published it is never "latest", so installed apps don't update to it. Download the `.dmg` from the draft, smoke-test it, then publish the draft and do step 8. One-time setup: the updater key and its password as secrets of the `release` environment (`gh secret set TAURI_SIGNING_PRIVATE_KEY --env release < ~/.tauri/StudioManager.key`, then `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --env release`, which asks for the password). The workflow refuses a key without a password: until the first [rotation](#rotate-the-key), build and sign on this Mac. The workflow is [.github/workflows/release.yml](.github/workflows/release.yml).

---

## 0. Prerequisites (one-time setup)

- `gh` CLI authenticated against `lorisbriguet/StudioManager`.
- Tauri updater signing key at `~/.tauri/StudioManager.key`, protected by a password kept in the login Keychain (service `StudioManager-updater-key`). **Never commit it.** Its public key is pinned in `src-tauri/tauri.conf.json`: installed apps only accept updates signed with this key. Keep a backup of the key file and its password outside this Mac (password manager). For a new key, a lost one or a leaked one, see [Updater key: rotation, loss, leak](#updater-key-rotation-loss-leak). (The original key has no password and no Keychain entry: until the first rotation, use `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""` in step 4.)
- Node **20.19+ or 22.12+** (Vite 7 requirement) and stable Rust.
- Use **npm 11** for installs and lockfile changes (`npx -y npm@11 install`): npm 10.9 crashes with `Cannot read properties of null (reading 'edgesOut')` on Vitest 4's peer set.
- On this machine: the repo lives on Synology Drive, which corrupts `node_modules` and `src-tauri/target`. Build with a **local** cargo target dir (see step 4) and run `npm ci` if node_modules acts up. Ideally exclude both folders from sync.

## 1. Pre-release validation (all must pass)

```bash
npx tsc --noEmit        # zero errors
npx vitest run          # all tests green
npm run lint            # exit 0, zero findings
(cd src-tauri/mcp && CARGO_TARGET_DIR=~/cargo-target-studiomanager-mcp cargo test && CARGO_TARGET_DIR=~/cargo-target-studiomanager-mcp cargo clippy --all-targets -- -D warnings)
(cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings)
```

Run `bash scripts/build-mcp.sh` and `npx vite build` once on a fresh clone before any `cargo` command in `src-tauri` (they create the git-ignored `src-tauri/binaries/studiomanager-mcp-<triple>` that Tauri's externalBin requires and the `dist/` folder the app crate embeds). CI runs the app checks on every push (the `rust` job in [.github/workflows/ci.yml](.github/workflows/ci.yml)) with the latest stable clippy: run `rustup update stable` first so your local lints match. The `studiomanager-mcp` crate (`src-tauri/mcp`) needs Rust 1.88+. Never run `cargo fmt` there: it reformats the files it shares with the app through `#[path]` includes.

- **Dependency audit green:** `npm audit --audit-level=moderate` and `cargo audit` (in `src-tauri` and `src-tauri/mcp`) pass, as in [.github/workflows/dependency-audit.yml](.github/workflows/dependency-audit.yml). The Release build workflow runs it on the tag first and stops on a failure; for a build on this Mac, check `gh run list --workflow dependency-audit.yml -L 1` is green. v2.2.0 to v3.3.1 shipped while it was red.
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

Decide the bump from the actual changes: MAJOR = breaking, MINOR = features, PATCH = fixes only. Then update the version in **all three places** — they must match exactly (the Release build workflow checks them against the tag):

1. `package.json` → `"version"`
2. `src-tauri/tauri.conf.json` → `"version"`
3. `src-tauri/Cargo.toml` → `version` (then run a build/`cargo check` so `Cargo.lock` updates)

The version badge in [README.md](README.md) reads the latest GitHub release by itself: nothing to change there.

## 4. Build, then sign (signing is load-bearing)

```bash
export CARGO_TARGET_DIR=~/cargo-target-studiomanager
bash scripts/build-unsigned.sh
b=$CARGO_TARGET_DIR/release/bundle/macos/StudioManager.app.tar.gz
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -a "$USER" -s StudioManager-updater-key -w)" \
  npx tauri signer sign -f ~/.tauri/StudioManager.key --app-version X.Y.Z "$b"
node scripts/verify-update-signature.mjs "$b" "$b.sig"
```

The build never sees the key: [scripts/build-unsigned.sh](scripts/build-unsigned.sh) clears the signing variables, runs `npm run tauri build`, and accepts its one expected error ("A public key has been found, but no private key"), which comes after every bundle is written. Only the Tauri signer, run on its own afterwards, reads the key and the password. The last line checks the signature against the pubkey in `tauri.conf.json`, the way the installed app will. During a key rotation, check against the previous release's pubkey instead (see [Rotate the key](#rotate-the-key)).

`scripts/build-mcp.sh` runs automatically as part of `beforeBuildCommand` (and `beforeDevCommand`), before the frontend build. It builds the `studiomanager-mcp` server in release mode into `~/cargo-target-studiomanager-mcp` and copies it to `src-tauri/binaries/studiomanager-mcp-<target-triple>` (git-ignored), which Tauri bundles as `Contents/MacOS/studiomanager-mcp`. Check it is there after the build, and that `StudioManager.app/Contents/MacOS/studiomanager-mcp --print-data-dir` ends in `ch.studiomanager.app`. A `universal-apple-darwin` target builds both architectures and joins them with `lipo`; it needs both rustup targets installed (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`). See [docs/agent-access.md](docs/agent-access.md) for the feature itself.

**An update without a valid `.sig` breaks the updater**: users' updaters download to 100% then fail with "Update check failed". Never publish before `verify-update-signature.mjs` says `signature OK`.

Build outputs (under `$CARGO_TARGET_DIR/release/bundle/`):
- `dmg/StudioManager_X.Y.Z_aarch64.dmg`
- `macos/StudioManager.app.tar.gz` + `StudioManager.app.tar.gz.sig`

Smoke-test the built .dmg app (launch, open a few pages, create+delete a draft invoice) before publishing.

## 5. Changelog + docs

- Write the changelog from real commits/changes, grouped: Features / Fixes / Refactors / Breaking. Concise, user-facing wording; no noise.
- Update [README.md](README.md): feature list if features shipped, remove anything now inaccurate.
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
    }
  }
}
```

The build is Apple silicon only, so there is no `darwin-x86_64` entry: an Intel Mac would download a bundle it cannot run. The signature is the literal contents of the `.sig` file from step 4. The `url` must reference the tag you are about to create (`vX.Y.Z`).

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

- `git status` clean; tag, `package.json`, `tauri.conf.json`, `Cargo.toml` all agree; the [README](README.md) badge shows the new version.
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
| Update downloads to 100% then fails | Signature missing, or made with a key the installed app doesn't know (`verify-update-signature.mjs` says which key signed it) |
| Sign step: "incorrect updater private key password" | The `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret (or the Keychain entry) doesn't match the key |
| "Check installed apps accept the signature" fails | The `release` environment holds a different key than the latest published release's pubkey |
| Updater never sees the release | Tag/URL mismatch (`latest.json` url vs actual tag), or release marked draft/pre-release |
| Build flakiness on this machine | Synology-synced `target`/`node_modules` — use local `CARGO_TARGET_DIR`, re-run `npm ci` |

## Updater key: rotation, loss, leak

Every installed StudioManager accepts an update only if it is signed with the private key that matches the pubkey it was built with (`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`). Updates come from this repo's GitHub releases, so a forged update needs both the key and a way to publish here, or to replace what users download.

Where the key lives: `~/.tauri/StudioManager.key` on the MacBook, the `TAURI_SIGNING_PRIVATE_KEY` secret of the `release` environment (GitHub never shows it again) and the backup. The password: the Keychain (`StudioManager-updater-key`), the `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret and the backup.

### Rotate the key

To move to a new key, for example the first move away from the original key, which has no password:

1. Make the new key, with a password: `npx tauri signer generate -w ~/.tauri/StudioManager-new.key` (it asks for the password twice). Save the password in the Keychain under a separate name, so the old key's password stays for step 3: `security add-generic-password -a "$USER" -s StudioManager-updater-key-new -w` (it asks for it). Back up the key file and the password.
2. In the next release, replace `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` with the contents of `~/.tauri/StudioManager-new.key.pub`.
3. Sign that release with the **old** key, because installed apps only know the old pubkey. Build and sign it on this Mac with step 4 as written: it still uses the old key and the old Keychain password (`TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""` for the original key). Then check it against the previous release's pubkey:
   ```bash
   git show vPREVIOUS:src-tauri/tauri.conf.json \
     | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).plugins.updater.pubkey' > /tmp/old.pub
   node scripts/verify-update-signature.mjs "$b" "$b.sig" @/tmp/old.pub
   ```
   (Step 4's own check fails here, because it uses the new pubkey: that is expected.) The Release build workflow requires a password, so it can't sign with the original key. Publish the release as usual (steps 5 to 8).
4. Once it is published, switch to the new key everywhere: `mv ~/.tauri/StudioManager-new.key ~/.tauri/StudioManager.key` (and the `.pub`); move the password to the usual Keychain name with `security add-generic-password -a "$USER" -s StudioManager-updater-key -U -w` (it asks for the new password) and `security delete-generic-password -a "$USER" -s StudioManager-updater-key-new`; then `gh secret set TAURI_SIGNING_PRIVATE_KEY --env release < ~/.tauri/StudioManager.key` and `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --env release`. From the next release on, the workflow checks against the new pubkey.
5. Wait a few weeks before the release after it: an app that skips the rotation release can't accept updates signed with the new key and has to be reinstalled from the `.dmg`. Then delete the old key and its backup.

### Lost key or password

No update can be signed that installed apps accept. Make a new key (rotation step 1), put its pubkey in `tauri.conf.json`, switch to it (rotation step 4), then build and sign the release on this Mac (step 4: its check uses the new pubkey). The workflow can't ship this release, since it checks against the lost key's pubkey; it works again from the release after. Every installed app then has to be updated by hand once: download the `.dmg` from the release and replace the app in Applications. The data stays where it is (`~/Library/Application Support/ch.studiomanager.app/`). Say so at the top of the release notes: apps on an old version see the update fail at 100%.

### Leaked key, or a runner, a dependency or this Mac may be compromised

1. Delete both secrets from the `release` environment (Settings › Environments › release, or `gh secret delete TAURI_SIGNING_PRIVATE_KEY --env release` and the same for the password).
2. Check every published release and its `latest.json`: each should be one you made. Delete any you didn't. If GitHub access may be compromised too, sign out other sessions, revoke tokens and check deploy keys first.
3. Rotate the key at once (the steps above, without the wait in step 5). Installed apps still only accept the old key, so the rotation release is signed with it one last time; then delete it.
4. If a forged update may have been installed, tell users to reinstall from the `.dmg` of the rotation release.
