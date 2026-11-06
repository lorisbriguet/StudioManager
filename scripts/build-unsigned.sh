#!/usr/bin/env bash
# Release build without the updater key (RELEASING.md, step 4). The key is
# used afterwards by `tauri signer sign`, so no dependency, build.rs or
# proc-macro of the build ever runs next to it.
#
#   CARGO_TARGET_DIR=~/cargo-target-studiomanager bash scripts/build-unsigned.sh
#
# Tauri writes every bundle, the updater .app.tar.gz included, then exits 1
# with "A public key has been found, but no private key". That one error is
# expected here; any other error fails the build.
set -uo pipefail

unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PATH TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
      TAURI_PRIVATE_KEY TAURI_PRIVATE_KEY_PATH TAURI_PRIVATE_KEY_PASSWORD

target="${CARGO_TARGET_DIR:-src-tauri/target}"
tarball="$target/release/bundle/macos/StudioManager.app.tar.gz"
rm -f "$tarball" "$tarball.sig"

log=$(mktemp)
npm run tauri build 2>&1 | tee "$log"
status=${PIPESTATUS[0]}

if [ "$status" -ne 0 ]; then
  errors=$(sed $'s/\x1b\\[[0-9;]*m//g' "$log" | grep -E '^[[:space:]]*Error ')
  case "$errors" in
    *$'\n'*) echo "build failed"; exit "$status" ;;
    *"A public key has been found, but no private key"*) ;;
    *) echo "build failed"; exit "$status" ;;
  esac
fi

test -s "$tarball" || { echo "build failed: no $tarball"; exit 1; }
echo
echo "Unsigned build ready: $tarball"
echo "Sign it next (RELEASING.md, step 4)."
