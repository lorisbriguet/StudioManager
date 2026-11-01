import { getDb } from "../index";

export type PaperlessLinkState = "linked" | "dismissed";

export interface PaperlessLink {
  state: PaperlessLinkState;
  expense_id: number | null;
}

interface PaperlessLinkRow extends PaperlessLink {
  paperless_doc_id: number;
}

/** Every document of the connection that was linked to an expense or dismissed, by Paperless document id. */
export async function getPaperlessLinks(connectionId: number): Promise<Map<number, PaperlessLink>> {
  const db = await getDb();
  const rows = await db.select<PaperlessLinkRow[]>(
    "SELECT paperless_doc_id, state, expense_id FROM paperless_links WHERE connection_id = $1",
    [connectionId]
  );
  return new Map(rows.map((r) => [r.paperless_doc_id, { state: r.state, expense_id: r.expense_id }]));
}

/** Link a document to an expense (also turns a dismissed document into a linked one). */
export async function linkPaperlessDoc(connectionId: number, docId: number, expenseId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO paperless_links (connection_id, paperless_doc_id, expense_id, state)
     VALUES ($1, $2, $3, 'linked')
     ON CONFLICT(connection_id, paperless_doc_id) DO UPDATE SET expense_id = excluded.expense_id, state = 'linked'`,
    [connectionId, docId, expenseId]
  );
}

/** Hide a document from the inbox. */
export async function dismissPaperlessDoc(connectionId: number, docId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO paperless_links (connection_id, paperless_doc_id, expense_id, state)
     VALUES ($1, $2, NULL, 'dismissed')
     ON CONFLICT(connection_id, paperless_doc_id) DO UPDATE SET expense_id = NULL, state = 'dismissed'`,
    [connectionId, docId]
  );
}

/** Bring a dismissed document back. A linked one is left alone. */
export async function undismissPaperlessDoc(connectionId: number, docId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM paperless_links WHERE connection_id = $1 AND paperless_doc_id = $2 AND state = 'dismissed'",
    [connectionId, docId]
  );
}
