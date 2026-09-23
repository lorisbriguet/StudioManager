#!/usr/bin/env bash
# Rehearse the organisation layout upgrade on a COPY of the real app data.
# Usage: scripts/rehearse-org-upgrade.sh [source app dir]
#
# Set KEEP=1 to keep the scratch copy around after the run for inspection
# (it holds real invoice/receipt PDFs, so it's deleted by default).
set -euo pipefail
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/cargo-target-studiomanager}"
SRC="${1:-$HOME/Library/Application Support/ch.studiomanager.app}"
WORK="$(mktemp -d /tmp/sm-rehearsal.XXXXXX)"
chmod 700 "$WORK"

cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    echo "KEEP=1 set — leaving rehearsal folder at $WORK"
  else
    rm -rf "$WORK"
    echo "removed rehearsal folder $WORK (set KEEP=1 to keep it; rerun to inspect again)"
  fi
}
trap cleanup EXIT

echo "copying $SRC -> $WORK"
rsync -a --exclude 'studiomanager_test.db*' --exclude 'studiomanager_presentation.db*' "$SRC/" "$WORK/"

before_counts() {
  sqlite3 "$1" "SELECT 'invoices',COUNT(*) FROM invoices UNION ALL SELECT 'expenses',COUNT(*) FROM expenses UNION ALL SELECT 'clients',COUNT(*) FROM clients UNION ALL SELECT 'tasks',COUNT(*) FROM tasks UNION ALL SELECT 'time_entries',COUNT(*) FROM time_entries;"
}
echo "== before =="; before_counts "$WORK/studiomanager.db" | tee "$WORK/before.txt"
find "$WORK/invoices" "$WORK/receipts" -type f -exec md5 -q {} + | sort > "$WORK/files-before.md5"

# The copied database still holds absolute paths pointing at the SOURCE
# folder (rsync copies bytes, not path values). Production's upgrade always
# runs with app_dir == the folder that wrote those paths, so its prefix
# rewrite matches; to rehearse that rewrite honestly here, re-root the
# stored paths onto the scratch copy first, the same way the app itself
# would see them if it were the real app_dir.
reroot() {
  local table="$1" column="$2" dir="$3"
  local src_prefix="$SRC/$dir/" work_prefix="$WORK/$dir/"
  sqlite3 "$WORK/studiomanager.db" "UPDATE $table SET $column = '$work_prefix' || substr($column, length('$src_prefix') + 1) WHERE substr($column, 1, length('$src_prefix')) = '$src_prefix'; SELECT changes();"
}
REROOT_EXPENSES=$(reroot expenses receipt_path receipts)
REROOT_INVOICES=$(reroot invoices pdf_path invoices)
echo "re-rooted expenses.receipt_path: $REROOT_EXPENSES row(s)"
echo "re-rooted invoices.pdf_path: $REROOT_INVOICES row(s)"
REROOT_TOTAL=$((REROOT_EXPENSES + REROOT_INVOICES))

# Run the upgrade through the Rust test harness binary
( cd "$(dirname "$0")/../src-tauri" && cargo run --quiet --bin rehearse-upgrade -- "$WORK" )
ORG=$(ls "$WORK/orgs")
echo "== after (org $ORG) =="; before_counts "$WORK/orgs/$ORG/studiomanager.db" | tee "$WORK/after.txt"
find "$WORK/orgs/$ORG/invoices" "$WORK/orgs/$ORG/receipts" -type f -exec md5 -q {} + | sort > "$WORK/files-after.md5"
diff "$WORK/before.txt" "$WORK/after.txt" && echo "row counts identical"
diff "$WORK/files-before.md5" "$WORK/files-after.md5" && echo "file checksums identical"

FAILED=0

# Check A: nothing should still be sitting at the pre-move, top-level
# scratch paths after the upgrade — everything re-rooted onto $WORK should
# have been rewritten onto $WORK/orgs/<id>/.
UNRESOLVED=$(sqlite3 "$WORK/orgs/$ORG/studiomanager.db" "SELECT receipt_path FROM expenses WHERE receipt_path LIKE '$WORK/receipts/%' UNION ALL SELECT pdf_path FROM invoices WHERE pdf_path LIKE '$WORK/invoices/%';")
UNRESOLVED_COUNT=$(printf '%s\n' "$UNRESOLVED" | grep -c . || true)
if [ "$UNRESOLVED_COUNT" -eq 0 ]; then
  echo "PASS: no rows remain under \$WORK/receipts or \$WORK/invoices (pre-move location)"
else
  echo "FAIL: $UNRESOLVED_COUNT row(s) still reference the pre-move \$WORK path:"
  echo "$UNRESOLVED"
  FAILED=1
fi

# Check B: every row now pointing under $WORK/orgs/ must resolve to a real
# file on disk.
ORG_PATHS=$(sqlite3 "$WORK/orgs/$ORG/studiomanager.db" "SELECT receipt_path FROM expenses WHERE receipt_path LIKE '$WORK/orgs/%' UNION ALL SELECT pdf_path FROM invoices WHERE pdf_path LIKE '$WORK/orgs/%';")
ORG_TOTAL=0
ORG_EXISTING=0
MISSING=""
while IFS= read -r p; do
  [ -z "$p" ] && continue
  ORG_TOTAL=$((ORG_TOTAL + 1))
  if [ -f "$p" ]; then
    ORG_EXISTING=$((ORG_EXISTING + 1))
  else
    MISSING="${MISSING}${p}"$'\n'
  fi
done <<< "$ORG_PATHS"

if [ "$ORG_TOTAL" -gt 0 ] && [ "$ORG_EXISTING" -eq "$ORG_TOTAL" ]; then
  echo "PASS: all $ORG_TOTAL org-rooted paths exist on disk"
elif [ "$ORG_TOTAL" -eq 0 ]; then
  echo "FAIL: no org-rooted paths found (expected the re-rooted rows to have moved under \$WORK/orgs/)"
  FAILED=1
else
  echo "FAIL: $((ORG_TOTAL - ORG_EXISTING)) of $ORG_TOTAL org-rooted paths are missing on disk:"
  echo "$MISSING"
  FAILED=1
fi

# Check C: the row set re-rooted onto the scratch copy before the upgrade
# must be exactly the row set that ends up under $WORK/orgs/ after it.
if [ "$REROOT_TOTAL" -eq "$ORG_TOTAL" ]; then
  echo "PASS: re-rooted row count before ($REROOT_TOTAL) matches org-path row count after ($ORG_TOTAL)"
else
  echo "FAIL: re-rooted row count before ($REROOT_TOTAL) does not match org-path row count after ($ORG_TOTAL)"
  FAILED=1
fi

echo "rehearsal folder: $WORK"

if [ "$FAILED" -ne 0 ]; then
  echo "rehearsal FAILED — see FAIL lines above"
  exit 1
fi
echo "rehearsal PASSED"
