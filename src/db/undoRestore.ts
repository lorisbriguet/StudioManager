import { getDb, TransactionBatch, validateFields } from "./index";
import { useUndoStore } from "../stores/undo-store";

/**
 * Undo for deletes that have no restore query of their own: copy the rows
 * before deleting, put the very same rows back (same ids, so whatever points
 * at them still does) on undo.
 *
 *   const snap = await snapshotRows([{ table: "custom_lists", where: "id = $1", params: [id] },
 *                                    { table: "custom_list_items", where: "list_id = $1", params: [id] }]);
 *   await q.deleteCustomList(id);
 *   pushRestore(label, snap, { redo: () => q.deleteCustomList(id), invalidate });
 *
 * `table` and `where` are constants written in the hooks, never user input.
 */
export interface RowSnapshot {
  table: string;
  rows: Record<string, unknown>[];
}

export async function snapshotRows(
  parts: { table: string; where: string; params?: unknown[] }[]
): Promise<RowSnapshot[]> {
  const db = await getDb();
  const out: RowSnapshot[] = [];
  for (const p of parts) {
    validateFields([p.table]);
    const rows = await db.select<Record<string, unknown>[]>(`SELECT * FROM ${p.table} WHERE ${p.where}`, p.params ?? []);
    out.push({ table: p.table, rows: rows ?? [] });
  }
  return out;
}

/** Re-insert the rows in one transaction (parents first: the order they were snapshotted in). */
export async function restoreRows(
  snapshot: RowSnapshot[],
  extra: { sql: string; params: unknown[] }[] = []
): Promise<void> {
  const batch = new TransactionBatch();
  for (const { table, rows } of snapshot) {
    for (const row of rows) {
      const cols = Object.keys(row);
      validateFields([table, ...cols]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      batch.add(`INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`, cols.map((c) => row[c]));
    }
  }
  for (const e of extra) batch.add(e.sql, e.params);
  await batch.commit();
}

/** Push the undo entry that restores `snapshot`; `redo` deletes again. Returns false when there was nothing to restore. */
export function pushRestore(
  label: string,
  snapshot: RowSnapshot[],
  opts: {
    redo: () => Promise<unknown>;
    invalidate: () => void;
    /** Statements run after the inserts, in the same transaction (e.g. add tracked minutes back). */
    extra?: { sql: string; params: unknown[] }[];
  }
): boolean {
  if (snapshot.every((s) => s.rows.length === 0)) return false;
  useUndoStore.getState().push({
    label,
    execute: async () => {
      await restoreRows(snapshot, opts.extra);
      opts.invalidate();
    },
    redo: async () => {
      await opts.redo();
      opts.invalidate();
    },
  });
  return true;
}
