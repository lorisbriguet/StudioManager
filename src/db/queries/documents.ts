import { getDb, validateFields, TransactionBatch } from "../index";
import type { DocumentKind, LineItemFields } from "../../types/document";

/**
 * Queries shared by invoices and quotes. Table and column names come from
 * this fixed map only, never from callers, so they are safe to interpolate.
 * What differs between the two (insert columns, delete rules, aging,
 * overdue) stays in invoices.ts and quotes.ts.
 */
const TABLES = {
  invoice: {
    table: "invoices",
    lineItemTable: "invoice_line_items",
    foreignKey: "invoice_id",
    dateColumn: "invoice_date",
  },
  quote: {
    table: "quotes",
    lineItemTable: "quote_line_items",
    foreignKey: "quote_id",
    dateColumn: "quote_date",
  },
} as const satisfies Record<DocumentKind, Record<string, string>>;

type Writable<Doc> = Partial<Omit<Doc, "id" | "created_at" | "updated_at">>;

export function documentQueries<Doc, Item extends LineItemFields>(kind: DocumentKind) {
  const { table, lineItemTable, foreignKey, dateColumn } = TABLES[kind];

  function setClause<D>(data: D) {
    const fields = Object.keys(data as object);
    validateFields(fields);
    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
    const values = fields.map((f) => data[f as keyof D]);
    return { sets, values };
  }

  return {
    async list(): Promise<Doc[]> {
      const db = await getDb();
      return db.select<Doc[]>(`SELECT * FROM ${table} ORDER BY ${dateColumn} DESC, id DESC`);
    },

    async get(id: number): Promise<Doc | null> {
      const db = await getDb();
      const rows = await db.select<Doc[]>(`SELECT * FROM ${table} WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async listByProject(projectId: number): Promise<Doc[]> {
      const db = await getDb();
      return db.select<Doc[]>(
        `SELECT * FROM ${table} WHERE project_id = $1 ORDER BY ${dateColumn} DESC, id DESC`,
        [projectId]
      );
    },

    /** Queue the line items of a document inserted earlier in the same batch. */
    addNewLineItems(batch: TransactionBatch, lineItems: LineItemFields[]): void {
      for (const item of lineItems) {
        batch.add(
          `INSERT INTO ${lineItemTable} (${foreignKey}, designation, rate, unit, quantity, amount, sort_order)
           VALUES ($LAST_INSERT_ID, $1, $2, $3, $4, $5, $6)`,
          [item.designation, item.rate, item.unit, item.quantity, item.amount, item.sort_order]
        );
      }
    },

    /** Update the document's fields only (no line items). */
    async update(id: number, data: Writable<Doc>): Promise<void> {
      const { sets, values } = setClause(data);
      const db = await getDb();
      await db.execute(
        `UPDATE ${table} SET ${sets}, updated_at = datetime('now') WHERE id = $1`,
        [id, ...values]
      );
    },

    /** Update the fields and, when given, replace all line items, in one transaction. */
    async updateWithLineItems(
      id: number,
      data: Writable<Doc>,
      lineItems?: LineItemFields[]
    ): Promise<void> {
      const { sets, values } = setClause(data);
      const batch = new TransactionBatch();
      batch.add(`UPDATE ${table} SET ${sets}, updated_at = datetime('now') WHERE id = $1`, [
        id,
        ...values,
      ]);
      if (lineItems) {
        batch.add(`DELETE FROM ${lineItemTable} WHERE ${foreignKey} = $1`, [id]);
        for (const item of lineItems) {
          batch.add(
            `INSERT INTO ${lineItemTable} (${foreignKey}, designation, rate, unit, quantity, amount, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, item.designation, item.rate, item.unit, item.quantity, item.amount, item.sort_order]
          );
        }
      }
      await batch.commit();
    },

    async lineItems(documentId: number): Promise<Item[]> {
      const db = await getDb();
      return db.select<Item[]>(
        `SELECT * FROM ${lineItemTable} WHERE ${foreignKey} = $1 ORDER BY sort_order`,
        [documentId]
      );
    },
  };
}
