#!/usr/bin/env bash
# Checks that an updater tarball is signed by the key the app trusts: the
# pubkey in src-tauri/tauri.conf.json against the signature in latest.json.
# This is the same check the installed app runs before it installs an update.
#   scripts/verify-update-signature.sh StudioManager.app.tar.gz latest.json
# Needs minisign (brew install minisign).
set -euo pipefail

tarball=$1
manifest=$2
conf="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/tauri.conf.json"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

node -e '
  const fs = require("fs");
  const [manifest, conf, out] = process.argv.slice(1);
  const plats = JSON.parse(fs.readFileSync(manifest, "utf8")).platforms;
  const sigs = new Set(Object.values(plats).map((p) => p.signature));
  if (sigs.size !== 1) throw new Error("latest.json: expected one signature for all platforms, got " + sigs.size);
  fs.writeFileSync(out + "/sig", Buffer.from([...sigs][0], "base64"));
  const pubkey = JSON.parse(fs.readFileSync(conf, "utf8")).plugins.updater.pubkey;
  fs.writeFileSync(out + "/key.pub", Buffer.from(pubkey, "base64"));
' "$manifest" "$conf" "$tmp"

minisign -V -p "$tmp/key.pub" -x "$tmp/sig" -m "$tarball"
