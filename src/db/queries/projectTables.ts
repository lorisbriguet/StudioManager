import { getDb } from "../index";
import type { ProjectTable, ProjectTableRow, TableColumnDef } from "../../types/project-table";

type RawTable = Omit<ProjectTable, "column_config"> & { column_config: string };
type RawRow = Omit<ProjectTableRow, "data"> & { data: string };

export async function getProjectTables(projectId: number): Promise<ProjectTable[]> {
  const db = await getDb();
  const rows = await db.select<RawTable[]>(
    "SELECT * FROM project_tables WHERE project_id = $1 ORDER BY sort_order ASC",
    [projectId]
  );
  return rows.map((r) => ({ ...r, column_config: JSON.parse(r.column_config) }));
}

export async function createProjectTable(projectId: number, name: string, columns?: TableColumnDef[]): Promise<number> {
  const db = await getDb();
  const maxOrder = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM project_tables WHERE project_id = $1",
    [projectId]
  );
  const nextOrder = (maxOrder[0]?.m ?? -1) + 1;
  const defaultCols: TableColumnDef[] = columns ?? [
    { id: "col_1", name: "Name", type: "text", width: 200 },
    { id: "col_2", name: "Status", type: "select", width: 120, options: ["Todo", "In Progress", "Done"] },
    { id: "col_3", name: "Notes", type: "text", width: 200 },
  ];
  const result = await db.execute(
    "INSERT INTO project_tables (project_id, name, column_config, sort_order) VALUES ($1, $2, $3, $4)",
    [projectId, name, JSON.stringify(defaultCols), nextOrder]
  );
  return result.lastInsertId ?? 0;
}

export async function updateProjectTable(id: number, data: { name?: string; column_config?: TableColumnDef[] }): Promise<void> {
  const db = await getDb();
  if (data.name !== undefined) {
    await db.execute("UPDATE project_tables SET name = $1 WHERE id = $2", [data.name, id]);
  }
  if (data.column_config !== undefined) {
    await db.execute("UPDATE project_tables SET column_config = $1 WHERE id = $2", [JSON.stringify(data.column_config), id]);
  }
}

export async function deleteProjectTable(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM project_table_rows WHERE table_id = $1", [id]);
  await db.execute("DELETE FROM project_tables WHERE id = $1", [id]);
}

// ── Rows ──────────────────────────────────────────

export async function getProjectTableRows(tableId: number): Promise<ProjectTableRow[]> {
  const db = await getDb();
  const rows = await db.select<RawRow[]>(
    "SELECT * FROM project_table_rows WHERE table_id = $1 ORDER BY sort_order ASC",
    [tableId]
  );
  return rows.map((r) => ({ ...r, data: JSON.parse(r.data) }));
}

export async function createProjectTableRow(tableId: number, data?: Record<string, unknown>): Promise<number> {
  const db = await getDb();
  const maxOrder = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM project_table_rows WHERE table_id = $1",
    [tableId]
  );
  const nextOrder = (maxOrder[0]?.m ?? -1) + 1;
  const result = await db.execute(
    "INSERT INTO project_table_rows (table_id, data, sort_order) VALUES ($1, $2, $3)",
    [tableId, JSON.stringify(data ?? {}), nextOrder]
  );
  return result.lastInsertId ?? 0;
}

export async function updateProjectTableRow(id: number, data: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE project_table_rows SET data = $1 WHERE id = $2", [JSON.stringify(data), id]);
}

export async function deleteProjectTableRow(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM project_table_rows WHERE id = $1", [id]);
}
