import { getDb, TransactionBatch } from "../index";
import type { Capture, CaptureStatus } from "../../types/capture";

export type CaptureRow = Capture & {
  project_name: string | null;
  task_title: string | null;
  subtask_title: string | null;
};

/** A filed capture waiting for the user's word, with the item it was filed as. */
export interface BriefEntry {
  capture_id: number;
  capture_text: string;
  capture_created_at: string;
  kind: "task" | "subtask";
  /** The task's or the subtask's id. */
  item_id: number;
  title: string;
  brief: string | null;
  project_id: number;
  project_name: string;
}

export async function getCaptures(status: CaptureStatus): Promise<CaptureRow[]> {
  const db = await getDb();
  return db.select<CaptureRow[]>(
    `SELECT c.*, p.name AS project_name, t.title AS task_title, s.title AS subtask_title
     FROM captures c
     LEFT JOIN projects p ON p.id = c.project_id
     LEFT JOIN tasks t ON t.id = c.task_id
     LEFT JOIN subtasks s ON s.id = c.subtask_id
     WHERE c.status = $1
     ORDER BY c.created_at DESC, c.id DESC`,
    [status],
  );
}

/** Filed captures with outcome needs_word whose task or subtask still exists and is not done. */
export async function getBriefEntries(): Promise<BriefEntry[]> {
  const db = await getDb();
  return db.select<BriefEntry[]>(
    `SELECT c.id AS capture_id, c.text AS capture_text, c.created_at AS capture_created_at,
            CASE WHEN s.id IS NOT NULL THEN 'subtask' ELSE 'task' END AS kind,
            COALESCE(s.id, t.id) AS item_id,
            COALESCE(s.title, t.title) AS title,
            COALESCE(s.brief, t.brief) AS brief,
            p.id AS project_id, p.name AS project_name
     FROM captures c
     LEFT JOIN subtasks s ON s.id = c.subtask_id
     JOIN tasks t ON t.id = COALESCE(s.task_id, c.task_id)
     JOIN projects p ON p.id = t.project_id
     WHERE c.status = 'filed' AND c.outcome = 'needs_word'
       AND (c.subtask_id IS NULL OR s.id IS NOT NULL)
       AND COALESCE(s.status, t.status) <> 'done'
     ORDER BY c.created_at, c.id`,
  );
}

/** Only a new capture can be dismissed (an agent may have filed it meanwhile). */
export async function dismissCapture(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE captures SET status = 'dismissed', updated_at = datetime('now') WHERE id = $1 AND status = 'new'",
    [id],
  );
}

export async function restoreCapture(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE captures SET status = 'new', updated_at = datetime('now') WHERE id = $1 AND status = 'dismissed'",
    [id],
  );
}

/**
 * File a new capture as a task (notes = "Captured YYYY-MM-DD: <the words>") or, with `taskId`, as a
 * subtask of it. One batch: the first statement claims the capture and makes
 * the whole transaction fail (NOT NULL on `status`) if it is no longer new, or
 * if `taskId` is not an open task of the project, so a capture filed by an
 * agent in between, or a task finished meanwhile, writes nothing.
 */
export async function fileCaptureByHand(data: {
  captureId: number;
  projectId: number;
  taskId?: number | null;
  title: string;
}): Promise<{ kind: "task" | "subtask"; id: number }> {
  const db = await getDb();
  const rows = await db.select<{ text: string; status: CaptureStatus; created_at: string }[]>(
    "SELECT text, status, created_at FROM captures WHERE id = $1",
    [data.captureId],
  );
  const cap = rows[0];
  if (!cap) throw new Error(`Capture ${data.captureId} does not exist.`);
  if (cap.status !== "new") throw new Error(`Capture ${data.captureId} is no longer new.`);

  const kind = data.taskId ? "subtask" : "task";
  const batch = new TransactionBatch();
  // The guard: a capture that is not new, or a task that is not an open task of
  // the project, gives status NULL, which aborts the batch.
  batch.add(
    `UPDATE captures SET status = CASE
         WHEN status = 'new' AND ($3 IS NULL OR EXISTS
           (SELECT 1 FROM tasks WHERE id = $3 AND project_id = $2 AND status <> 'done'))
         THEN 'filed' ELSE NULL END,
       outcome = 'note', project_id = $2, inbox_reason = NULL, updated_at = datetime('now') WHERE id = $1`,
    [data.captureId, data.projectId, data.taskId ?? null],
  );
  if (data.taskId) {
    batch.add(
      `INSERT INTO subtasks (task_id, title, sort_order)
       VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM subtasks WHERE task_id = $1))`,
      [data.taskId, data.title],
    );
    batch.add(
      "UPDATE captures SET task_id = $2, subtask_id = $LAST_INSERT_ID WHERE id = $1",
      [data.captureId, data.taskId],
    );
  } else {
    batch.add(
      `INSERT INTO tasks (project_id, title, notes, sort_order)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks WHERE project_id = $1))`,
      [data.projectId, data.title, `Captured ${cap.created_at.slice(0, 10)}: ${cap.text}`],
    );
    batch.add("UPDATE captures SET task_id = $LAST_INSERT_ID WHERE id = $1", [data.captureId]);
  }
  try {
    const { lastInsertId } = await batch.commit();
    return { kind, id: lastInsertId };
  } catch (e) {
    const now = await db.select<{ status: CaptureStatus }[]>("SELECT status FROM captures WHERE id = $1", [data.captureId]);
    const why =
      now[0] && now[0].status !== "new"
        ? `Capture ${data.captureId} is no longer new.`
        : data.taskId
          ? `Task ${data.taskId} is not an open task of that project.`
          : null;
    if (!why) throw e;
    const err = new Error(why);
    (err as Error & { cause?: unknown }).cause = e;
    throw err;
  }
}

/** Where a filed capture's item lives: its subtask if it has one, else its task. */
async function settle(captureId: number, outcome: "note" | "ready", clearStage: boolean): Promise<void> {
  const batch = new TransactionBatch();
  if (clearStage) {
    batch.add(
      "UPDATE tasks SET stage = NULL, updated_at = datetime('now') WHERE id = (SELECT task_id FROM captures WHERE id = $1 AND subtask_id IS NULL)",
      [captureId],
    );
    batch.add(
      "UPDATE subtasks SET stage = NULL, updated_at = datetime('now') WHERE id = (SELECT subtask_id FROM captures WHERE id = $1)",
      [captureId],
    );
  }
  batch.add("UPDATE captures SET outcome = $2, updated_at = datetime('now') WHERE id = $1", [captureId, outcome]);
  await batch.commit();
}

/** Keep the filed item as a plain task: no stage left. */
export function keepAsTask(captureId: number): Promise<void> {
  return settle(captureId, "note", true);
}

/** The agent was started on it: only the outcome changes, the start sets the stage to Running. */
export function markStarted(captureId: number): Promise<void> {
  return settle(captureId, "ready", false);
}

export async function setBrief(kind: "task" | "subtask", id: number, brief: string): Promise<void> {
  const db = await getDb();
  const table = kind === "task" ? "tasks" : "subtasks";
  await db.execute(`UPDATE ${table} SET brief = $2, updated_at = datetime('now') WHERE id = $1`, [id, brief]);
}

/** Send a failed or unplaced capture to the next brief session. */
export async function briefAgain(captureId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE captures SET brief_tries = 0, inbox_reason = NULL, updated_at = datetime('now') WHERE id = $1",
    [captureId],
  );
}
