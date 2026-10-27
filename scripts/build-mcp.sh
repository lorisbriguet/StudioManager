#!/usr/bin/env bash
# Builds the studiomanager-mcp server and places it where Tauri's externalBin
# expects it: src-tauri/binaries/studiomanager-mcp-<target-triple>.
# Runs before the frontend build (tauri build) and before tauri dev.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${MCP_CARGO_TARGET_DIR:-${HOME}/cargo-target-studiomanager-mcp}"
OUT_DIR="$ROOT/src-tauri/binaries"
NAME=studiomanager-mcp

ver="$(rustc --version | sed -n 's/^rustc \([0-9]*\)\.\([0-9]*\).*/\1 \2/p')"
major="${ver% *}"; minor="${ver#* }"
if [ -z "$ver" ] || [ "$major" -lt 1 ] || { [ "$major" -eq 1 ] && [ "$minor" -lt 88 ]; }; then
  echo "build-mcp: Rust 1.88 or newer is required (found: $(rustc --version 2>&1)). Run: rustup update stable" >&2
  exit 1
fi

triple="${TAURI_ENV_TARGET_TRIPLE:-}"
if [ -z "$triple" ]; then
  triple="$(rustc -vV | sed -n 's/host: //p')"
fi

build() {
  CARGO_TARGET_DIR="$TARGET_DIR" cargo build --release \
    --manifest-path "$ROOT/src-tauri/mcp/Cargo.toml" --target "$1" >&2
}

mkdir -p "$OUT_DIR"
if [ "$triple" = "universal-apple-darwin" ]; then
  build aarch64-apple-darwin
  build x86_64-apple-darwin
  lipo -create -output "$OUT_DIR/$NAME-$triple" \
    "$TARGET_DIR/aarch64-apple-darwin/release/$NAME" \
    "$TARGET_DIR/x86_64-apple-darwin/release/$NAME"
else
  build "$triple"
  cp "$TARGET_DIR/$triple/release/$NAME" "$OUT_DIR/$NAME-$triple"
fi
echo "built $OUT_DIR/$NAME-$triple"
