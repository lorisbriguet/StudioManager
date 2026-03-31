import { getDb } from "../index";

export interface TimeEntry {
  id: number;
  task_id: number | null;
  project_id: number;
  description: string;
  duration_minutes: number;
  date: string;
  hourly_rate: number | null;
  invoiced: number;
  created_at: string;
  updated_at: string;
}

/** All time entries, optionally filtered by project. */
export async function getTimeEntries(projectId?: number): Promise<TimeEntry[]> {
  const db = await getDb();
  if (projectId !== undefined) {
    return db.select<TimeEntry[]>(
      "SELECT * FROM time_entries WHERE project_id = $1 ORDER BY date DESC, created_at DESC",
      [projectId]
    );
  }
  return db.select<TimeEntry[]>(
    "SELECT * FROM time_entries ORDER BY date DESC, created_at DESC"
  );
}

/** Time entries for a specific task. */
export async function getTimeEntriesByTask(taskId: number): Promise<TimeEntry[]> {
  const db = await getDb();
  return db.select<TimeEntry[]>(
    "SELECT * FROM time_entries WHERE task_id = $1 ORDER BY date DESC, created_at DESC",
    [taskId]
  );
}

/** Time entries within a date range (inclusive). */
export async function getTimeEntriesByDateRange(
  start: string,
  end: string
): Promise<TimeEntry[]> {
  const db = await getDb();
  return db.select<TimeEntry[]>(
    "SELECT * FROM time_entries WHERE date >= $1 AND date <= $2 ORDER BY date DESC, created_at DESC",
    [start, end]
  );
}

/** Create a time entry and update task's tracked_minutes. */
export async function createTimeEntry(data: {
  task_id: number;
  project_id: number;
  duration_minutes: number;
  date: string;
  description?: string;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO time_entries (task_id, project_id, duration_minutes, date, description) VALUES ($1, $2, $3, $4, $5)",
    [data.task_id, data.project_id, data.duration_minutes, data.date, data.description ?? ""]
  );
  // Update task's tracked_minutes (add)
  await db.execute(
    "UPDATE tasks SET tracked_minutes = tracked_minutes + $1, updated_at = datetime('now') WHERE id = $2",
    [data.duration_minutes, data.task_id]
  );
  return result.lastInsertId ?? 0;
}

/** Delete a time entry and subtract from task's tracked_minutes. */
export async function deleteTimeEntry(id: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<TimeEntry[]>(
    "SELECT * FROM time_entries WHERE id = $1",
    [id]
  );
  const entry = rows[0];
  if (!entry) return;

  await db.execute("DELETE FROM time_entries WHERE id = $1", [id]);
  if (entry.task_id) {
    await db.execute(
      "UPDATE tasks SET tracked_minutes = MAX(0, tracked_minutes - $1), updated_at = datetime('now') WHERE id = $2",
      [entry.duration_minutes, entry.task_id]
    );
  }
}

// ── Dashboard aggregation queries (read from time_entries) ──

export interface DayTimeEntry {
  day: string;
  minutes: number;
}

/** Tracked minutes per day for the current week (Mon-Sun). */
export async function getTimeThisWeek(): Promise<DayTimeEntry[]> {
  const db = await getDb();
  return db.select<DayTimeEntry[]>(
    `SELECT date AS day, SUM(duration_minutes) AS minutes
     FROM time_entries
     WHERE date >= date('now', 'weekday 0', '-6 days')
     GROUP BY date
     ORDER BY date`
  );
}

export interface WeeklyTimeEntry {
  week: string;
  week_start: string;
  minutes: number;
}

/** Total tracked minutes per week over the last 8 weeks. */
export async function getWeeklyTrend(): Promise<WeeklyTimeEntry[]> {
  const db = await getDb();
  return db.select<WeeklyTimeEntry[]>(
    `SELECT 'W' || strftime('%W', date) AS week,
            date(date, 'weekday 0', '-6 days') AS week_start,
            SUM(duration_minutes) AS minutes
     FROM time_entries
     WHERE date >= date('now', '-56 days')
     GROUP BY week
     ORDER BY week_start`
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
    `SELECT te.task_id AS id, t.title, p.name AS project_name,
            SUM(te.duration_minutes) AS tracked_minutes
     FROM time_entries te
     JOIN tasks t ON t.id = te.task_id
     JOIN projects p ON p.id = te.project_id
     WHERE te.task_id IS NOT NULL
     GROUP BY te.task_id
     ORDER BY tracked_minutes DESC
     LIMIT $1`,
    [limit]
  );
}

export interface ProjectTimeShare {
  project_name: string;
  minutes: number;
}

/** Distribution of tracked time across projects. */
export async function getProjectTimeDistribution(): Promise<ProjectTimeShare[]> {
  const db = await getDb();
  return db.select<ProjectTimeShare[]>(
    `SELECT p.name AS project_name, SUM(te.duration_minutes) AS minutes
     FROM time_entries te
     JOIN projects p ON p.id = te.project_id
     GROUP BY te.project_id
     ORDER BY minutes DESC
     LIMIT 8`
  );
}

export interface BillableSummary {
  total_minutes: number;
  total_entries: number;
}

/** Total tracked hours summary. */
export async function getBillableSummary(): Promise<BillableSummary> {
  const db = await getDb();
  const rows = await db.select<{ total_minutes: number; total_entries: number }[]>(
    `SELECT COALESCE(SUM(duration_minutes), 0) AS total_minutes,
            COUNT(*) AS total_entries
     FROM time_entries`
  );
  return rows[0] ?? { total_minutes: 0, total_entries: 0 };
}
