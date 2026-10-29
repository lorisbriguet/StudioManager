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
 * Rows that only point at the deleted one through `ON DELETE SET NULL` lose
 * that link and keep their own row; `snapshotLinks` records which ones did,
 * and its statements (pushRestore's `extra`) link them back:
 *
 *   const links = await snapshotLinks([{ table: "invoices", column: "template_id", id }]);
 *   pushRestore(label, snap, { redo, invalidate, extra: links });
 *
 * `table`, `where` and `column` are constants written in the hooks, never user input.
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

/**
 * The rows whose `column` points at `id` (to be cut by an `ON DELETE SET NULL`),
 * as the statements that point them at it again. Only that column is written:
 * the rows keep their other fields and their `updated_at`.
 */
export async function snapshotLinks(
  parts: { table: string; column: string; id: unknown }[]
): Promise<{ sql: string; params: unknown[] }[]> {
  const db = await getDb();
  const out: { sql: string; params: unknown[] }[] = [];
  for (const p of parts) {
    validateFields([p.table, p.column]);
    const rows = await db.select<{ id: unknown }[]>(`SELECT id FROM ${p.table} WHERE ${p.column} = $1`, [p.id]);
    if (!rows?.length) continue;
    out.push({
      sql: `UPDATE ${p.table} SET ${p.column} = $1 WHERE id IN (SELECT value FROM json_each($2))`,
      params: [p.id, JSON.stringify(rows.map((r) => r.id))],
    });
  }
  return out;
}

/**
 * Undo of a removal from a list kept inside a row (a table's columns): put the
 * item back into the list as it is NOW, at its old position (or the end), so
 * changes made since the removal stay. A no-op when it is already there.
 */
export function reinsertAt<T>(list: T[], item: T, index: number, same: (a: T) => boolean): T[] {
  if (list.some(same)) return list;
  const i = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, i), item, ...list.slice(i)];
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
