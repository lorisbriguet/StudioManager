import { getDb, validateFields } from "../index";
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

export async function deleteProject(id: number): Promise<void> {
  const db = await getDb();
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
     VALUES ($1, $2, '', 'active', date('now'), $3, $4)`,
    [data.clientId, data.name, data.deadline, data.notes]
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
