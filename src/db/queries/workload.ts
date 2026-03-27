import { getDb, TransactionBatch } from "../index";
import { logError } from "../../lib/log";
import type {
  WorkloadTemplate,
  WorkloadTemplateRow,
  WorkloadRow,
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
  return { ...row, is_system: row.is_system === 1, columns };
}

export async function getWorkloadTemplates(): Promise<WorkloadTemplate[]> {
  const db = await getDb();
  const rows = await db.select<WorkloadTemplateRow[]>(
    "SELECT * FROM workload_templates ORDER BY is_system DESC, name"
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
  // Prevent deleting system templates
  const rows = await db.select<{ is_system: number }[]>(
    "SELECT is_system FROM workload_templates WHERE id = $1",
    [id]
  );
  if (rows[0]?.is_system === 1) {
    throw new Error("Cannot delete system template");
  }
  await db.execute("DELETE FROM workload_templates WHERE id = $1", [id]);
}

// ── Workload Rows (backed by tasks) ──────────────────────

interface TaskWorkloadDB {
  id: number;
  project_id: number;
  title: string;
  status: string;
  tracked_minutes: number;
  planned_minutes: number | null;
  workload_cells: string;
  workload_sort_order: number;
  created_at: string;
  updated_at: string;
}

function parseWorkloadRow(row: TaskWorkloadDB): WorkloadRow {
  let cells: Record<string, unknown> = {};
  try {
    cells = JSON.parse(row.workload_cells) as Record<string, unknown>;
  } catch {
    logError(`Failed to parse workload_cells for task ${row.id}`);
  }
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    status: row.status,
    tracked_minutes: row.tracked_minutes ?? 0,
    planned_minutes: row.planned_minutes,
    cells,
    sort_order: row.workload_sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getWorkloadRows(
  projectId: number
): Promise<WorkloadRow[]> {
  const db = await getDb();
  const rows = await db.select<TaskWorkloadDB[]>(
    `SELECT id, project_id, title, status, tracked_minutes, planned_minutes,
            workload_cells, workload_sort_order, created_at, updated_at
     FROM tasks WHERE project_id = $1
     ORDER BY workload_sort_order, created_at`,
    [projectId]
  );
  return rows.map(parseWorkloadRow);
}

/** Create a workload row = create a task */
export async function createWorkloadRow(data: {
  project_id: number;
  title?: string;
  cells: Record<string, unknown>;
  sort_order: number;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO tasks (project_id, title, description, status, priority, sort_order, workload_cells, workload_sort_order)
     VALUES ($1, $2, '', 'todo', 'low', 0, $3, $4)`,
    [
      data.project_id,
      data.title ?? "",
      JSON.stringify(data.cells),
      data.sort_order,
    ]
  );
  return result.lastInsertId ?? 0;
}

/** Update workload-specific fields on a task */
export async function updateWorkloadRow(
  id: number,
  data: {
    title?: string;
    cells?: Record<string, unknown>;
    sort_order?: number;
    tracked_minutes?: number;
    planned_minutes?: number | null;
  }
): Promise<void> {
  const db = await getDb();
  if (data.cells !== undefined) {
    await db.execute(
      "UPDATE tasks SET workload_cells = $1, updated_at = datetime('now') WHERE id = $2",
      [JSON.stringify(data.cells), id]
    );
  }
  if (data.title !== undefined) {
    await db.execute(
      "UPDATE tasks SET title = $1, updated_at = datetime('now') WHERE id = $2",
      [data.title, id]
    );
  }
  if (data.sort_order !== undefined) {
    await db.execute(
      "UPDATE tasks SET workload_sort_order = $1, updated_at = datetime('now') WHERE id = $2",
      [data.sort_order, id]
    );
  }
  if (data.tracked_minutes !== undefined) {
    await db.execute(
      "UPDATE tasks SET tracked_minutes = $1, updated_at = datetime('now') WHERE id = $2",
      [data.tracked_minutes, id]
    );
  }
  if (data.planned_minutes !== undefined) {
    await db.execute(
      "UPDATE tasks SET planned_minutes = $1, updated_at = datetime('now') WHERE id = $2",
      [data.planned_minutes, id]
    );
  }
}

export async function reorderWorkloadRows(
  orderedIds: number[]
): Promise<void> {
  const batch = new TransactionBatch();
  for (let i = 0; i < orderedIds.length; i++) {
    batch.add("UPDATE tasks SET workload_sort_order = $1 WHERE id = $2", [i, orderedIds[i]]);
  }
  await batch.commit();
}

export async function getWorkloadRow(id: number): Promise<WorkloadRow | null> {
  const db = await getDb();
  const rows = await db.select<TaskWorkloadDB[]>(
    `SELECT id, project_id, title, status, tracked_minutes, planned_minutes,
            workload_cells, workload_sort_order, created_at, updated_at
     FROM tasks WHERE id = $1`,
    [id]
  );
  return rows[0] ? parseWorkloadRow(rows[0]) : null;
}

export async function deleteWorkloadRow(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM tasks WHERE id = $1", [id]);
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

/** Get all project workload column configs (for calendar colors) */
export async function getAllProjectWorkloadConfigs(): Promise<
  Map<number, WorkloadColumn[]>
> {
  const db = await getDb();
  const rows = await db.select<
    { id: number; workload_columns: string | null }[]
  >("SELECT id, workload_columns FROM projects WHERE workload_columns IS NOT NULL");
  const map = new Map<number, WorkloadColumn[]>();
  for (const row of rows) {
    if (!row.workload_columns) continue;
    try {
      const cols = JSON.parse(row.workload_columns) as WorkloadColumn[];
      map.set(row.id, cols);
    } catch {
      logError(`Failed to parse workload_columns for project ${row.id}`);
    }
  }
  return map;
}

/** Get aggregated time data across all projects (for Time Overview) */
export async function getTimeOverviewData(): Promise<
  { project_id: number; project_name: string; task_id: number; task_title: string; tracked_minutes: number; planned_minutes: number | null; date: string }[]
> {
  const db = await getDb();
  return db.select(
    `SELECT t.id as task_id, t.title as task_title, t.project_id,
            p.name as project_name, t.tracked_minutes,
            t.planned_minutes, t.updated_at as date
     FROM tasks t
     JOIN projects p ON t.project_id = p.id
     WHERE t.tracked_minutes > 0
     ORDER BY t.updated_at DESC`
  );
}
