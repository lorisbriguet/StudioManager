import { getDb } from "../index";
import type { SavedFilter } from "../../types/saved-filter";

export async function getSavedFilters(page: string): Promise<SavedFilter[]> {
  const db = await getDb();
  const rows = await db.select<(Omit<SavedFilter, "filters"> & { filters: string })[]>(
    "SELECT * FROM saved_filters WHERE page = $1 ORDER BY sort_order ASC, created_at ASC",
    [page]
  );
  return rows.map((r) => ({ ...r, filters: JSON.parse(r.filters) }));
}

export async function createSavedFilter(
  page: string,
  name: string,
  filters: Record<string, unknown>
): Promise<number> {
  const db = await getDb();
  const maxOrder = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM saved_filters WHERE page = $1",
    [page]
  );
  const nextOrder = (maxOrder[0]?.m ?? -1) + 1;
  const result = await db.execute(
    "INSERT INTO saved_filters (page, name, filters, sort_order) VALUES ($1, $2, $3, $4)",
    [page, name, JSON.stringify(filters), nextOrder]
  );
  return result.lastInsertId ?? 0;
}

export async function renameSavedFilter(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE saved_filters SET name = $1 WHERE id = $2", [name, id]);
}

export async function updateSavedFilterData(
  id: number,
  filters: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE saved_filters SET filters = $1 WHERE id = $2", [
    JSON.stringify(filters),
    id,
  ]);
}

export async function deleteSavedFilter(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM saved_filters WHERE id = $1", [id]);
}
