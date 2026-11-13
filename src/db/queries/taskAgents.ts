import { getDb, TransactionBatch } from "../index";
import type { TaskAgent } from "../../types/taskAgent";

export type ItemKind = "task" | "subtask";

const table = (kind: ItemKind) => (kind === "task" ? "tasks" : "subtasks");
const linkColumn = (kind: ItemKind) => (kind === "task" ? "task_id" : "subtask_id");

/**
 * Record a started agent and set the item to Running (an item already done
 * keeps its stage). One batch; an UPDATE does not change the insert's id.
 */
export async function linkAgent(data: {
  kind: ItemKind;
  id: number;
  shortId: string;
  name: string;
  model: string | null;
}): Promise<number> {
  const batch = new TransactionBatch();
  batch.add(
    `INSERT INTO task_agents (${linkColumn(data.kind)}, short_id, name, model) VALUES ($1, $2, $3, $4)`,
    [data.id, data.shortId, data.name, data.model],
  );
  batch.add(
    `UPDATE ${table(data.kind)} SET stage = 'running', updated_at = datetime('now') WHERE id = $1 AND status <> 'done'`,
    [data.id],
  );
  const { lastInsertId } = await batch.commit();
  return lastInsertId;
}

/** An item's links, newest first. */
export async function getItemAgents(kind: ItemKind, id: number): Promise<TaskAgent[]> {
  const db = await getDb();
  return db.select<TaskAgent[]>(
    `SELECT * FROM task_agents WHERE ${linkColumn(kind)} = $1 ORDER BY started_at DESC, id DESC`,
    [id],
  );
}

export interface OpenLink {
  kind: ItemKind;
  item_id: number;
  short_id: string;
  session_id: string | null;
  /** 'watcher' for a worker the watcher started; null for one started by hand. */
  started_by?: string | null;
}

/** Links not yet closed, for the "waiting on you" chip. */
export async function getOpenLinks(): Promise<OpenLink[]> {
  const db = await getDb();
  return db.select<OpenLink[]>(
    `SELECT CASE WHEN subtask_id IS NOT NULL THEN 'subtask' ELSE 'task' END AS kind,
            COALESCE(subtask_id, task_id) AS item_id, short_id, session_id, started_by
     FROM task_agents WHERE ended_at IS NULL ORDER BY id`,
  );
}

/** A capture was filed as this item (the Idea step). */
export async function wasCaptured(kind: ItemKind, id: number): Promise<boolean> {
  const db = await getDb();
  const col = kind === "task" ? "task_id = $1 AND subtask_id IS NULL" : "subtask_id = $1";
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM captures WHERE status = 'filed' AND ${col}`,
    [id],
  );
  return (rows[0]?.n ?? 0) > 0;
}

/** The item's current stage, read fresh. */
export async function getStage(kind: ItemKind, id: number): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ stage: string | null }[]>(`SELECT stage FROM ${table(kind)} WHERE id = $1`, [id]);
  return rows[0]?.stage ?? null;
}

/**
 * Set the stage by hand: none, Briefed or Ready. Running and To check are the app's: refused
 * while the item is in either, except clearing To check. Guarded in SQL too, so a stage the
 * app wrote after the read is never overwritten.
 */
export async function setStage(kind: ItemKind, id: number, stage: null | "briefed" | "ready"): Promise<void> {
  const current = await getStage(kind, id);
  if (current === "running" || (current === "to_check" && stage !== null)) throw new Error("The app sets this stage");
  const guard = stage === null ? "(stage IS NULL OR stage <> 'running')" : "(stage IS NULL OR stage NOT IN ('running', 'to_check'))";
  const db = await getDb();
  await db.execute(`UPDATE ${table(kind)} SET stage = $2, updated_at = datetime('now') WHERE id = $1 AND ${guard}`, [id, stage]);
}
