import { getDb, withTransaction } from "../index";
import { logError } from "../../lib/log";
import type {
  WorkloadTemplate,
  WorkloadTemplateRow,
  WorkloadRow,
  WorkloadRowDB,
  WorkloadColumn,
} from "../../types/workload";

// ── Templates ──────────────────────────────────────────────

function parseTemplate(row: WorkloadTemplateRow): WorkloadTemplate {
  let columns: WorkloadColumn[] = [];
  try {
    columns = JSON.parse(row.columns) as WorkloadColumn[];
  } catch {
    logError(`Failed to parse columns for template ${row.id}`);
  }
  return { ...row, columns };
}

export async function getWorkloadTemplates(): Promise<WorkloadTemplate[]> {
  const db = await getDb();
  const rows = await db.select<WorkloadTemplateRow[]>(
    "SELECT * FROM workload_templates ORDER BY name"
  );
  return rows.map(parseTemplate);
}

export async function getWorkloadTemplate(
  id: number
): Promise<WorkloadTemplate | null> {
  const db = await getDb();
  const rows = await db.select<WorkloadTemplateRow[]>(
    "SELECT * FROM workload_templates WHERE id = $1",
    [id]
  );
  return rows[0] ? parseTemplate(rows[0]) : null;
}

export async function createWorkloadTemplate(
  name: string,
  columns: WorkloadColumn[]
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO workload_templates (name, columns) VALUES ($1, $2)",
    [name, JSON.stringify(columns)]
  );
  return result.lastInsertId ?? 0;
}

export async function updateWorkloadTemplate(
  id: number,
  data: { name?: string; columns?: WorkloadColumn[] }
): Promise<void> {
  const db = await getDb();
  if (data.name !== undefined) {
    await db.execute(
      "UPDATE workload_templates SET name = $1, updated_at = datetime('now') WHERE id = $2",
      [data.name, id]
    );
  }
  if (data.columns !== undefined) {
    await db.execute(
      "UPDATE workload_templates SET columns = $1, updated_at = datetime('now') WHERE id = $2",
      [JSON.stringify(data.columns), id]
    );
  }
}

export async function deleteWorkloadTemplate(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM workload_templates WHERE id = $1", [id]);
}

// ── Rows ───────────────────────────────────────────────────

function parseRow(row: WorkloadRowDB): WorkloadRow {
  let cells: Record<string, unknown> = {};
  try {
    cells = JSON.parse(row.cells) as Record<string, unknown>;
  } catch {
    logError(`Failed to parse cells for workload row ${row.id}`);
  }
  return { ...row, cells };
}

export async function getWorkloadRows(
  projectId: number
): Promise<WorkloadRow[]> {
  const db = await getDb();
  const rows = await db.select<WorkloadRowDB[]>(
    "SELECT * FROM workload_rows WHERE project_id = $1 ORDER BY sort_order, created_at",
    [projectId]
  );
  return rows.map(parseRow);
}

export async function createWorkloadRow(data: {
  project_id: number;
  template_id: number | null;
  task_id: number | null;
  cells: Record<string, unknown>;
  sort_order: number;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO workload_rows (project_id, template_id, task_id, cells, sort_order)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      data.project_id,
      data.template_id,
      data.task_id,
      JSON.stringify(data.cells),
      data.sort_order,
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function updateWorkloadRow(
  id: number,
  data: {
    task_id?: number | null;
    cells?: Record<string, unknown>;
    sort_order?: number;
  }
): Promise<void> {
  const db = await getDb();
  if (data.cells !== undefined) {
    await db.execute(
      "UPDATE workload_rows SET cells = $1, updated_at = datetime('now') WHERE id = $2",
      [JSON.stringify(data.cells), id]
    );
  }
  if (data.task_id !== undefined) {
    await db.execute(
      "UPDATE workload_rows SET task_id = $1, updated_at = datetime('now') WHERE id = $2",
      [data.task_id, id]
    );
  }
  if (data.sort_order !== undefined) {
    await db.execute(
      "UPDATE workload_rows SET sort_order = $1, updated_at = datetime('now') WHERE id = $2",
      [data.sort_order, id]
    );
  }
}

export async function reorderWorkloadRows(
  orderedIds: number[]
): Promise<void> {
  await withTransaction(async (db) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.execute(
        "UPDATE workload_rows SET sort_order = $1 WHERE id = $2",
        [i, orderedIds[i]]
      );
    }
  });
}

export async function getWorkloadRow(id: number): Promise<WorkloadRow | null> {
  const db = await getDb();
  const rows = await db.select<WorkloadRowDB[]>(
    "SELECT * FROM workload_rows WHERE id = $1",
    [id]
  );
  return rows[0] ? parseRow(rows[0]) : null;
}

export async function deleteWorkloadRow(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM workload_rows WHERE id = $1", [id]);
}

// ── Project workload config ────────────────────────────────

export async function getProjectWorkloadConfig(
  projectId: number
): Promise<{ template_id: number | null; columns: WorkloadColumn[] | null }> {
  const db = await getDb();
  const rows = await db.select<
    { workload_template_id: number | null; workload_columns: string | null }[]
  >(
    "SELECT workload_template_id, workload_columns FROM projects WHERE id = $1",
    [projectId]
  );
  const row = rows[0];
  if (!row) return { template_id: null, columns: null };
  return {
    template_id: row.workload_template_id,
    columns: row.workload_columns
      ? (() => {
          try {
            return JSON.parse(row.workload_columns) as WorkloadColumn[];
          } catch {
            logError(`Failed to parse workload_columns for project ${projectId}`);
            return null;
          }
        })()
      : null,
  };
}

export async function setProjectWorkloadConfig(
  projectId: number,
  templateId: number | null,
  columns: WorkloadColumn[]
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE projects SET workload_template_id = $1, workload_columns = $2 WHERE id = $3",
    [templateId, JSON.stringify(columns), projectId]
  );
}
