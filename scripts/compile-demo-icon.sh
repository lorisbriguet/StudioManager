#!/bin/bash
# Compile the demo Icon Composer document (Icon/demo/StudioManager.icon: the
# same arrow mark on an indigo tile) into the artifacts the demo build bundles:
#   - src-tauri/icons-demo/Assets.car  -> macOS 26+ icon (Finder prefers it over icon.icns)
#   - src-tauri/icons-demo/icon.icns   -> legacy icon
# Requires Xcode 26+ (actool with .icon support). The document keeps the
# "StudioManager" name so the bundle's CFBundleIconName resolves unchanged.
# Run after editing Icon/demo/StudioManager.icon, then `npm run build:demo`.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

xcrun actool Icon/demo/StudioManager.icon \
  --compile "$OUT" \
  --platform macosx \
  --minimum-deployment-target 11.0 \
  --app-icon StudioManager \
  --include-all-app-icons \
  --output-partial-info-plist "$OUT/partial.plist" > /dev/null

cp "$OUT/Assets.car" src-tauri/icons-demo/Assets.car
cp "$OUT/StudioManager.icns" src-tauri/icons-demo/icon.icns
echo "Compiled: src-tauri/icons-demo/Assets.car + src-tauri/icons-demo/icon.icns"
