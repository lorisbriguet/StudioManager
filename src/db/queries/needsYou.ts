import { getDb, TransactionBatch } from "../index";
import type { NeedsYouRow } from "../../types/needsYou";

/** A Needs you row with the item, its project and the agent link it came from. */
export interface NeedsYouEntry extends NeedsYouRow {
  item_title: string;
  project_id: number | null;
  project_name: string | null;
  /** The link's short id and session id; null when the entry has no link. */
  short_id: string | null;
  session_id: string | null;
}

const SELECT_ENTRY = `
  SELECT n.*, COALESCE(t.title, s.title) AS item_title,
         p.id AS project_id, p.name AS project_name,
         a.short_id AS short_id, a.session_id AS session_id
  FROM needs_you n
  LEFT JOIN tasks t ON t.id = n.task_id
  LEFT JOIN subtasks s ON s.id = n.subtask_id
  LEFT JOIN tasks st ON st.id = s.task_id
  LEFT JOIN projects p ON p.id = COALESCE(t.project_id, st.project_id)
  LEFT JOIN task_agents a ON a.id = n.link_id`;

/** What waits on Loris: open questions and finished work (a reopened entry too), oldest first. */
export async function getOpenEntries(): Promise<NeedsYouEntry[]> {
  const db = await getDb();
  return db.select<NeedsYouEntry[]>(`${SELECT_ENTRY} WHERE n.status = 'open' ORDER BY n.created_at, n.id`);
}

/** What the lead or the app decided without Loris in the last `sinceDays` days, newest first. */
export async function getAloneEntries(sinceDays: number = 7): Promise<NeedsYouEntry[]> {
  const db = await getDb();
  return db.select<NeedsYouEntry[]>(
    `${SELECT_ENTRY}
     WHERE n.status <> 'open' AND (n.kind = 'alone' OR n.decided_by IN ('lead', 'app'))
       AND COALESCE(n.answered_at, n.created_at) >= datetime('now', $1)
     ORDER BY COALESCE(n.answered_at, n.created_at) DESC, n.id DESC`,
    [`-${Math.floor(sinceDays)} days`],
  );
}

export async function countOpen(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM needs_you WHERE status = 'open'");
  return rows[0]?.n ?? 0;
}

/** Loris answers an open entry. An entry already answered or dismissed is left as it is. */
export async function answerEntry(id: number, answer: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE needs_you SET status = 'answered', answer = $2, decided_by = 'user', answered_at = datetime('now')
     WHERE id = $1 AND status = 'open'`,
    [id, answer],
  );
}

export async function dismissEntry(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE needs_you SET status = 'dismissed', decided_by = 'user', answered_at = datetime('now')
     WHERE id = $1 AND status = 'open'`,
    [id],
  );
}

/**
 * Put an answered, dismissed or decided-alone entry back to open, with nobody's decision on it.
 * When its link's work was merged, the task (or subtask) goes back to todo, To check.
 */
export async function reopenEntry(id: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ status: string; task_id: number | null; subtask_id: number | null; outcome: string | null }[]>(
    `SELECT n.status, n.task_id, n.subtask_id, a.outcome
     FROM needs_you n LEFT JOIN task_agents a ON a.id = n.link_id WHERE n.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row || row.status === "open") return;
  const batch = new TransactionBatch();
  batch.add(
    `UPDATE needs_you SET status = 'open', answer = NULL, decided_by = NULL, answered_at = NULL, delivered_at = NULL
     WHERE id = $1 AND status <> 'open'`,
    [id],
  );
  if (row.outcome === "merged") {
    const table = row.subtask_id != null ? "subtasks" : "tasks";
    batch.add(
      `UPDATE ${table} SET status = 'todo', stage = 'to_check', updated_at = datetime('now') WHERE id = $1`,
      [row.subtask_id ?? row.task_id],
    );
  }
  await batch.commit();
}
