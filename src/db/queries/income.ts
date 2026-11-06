import { getDb, validateFields } from "../index";
import { getNextReference, referenceYear } from "./referenceGenerator";
import type { Income } from "../../types/income";

export async function getIncomes(): Promise<Income[]> {
  const db = await getDb();
  return db.select<Income[]>(
    "SELECT * FROM income ORDER BY date DESC"
  );
}

/** Next income number (R-26-001), in the year of its date. */
export async function nextIncomeReferenceFor(date: string | null | undefined): Promise<string> {
  const shortYear = String(referenceYear(date)).slice(-2);
  return getNextReference("income", "reference", `R-${shortYear}-`);
}

export async function createIncome(
  data: Omit<Income, "id" | "created_at" | "updated_at">
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO income (reference, date, description, amount, category, source, receipt_path, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.reference, data.date, data.description, data.amount,
      data.category, data.source, data.receipt_path, data.notes,
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function updateIncome(
  id: number,
  data: Partial<Omit<Income, "id" | "created_at" | "updated_at">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];
  await db.execute(
    `UPDATE income SET ${sets}, updated_at = datetime('now') WHERE id = $1`,
    values
  );
}

export async function getIncomeById(id: number): Promise<Income | null> {
  const db = await getDb();
  const rows = await db.select<Income[]>("SELECT * FROM income WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function deleteIncome(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM income WHERE id = $1", [id]);
}
