import { getDb, validateFields } from "../index";
import type { Expense, ExpenseCategory } from "../../types/expense";

export async function getExpenses(): Promise<Expense[]> {
  const db = await getDb();
  return db.select<Expense[]>(
    "SELECT * FROM expenses ORDER BY invoice_date DESC"
  );
}

export async function getExpenseCategories(): Promise<ExpenseCategory[]> {
  const db = await getDb();
  return db.select<ExpenseCategory[]>(
    "SELECT * FROM expense_categories ORDER BY code"
  );
}

export async function getNextExpenseReference(year: number): Promise<string> {
  const db = await getDb();
  const shortYear = String(year).slice(-2);
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM expenses WHERE reference LIKE $1",
    [`F-${shortYear}-%`]
  );
  const next = (rows[0]?.count ?? 0) + 1;
  return `F-${shortYear}-${String(next).padStart(3, "0")}`;
}

export async function createExpense(
  data: Omit<Expense, "id" | "created_at" | "updated_at">
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO expenses (reference, supplier, category_code, invoice_date, due_date, amount, paid_date, receipt_path, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      data.reference, data.supplier, data.category_code, data.invoice_date,
      data.due_date, data.amount, data.paid_date, data.receipt_path, data.notes,
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function updateExpense(
  id: number,
  data: Partial<Omit<Expense, "id" | "created_at" | "updated_at">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];
  await db.execute(
    `UPDATE expenses SET ${sets}, updated_at = datetime('now') WHERE id = $1`,
    values
  );
}

export async function getDistinctSuppliers(): Promise<
  { supplier: string; category_code: string; amount: number }[]
> {
  const db = await getDb();
  return db.select(
    `SELECT supplier, category_code, amount
     FROM expenses
     WHERE id IN (
       SELECT MAX(id) FROM expenses GROUP BY supplier
     )
     ORDER BY supplier`
  );
}

export async function getExpenseById(id: number): Promise<Expense | null> {
  const db = await getDb();
  const rows = await db.select<Expense[]>("SELECT * FROM expenses WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function deleteExpense(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM expenses WHERE id = $1", [id]);
}
