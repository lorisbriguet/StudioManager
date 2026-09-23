#!/usr/bin/env bash
# Rehearse the organisation layout upgrade on a COPY of the real app data.
# Usage: scripts/rehearse-org-upgrade.sh [source app dir]
set -euo pipefail
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/cargo-target-studiomanager}"
SRC="${1:-$HOME/Library/Application Support/ch.studiomanager.app}"
WORK="$(mktemp -d /tmp/sm-rehearsal.XXXXXX)"
echo "copying $SRC -> $WORK"
rsync -a --exclude 'studiomanager_test.db*' --exclude 'studiomanager_presentation.db*' "$SRC/" "$WORK/"
before_counts() {
  sqlite3 "$1" "SELECT 'invoices',COUNT(*) FROM invoices UNION ALL SELECT 'expenses',COUNT(*) FROM expenses UNION ALL SELECT 'clients',COUNT(*) FROM clients UNION ALL SELECT 'tasks',COUNT(*) FROM tasks UNION ALL SELECT 'time_entries',COUNT(*) FROM time_entries;"
}
echo "== before =="; before_counts "$WORK/studiomanager.db" | tee "$WORK/before.txt"
find "$WORK/invoices" "$WORK/receipts" -type f -exec md5 -q {} + | sort > "$WORK/files-before.md5"
# Run the upgrade through the Rust test harness binary
( cd "$(dirname "$0")/../src-tauri" && cargo run --quiet --bin rehearse-upgrade -- "$WORK" )
ORG=$(ls "$WORK/orgs")
echo "== after (org $ORG) =="; before_counts "$WORK/orgs/$ORG/studiomanager.db" | tee "$WORK/after.txt"
find "$WORK/orgs/$ORG/invoices" "$WORK/orgs/$ORG/receipts" -type f -exec md5 -q {} + | sort > "$WORK/files-after.md5"
diff "$WORK/before.txt" "$WORK/after.txt" && echo "row counts identical"
diff "$WORK/files-before.md5" "$WORK/files-after.md5" && echo "file checksums identical"
echo "unresolved paths:"; sqlite3 "$WORK/orgs/$ORG/studiomanager.db" "SELECT receipt_path FROM expenses WHERE receipt_path LIKE '$SRC/receipts/%' UNION ALL SELECT pdf_path FROM invoices WHERE pdf_path LIKE '$SRC/invoices/%';"
echo "rehearsal folder: $WORK"
