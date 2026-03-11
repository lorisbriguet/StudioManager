import { getDb } from "../index";
import type { PLData, CategoryTotal, DashboardKPIs } from "../../types/finance";

export async function getPLData(year: number): Promise<PLData> {
  const db = await getDb();
  const yearStr = String(year);

  const [revenueRow] = await db.select<{ total: number }[]>(
    `SELECT COALESCE(SUM(total), 0) as total FROM invoices
     WHERE strftime('%Y', invoice_date) = $1`,
    [yearStr]
  );
  const revenue = revenueRow?.total ?? 0;

  const operatingRows = await db.select<CategoryTotal[]>(
    `SELECT e.category_code, ec.name_fr, ec.name_en, COALESCE(SUM(e.amount), 0) as total
     FROM expenses e
     JOIN expense_categories ec ON e.category_code = ec.code
     WHERE ec.pl_section = 'operating' AND strftime('%Y', e.invoice_date) = $1
     GROUP BY e.category_code`,
    [yearStr]
  );

  const [socialRow] = await db.select<{ total: number }[]>(
    `SELECT COALESCE(SUM(e.amount), 0) as total
     FROM expenses e
     JOIN expense_categories ec ON e.category_code = ec.code
     WHERE ec.pl_section = 'social_charges' AND strftime('%Y', e.invoice_date) = $1`,
    [yearStr]
  );

  const totalOperating = operatingRows.reduce((sum, r) => sum + r.total, 0);
  const socialCharges = socialRow?.total ?? 0;

  return {
    revenue,
    operating_expenses: operatingRows,
    total_operating: totalOperating,
    social_charges: socialCharges,
    operating_net: revenue - totalOperating,
    net_result: revenue - totalOperating - socialCharges,
  };
}

export interface MonthlyData {
  month: string;
  revenue: number;
  expenses: number;
}

export async function getMonthlyData(year: number): Promise<MonthlyData[]> {
  const db = await getDb();
  const yearStr = String(year);

  const months = Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, "0");
    return { month: `${yearStr}-${m}`, revenue: 0, expenses: 0 };
  });

  const revenueRows = await db.select<{ month: string; total: number }[]>(
    `SELECT strftime('%Y-%m', invoice_date) as month, COALESCE(SUM(total), 0) as total
     FROM invoices WHERE strftime('%Y', invoice_date) = $1
     GROUP BY month ORDER BY month`,
    [yearStr]
  );

  const expenseRows = await db.select<{ month: string; total: number }[]>(
    `SELECT strftime('%Y-%m', invoice_date) as month, COALESCE(SUM(amount), 0) as total
     FROM expenses WHERE strftime('%Y', invoice_date) = $1
     GROUP BY month ORDER BY month`,
    [yearStr]
  );

  for (const r of revenueRows) {
    const m = months.find((m) => m.month === r.month);
    if (m) m.revenue = r.total;
  }
  for (const e of expenseRows) {
    const m = months.find((m) => m.month === e.month);
    if (m) m.expenses = e.total;
  }

  return months;
}

export async function getDashboardKPIs(year: number): Promise<DashboardKPIs> {
  const db = await getDb();
  const yearStr = String(year);

  const [invoiced] = await db.select<{ total: number; count: number }[]>(
    `SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count
     FROM invoices WHERE strftime('%Y', invoice_date) = $1`,
    [yearStr]
  );

  const [open] = await db.select<{ total: number }[]>(
    `SELECT COALESCE(SUM(total), 0) as total
     FROM invoices WHERE status != 'paid' AND status != 'cancelled'
     AND strftime('%Y', invoice_date) = $1`,
    [yearStr]
  );

  const [overdue] = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM invoices
     WHERE status = 'overdue' AND strftime('%Y', invoice_date) = $1`,
    [yearStr]
  );

  const [expenses] = await db.select<{ total: number }[]>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM expenses WHERE strftime('%Y', invoice_date) = $1`,
    [yearStr]
  );

  return {
    total_invoiced: invoiced?.total ?? 0,
    open_balance: open?.total ?? 0,
    overdue_count: overdue?.count ?? 0,
    total_expenses: expenses?.total ?? 0,
    net_result: (invoiced?.total ?? 0) - (expenses?.total ?? 0),
    invoice_count: invoiced?.count ?? 0,
  };
}
