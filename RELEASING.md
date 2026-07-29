# Releasing StudioManager

Step-by-step guidelines for publishing a new release on GitHub. Follow in order; every gate must pass before moving on. (Claude Code users: the `GitPublisher` skill automates this process — these are the same rules in human-readable form.)

---

## 0. Prerequisites (one-time setup)

- `gh` CLI authenticated against `lorisbriguet/StudioManager`.
- Tauri updater signing key at `~/.tauri/StudioManager.key`. **Never commit it.** Its public key is pinned in `src-tauri/tauri.conf.json` — if the private key is ever lost, shipped apps can no longer auto-update.
- Node **20.19+ or 22.12+** (Vite 7 requirement) and stable Rust.
- On this machine: the repo lives on Synology Drive, which corrupts `node_modules` and `src-tauri/target`. Build with a **local** cargo target dir (see step 4) and run `npm ci` if node_modules acts up. Ideally exclude both folders from sync.

## 1. Pre-release validation (all must pass)

```bash
npx tsc --noEmit        # zero errors
npx vitest run          # all tests green
npm run lint            # exit 0, zero findings
```

- Working tree contains only the changes meant for this release; no debug code, `console.log` leftovers, or commented-out hacks.
- No secrets/PII in the diff (keys, IBANs, personal paths — `scripts/migrate-data.mjs` has historically contained personal data; keep it out of releases or scrubbed).

## 2. Design-system compliance audit (required)

Grep gates from `DESIGN-SYSTEM.md` — all must return **0**:

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
4. `README.md` → the version badge

## 4. Build (signing is load-bearing)

```bash
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/StudioManager.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
CARGO_TARGET_DIR=~/cargo-target-studiomanager npm run tauri build
```

**Without the signing env vars the build still succeeds but produces an invalid update signature** — users' updaters download to 100% then fail with "Update check failed". Never skip them.

Build outputs (under `$CARGO_TARGET_DIR/release/bundle/`):
- `dmg/StudioManager_X.Y.Z_aarch64.dmg`
- `macos/StudioManager.app.tar.gz` + `StudioManager.app.tar.gz.sig`

Smoke-test the built .dmg app (launch, open a few pages, create+delete a draft invoice) before publishing.

## 5. Changelog + docs

- Write the changelog from real commits/changes, grouped: Features / Fixes / Refactors / Breaking. Concise, user-facing wording; no noise.
- Update `README.md`: version badge, feature list if features shipped, remove anything now inaccurate.
- Keep `IDEAS.md` in sync (move shipped items to the Done section).

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

- `git status` clean; tag, `package.json`, `tauri.conf.json`, `Cargo.toml`, README badge all agree.
- `curl -sL https://github.com/lorisbriguet/StudioManager/releases/latest/download/latest.json` returns the new version with a non-empty signature.
- On an installed previous version: Settings → check for updates → the update downloads AND installs (this is the real signature test).
- Note follow-ups/risks in `IDEAS.md`.

## Common failure modes

| Symptom | Cause |
|---|---|
| "Update check failed" immediately | `latest.json` missing from the release or malformed |
| Update downloads to 100% then fails | Build ran without `TAURI_SIGNING_PRIVATE_KEY` (invalid signature) |
| Updater never sees the release | Tag/URL mismatch (`latest.json` url vs actual tag), or release marked draft/pre-release |
| Build flakiness on this machine | Synology-synced `target`/`node_modules` — use local `CARGO_TARGET_DIR`, re-run `npm ci` |
