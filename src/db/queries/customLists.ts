import { getDb } from "../index";

export interface CustomList {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CustomListItem {
  id: number;
  list_id: number;
  value: string;
  color: string | null;
  sort_order: number;
}

export async function getCustomLists(): Promise<CustomList[]> {
  const db = await getDb();
  return db.select<CustomList[]>(
    "SELECT id, name, created_at, updated_at FROM custom_lists ORDER BY name ASC"
  );
}

export async function getCustomListItems(listId: number): Promise<CustomListItem[]> {
  const db = await getDb();
  return db.select<CustomListItem[]>(
    "SELECT id, list_id, value, color, sort_order FROM custom_list_items WHERE list_id = $1 ORDER BY sort_order ASC",
    [listId]
  );
}

export async function createCustomList(name: string): Promise<number> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO custom_lists (name) VALUES ($1)",
    [name]
  );
  const rows = await db.select<{ id: number }[]>(
    "SELECT last_insert_rowid() as id"
  );
  return rows[0]?.id ?? 0;
}

export async function updateCustomList(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE custom_lists SET name = $1, updated_at = datetime('now') WHERE id = $2",
    [name, id]
  );
}

export async function deleteCustomList(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM custom_lists WHERE id = $1", [id]);
}

export async function setCustomListItems(
  listId: number,
  items: { value: string; color?: string }[]
): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM custom_list_items WHERE list_id = $1", [listId]);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await db.execute(
      "INSERT INTO custom_list_items (list_id, value, color, sort_order) VALUES ($1, $2, $3, $4)",
      [listId, item.value, item.color ?? null, i]
    );
  }
  await db.execute(
    "UPDATE custom_lists SET updated_at = datetime('now') WHERE id = $1",
    [listId]
  );
}

export async function isListInUse(_listId: number): Promise<boolean> {
  // Can be enhanced later to check project_tables column_config and workload columns
  return false;
}
