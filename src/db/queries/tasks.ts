import { getDb, validateFields, TransactionBatch } from "../index";
import type { Task, Subtask } from "../../types/task";

export async function getProjectName(projectId: number): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ name: string }[]>("SELECT name FROM projects WHERE id = $1", [projectId]);
  return rows[0]?.name ?? "";
}

export async function getTasksByProject(projectId: number): Promise<Task[]> {
  const db = await getDb();
  return db.select<Task[]>(
    "SELECT * FROM tasks WHERE project_id = $1 ORDER BY sort_order, created_at",
    [projectId]
  );
}

export async function getAllTasks(): Promise<Task[]> {
  const db = await getDb();
  return db.select<Task[]>("SELECT * FROM tasks ORDER BY due_date, sort_order");
}

export async function getTasksWithDueDate(): Promise<Task[]> {
  const db = await getDb();
  return db.select<Task[]>(
    "SELECT * FROM tasks WHERE due_date IS NOT NULL ORDER BY due_date"
  );
}

export async function createTask(
  data: Omit<Task, "id" | "created_at" | "updated_at" | "calendar_event_id" | "planned_minutes" | "tracked_minutes" | "workload_cells" | "workload_sort_order">
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO tasks (project_id, title, description, status, priority, due_date, end_date, start_time, end_time, reminder, scheduled_start, scheduled_end, notes, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      data.project_id,
      data.title,
      data.description,
      data.status,
      data.priority,
      data.due_date,
      data.end_date,
      data.start_time,
      data.end_time,
      data.reminder,
      data.scheduled_start,
      data.scheduled_end,
      data.notes,
      data.sort_order,
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function updateTask(
  id: number,
  data: Partial<Omit<Task, "id" | "created_at" | "updated_at">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];
  await db.execute(
    `UPDATE tasks SET ${sets}, updated_at = datetime('now') WHERE id = $1`,
    values
  );
}

export async function deleteTask(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM tasks WHERE id = $1", [id]);
}

export async function getTaskById(id: number): Promise<Task | null> {
  const db = await getDb();
  const rows = await db.select<Task[]>("SELECT * FROM tasks WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function getSubtaskById(id: number): Promise<Subtask | null> {
  const db = await getDb();
  const rows = await db.select<Subtask[]>("SELECT * FROM subtasks WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function getAllSubtasks(): Promise<Subtask[]> {
  const db = await getDb();
  return db.select<Subtask[]>("SELECT * FROM subtasks ORDER BY task_id, sort_order");
}

export async function getSubtasksWithDueDate(): Promise<(Subtask & { project_id: number })[]> {
  const db = await getDb();
  return db.select<(Subtask & { project_id: number })[]>(
    `SELECT s.*, t.project_id FROM subtasks s
     JOIN tasks t ON s.task_id = t.id
     WHERE s.due_date IS NOT NULL
     ORDER BY s.due_date`
  );
}

export async function getSubtasksByTask(taskId: number): Promise<Subtask[]> {
  const db = await getDb();
  return db.select<Subtask[]>(
    "SELECT * FROM subtasks WHERE task_id = $1 ORDER BY sort_order, created_at",
    [taskId]
  );
}

export async function getSubtasksByProject(projectId: number): Promise<Subtask[]> {
  const db = await getDb();
  return db.select<Subtask[]>(
    `SELECT s.* FROM subtasks s
     JOIN tasks t ON s.task_id = t.id
     WHERE t.project_id = $1
     ORDER BY s.task_id, s.sort_order`,
    [projectId]
  );
}

export async function createSubtask(
  data: Omit<Subtask, "id" | "created_at" | "updated_at" | "calendar_event_id">
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO subtasks (task_id, title, status, due_date, end_date, start_time, end_time, reminder, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [data.task_id, data.title, data.status, data.due_date, data.end_date, data.start_time, data.end_time, data.reminder, data.sort_order]
  );
  return result.lastInsertId ?? 0;
}

export async function updateSubtask(
  id: number,
  data: Partial<Omit<Subtask, "id" | "created_at" | "updated_at">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];
  await db.execute(
    `UPDATE subtasks SET ${sets}, updated_at = datetime('now') WHERE id = $1`,
    values
  );
}

export async function reorderSubtasks(ids: number[]): Promise<void> {
  const batch = new TransactionBatch();
  for (let i = 0; i < ids.length; i++) {
    batch.add("UPDATE subtasks SET sort_order = $1 WHERE id = $2", [i, ids[i]]);
  }
  await batch.commit();
}

export async function deleteSubtask(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM subtasks WHERE id = $1", [id]);
}

// ── Time aggregation queries for dashboard widgets ──

export interface DayTimeEntry {
  day: string; // ISO date, e.g. "2026-03-24"
  minutes: number;
}

/** Tracked minutes per day for the current week (Mon–Sun). */
export async function getTimeThisWeek(): Promise<DayTimeEntry[]> {
  const db = await getDb();
  // Get start of current ISO week (Monday)
  return db.select<DayTimeEntry[]>(
    `SELECT date(t.updated_at) AS day, SUM(t.tracked_minutes) AS minutes
     FROM tasks t
     WHERE t.tracked_minutes > 0
       AND date(t.updated_at) >= date('now', 'weekday 0', '-6 days')
     GROUP BY day
     ORDER BY day`
  );
}

export interface ProjectTimeComparison {
  project_id: number;
  project_name: string;
  planned: number;
  tracked: number;
}

/** Per-project planned vs tracked minutes for active projects. */
export async function getPlannedVsActual(): Promise<ProjectTimeComparison[]> {
  const db = await getDb();
  return db.select<ProjectTimeComparison[]>(
    `SELECT p.id AS project_id, p.name AS project_name,
            COALESCE(SUM(t.planned_minutes), 0) AS planned,
            SUM(t.tracked_minutes) AS tracked
     FROM projects p
     JOIN tasks t ON t.project_id = p.id
     WHERE p.status = 'active' AND t.tracked_minutes > 0
     GROUP BY p.id
     ORDER BY tracked DESC
     LIMIT 10`
  );
}

export interface TopTimeTask {
  id: number;
  title: string;
  project_name: string;
  tracked_minutes: number;
}

/** Tasks with the most tracked time. */
export async function getTopTimeConsumers(limit = 10): Promise<TopTimeTask[]> {
  const db = await getDb();
  return db.select<TopTimeTask[]>(
    `SELECT t.id, t.title, p.name AS project_name, t.tracked_minutes
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE t.tracked_minutes > 0
     ORDER BY t.tracked_minutes DESC
     LIMIT $1`,
    [limit]
  );
}

export interface WeeklyTimeEntry {
  week: string; // e.g. "W12"
  week_start: string; // ISO date
  minutes: number;
}

/** Total tracked hours per week over the last 8 weeks. */
export async function getWeeklyTrend(): Promise<WeeklyTimeEntry[]> {
  const db = await getDb();
  return db.select<WeeklyTimeEntry[]>(
    `SELECT 'W' || strftime('%W', t.updated_at) AS week,
            date(t.updated_at, 'weekday 0', '-6 days') AS week_start,
            SUM(t.tracked_minutes) AS minutes
     FROM tasks t
     WHERE t.tracked_minutes > 0
       AND date(t.updated_at) >= date('now', '-56 days')
     GROUP BY week
     ORDER BY week_start`
  );
}

export interface ProjectTimeShare {
  project_name: string;
  minutes: number;
}

/** Distribution of tracked time across active projects. */
export async function getProjectTimeDistribution(): Promise<ProjectTimeShare[]> {
  const db = await getDb();
  return db.select<ProjectTimeShare[]>(
    `SELECT p.name AS project_name, SUM(t.tracked_minutes) AS minutes
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE p.status = 'active' AND t.tracked_minutes > 0
     GROUP BY p.id
     ORDER BY minutes DESC
     LIMIT 8`
  );
}
