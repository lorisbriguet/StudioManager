import { copyFile, mkdir, exists, remove } from "@tauri-apps/plugin-fs";
import { getDb, validateFields, TransactionBatch } from "../index";
import { orgPaths } from "../../lib/orgPaths";
import { sanitizeSegment } from "../../lib/attachReceipt";
import { buildUpkeepItemInsert } from "./upkeepItems";
import type {
  Machine,
  MachineFile,
  MachineInput,
  MachineTemplateItemInput,
  ServiceLogEntry,
} from "../../types/upkeep";

const MACHINE_COLUMNS = [
  "name", "kind", "maker", "model", "serial", "location", "status", "lent_to", "lent_until",
  "purchase_date", "supplier", "price", "currency", "expense_id", "warranty_until",
  "lifespan_years", "photo_path", "notes", "template_key", "connection_id", "device_id",
  "reading_baseline",
] as const;

export async function getMachines(): Promise<Machine[]> {
  const db = await getDb();
  return db.select<Machine[]>("SELECT * FROM machines ORDER BY name ASC");
}

export async function getMachine(id: number): Promise<Machine | null> {
  const db = await getDb();
  const rows = await db.select<Machine[]>("SELECT * FROM machines WHERE id = $1", [id]);
  return rows[0] ?? null;
}

/**
 * Insert a machine and its template items in one Rust-side transaction
 * (`execute_batch`); items reference the machine through `$LAST_INSERT_ID`.
 */
export async function createMachine(
  data: MachineInput,
  items: MachineTemplateItemInput[] = []
): Promise<number> {
  const cols = MACHINE_COLUMNS.filter((c) => data[c] !== undefined);
  const batch = new TransactionBatch();
  batch.add(
    `INSERT INTO machines (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => data[c])
  );
  for (const item of items) {
    const stmt = buildUpkeepItemInsert(item, "$LAST_INSERT_ID");
    batch.add(stmt.sql, stmt.params);
  }
  const { lastInsertId } = await batch.commit();
  return lastInsertId;
}

export async function updateMachine(id: number, data: Partial<MachineInput>): Promise<void> {
  const fields = Object.keys(data).filter(
    (k) => (MACHINE_COLUMNS as readonly string[]).includes(k) && data[k as keyof MachineInput] !== undefined
  );
  if (fields.length === 0) return;
  validateFields(fields);
  const db = await getDb();
  const sets = fields.map((f, i) => `${f} = $${i + 1}`);
  sets.push("updated_at = datetime('now')");
  await db.execute(
    `UPDATE machines SET ${sets.join(", ")} WHERE id = $${fields.length + 1}`,
    [...fields.map((f) => data[f as keyof MachineInput]), id]
  );
}

export async function deleteMachine(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM machines WHERE id = $1", [id]);
}

export async function getMachineProjectIds(machineId: number): Promise<number[]> {
  const db = await getDb();
  const rows = await db.select<{ project_id: number }[]>(
    "SELECT project_id FROM machine_projects WHERE machine_id = $1",
    [machineId]
  );
  return rows.map((r) => r.project_id);
}

/** Replace the set of projects a machine is used on (one transaction). */
export async function setMachineProjects(id: number, projectIds: number[]): Promise<void> {
  const batch = new TransactionBatch();
  batch.add("DELETE FROM machine_projects WHERE machine_id = $1", [id]);
  for (const pid of new Set(projectIds)) {
    batch.add("INSERT INTO machine_projects (machine_id, project_id) VALUES ($1, $2)", [id, pid]);
  }
  await batch.commit();
}

export async function getMachinesByProject(projectId: number): Promise<Machine[]> {
  const db = await getDb();
  return db.select<Machine[]>(
    `SELECT m.* FROM machines m
     JOIN machine_projects mp ON mp.machine_id = m.id
     WHERE mp.project_id = $1
     ORDER BY m.name ASC`,
    [projectId]
  );
}

export async function getMachineFiles(machineId: number): Promise<MachineFile[]> {
  const db = await getDb();
  return db.select<MachineFile[]>(
    "SELECT * FROM machine_files WHERE machine_id = $1 ORDER BY id ASC",
    [machineId]
  );
}

/**
 * Attach a manual, invoice or link. A `file` is copied into the active
 * organisation's data folder (`machines/<id>/`), like receipts, and the copy's
 * path is stored; a `link` is stored as given.
 */
export async function addMachineFile(
  machineId: number,
  f: Pick<MachineFile, "label" | "kind" | "path_or_url">
): Promise<number> {
  let stored = f.path_or_url;
  if (f.kind === "file") {
    const { root } = await orgPaths();
    const dir = `${root}/machines/${machineId}`;
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    const base = sanitizeSegment(f.path_or_url.split("/").pop() ?? "file");
    stored = `${dir}/${Date.now()}_${base}`;
    await copyFile(f.path_or_url, stored);
  }
  const db = await getDb();
  const result = await db.execute(
    "INSERT INTO machine_files (machine_id, label, kind, path_or_url) VALUES ($1, $2, $3, $4)",
    [machineId, f.label, f.kind, stored]
  );
  return result.lastInsertId ?? 0;
}

export async function removeMachineFile(fileId: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<MachineFile[]>("SELECT * FROM machine_files WHERE id = $1", [fileId]);
  await db.execute("DELETE FROM machine_files WHERE id = $1", [fileId]);
  const row = rows[0];
  if (row?.kind === "file") {
    await remove(row.path_or_url).catch(() => {});
  }
}

export async function getServiceLog(machineId: number): Promise<ServiceLogEntry[]> {
  const db = await getDb();
  return db.select<ServiceLogEntry[]>(
    "SELECT * FROM service_log WHERE machine_id = $1 ORDER BY done_on DESC, id DESC",
    [machineId]
  );
}

export async function addServiceLog(
  entry: Omit<ServiceLogEntry, "id" | "created_at">
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO service_log (machine_id, upkeep_item_id, done_on, description, cost, expense_id, reading)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.machine_id, entry.upkeep_item_id, entry.done_on, entry.description,
      entry.cost, entry.expense_id, entry.reading,
    ]
  );
  return result.lastInsertId ?? 0;
}
