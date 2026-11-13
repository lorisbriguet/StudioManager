import { getDb, validateFields } from "../index";
import { todayLocalISO } from "../../utils/localDate";
import type { Project } from "../../types/project";

export async function getProjects(): Promise<Project[]> {
  const db = await getDb();
  return db.select<Project[]>("SELECT * FROM projects ORDER BY created_at DESC");
}

export async function getProjectsByClient(clientId: string): Promise<Project[]> {
  const db = await getDb();
  return db.select<Project[]>(
    "SELECT * FROM projects WHERE client_id = $1 ORDER BY created_at DESC",
    [clientId]
  );
}

export async function getProject(id: number): Promise<Project | null> {
  const db = await getDb();
  const rows = await db.select<Project[]>(
    "SELECT * FROM projects WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function createProject(
  data: Omit<Project, "id" | "created_at" | "updated_at">
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO projects (client_id, name, description, status, start_date, deadline, notes, folder_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.client_id,
      data.name,
      data.description,
      data.status,
      data.start_date,
      data.deadline,
      data.notes,
      data.folder_path ?? null,
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function updateProject(
  id: number,
  data: Partial<Omit<Project, "id" | "created_at" | "updated_at">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];
  await db.execute(
    `UPDATE projects SET ${sets}, updated_at = datetime('now') WHERE id = $1`,
    values
  );
}

/**
 * A project's agent settings. `merge_alone` is refused while the project belongs to a hub, and
 * making it a hub's project turns `merge_alone` off, in the same statement. The check command
 * is trimmed, at most 500 characters; empty clears it.
 */
export async function setProjectAgentSettings(
  id: number,
  settings: { check_command?: string | null; merge_alone?: number; hub_project?: number },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (settings.check_command !== undefined) {
    const command = (settings.check_command ?? "").trim();
    if (command.length > 500) throw new Error("The check command is at most 500 characters.");
    params.push(command === "" ? null : command);
    sets.push(`check_command = $${params.length}`);
  }
  const hub = settings.hub_project === undefined ? null : settings.hub_project ? 1 : 0;
  const merge = settings.merge_alone === undefined ? null : settings.merge_alone ? 1 : 0;
  const db = await getDb();
  if (merge === 1) {
    const rows = await db.select<{ hub_project: number }[]>("SELECT hub_project FROM projects WHERE id = $1", [id]);
    if ((hub ?? rows[0]?.hub_project ?? 0) === 1) throw new Error("A hub's project is never merged by the lead alone.");
  }
  if (hub !== null) {
    params.push(hub);
    sets.push(`hub_project = $${params.length}`);
  }
  if (hub === 1) {
    sets.push("merge_alone = 0");
  } else if (merge !== null) {
    params.push(merge);
    // The guard in SQL: a hub flag set after the read above still wins.
    sets.push(`merge_alone = CASE WHEN ${hub === 0 ? "0" : "hub_project"} = 1 THEN 0 ELSE $${params.length} END`);
  }
  if (sets.length === 0) return;
  await db.execute(`UPDATE projects SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = $1`, params);
}

export async function deleteProject(id: number): Promise<void> {
  const db = await getDb();
  // Unlink invoices and quotes (financial records survive project deletion)
  await db.execute("UPDATE invoices SET project_id = NULL WHERE project_id = $1", [id]);
  await db.execute("UPDATE quotes SET project_id = NULL WHERE project_id = $1", [id]);
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
}

/** Create a project from a quote: project + tasks from line items + link back to quote */
export async function createProjectFromQuote(data: {
  clientId: string;
  name: string;
  deadline: string;
  notes: string;
  quoteId: number;
  tasks: { title: string; plannedMinutes: number | null; sortOrder: number }[];
}): Promise<number> {
  const db = await getDb();

  // 1. Create project
  const result = await db.execute(
    `INSERT INTO projects (client_id, name, description, status, start_date, deadline, notes)
     VALUES ($1, $2, '', 'active', $3, $4, $5)`,
    [data.clientId, data.name, todayLocalISO(), data.deadline, data.notes]
  );
  const projectId = result.lastInsertId ?? 0;

  // 2. Create tasks (workload rows)
  for (const task of data.tasks) {
    const taskResult = await db.execute(
      `INSERT INTO tasks (project_id, title, description, status, priority, sort_order, workload_cells, workload_sort_order, planned_minutes)
       VALUES ($1, $2, '', 'todo', 'low', $3, '{}', $3, $4)`,
      [projectId, task.title, task.sortOrder, task.plannedMinutes]
    );
    void taskResult;
  }

  // 3. Link quote to project
  await db.execute(
    "UPDATE quotes SET converted_to_project_id = $1, updated_at = datetime('now') WHERE id = $2",
    [projectId, data.quoteId]
  );

  return projectId;
}
