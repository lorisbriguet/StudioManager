import { getDb } from "../index";
import type { PLData, CategoryTotal, DashboardKPIs } from "../../types/finance";

export async function getPLData(year: number): Promise<PLData> {
  const db = await getDb();
  const yearStr = String(year);

  const [revenueRow] = await db.select<{ total: number }[]>(
    `SELECT COALESCE(SUM(CASE WHEN currency != 'CHF' AND chf_equivalent > 0 THEN chf_equivalent ELSE total END), 0) as total FROM invoices
     WHERE strftime('%Y', invoice_date) = $1 AND status != 'cancelled'`,
    [yearStr]
  );
  const invoiceRevenue = revenueRow?.total ?? 0;

  const [incomeRow] = await db.select<{ total: number }[]>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM income
     WHERE strftime('%Y', date) = $1`,
    [yearStr]
  );
  const otherIncome = incomeRow?.total ?? 0;
  const revenue = invoiceRevenue + otherIncome;

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
    invoice_revenue: invoiceRevenue,
    other_income: otherIncome,
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
    `SELECT strftime('%Y-%m', invoice_date) as month,
     COALESCE(SUM(CASE WHEN currency != 'CHF' AND chf_equivalent > 0 THEN chf_equivalent ELSE total END), 0) as total
     FROM invoices WHERE strftime('%Y', invoice_date) = $1 AND status != 'cancelled'
     GROUP BY month ORDER BY month`,
    [yearStr]
  );

  const expenseRows = await db.select<{ month: string; total: number }[]>(
    `SELECT strftime('%Y-%m', invoice_date) as month, COALESCE(SUM(amount), 0) as total
     FROM expenses WHERE strftime('%Y', invoice_date) = $1
     GROUP BY month ORDER BY month`,
    [yearStr]
  );

  const incomeRows = await db.select<{ month: string; total: number }[]>(
    `SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(amount), 0) as total
     FROM income WHERE strftime('%Y', date) = $1
     GROUP BY month ORDER BY month`,
    [yearStr]
  );

  for (const r of revenueRows) {
    const m = months.find((m) => m.month === r.month);
    if (m) m.revenue = r.total;
  }
  for (const inc of incomeRows) {
    const m = months.find((m) => m.month === inc.month);
    if (m) m.revenue += inc.total;
  }
  for (const e of expenseRows) {
    const m = months.find((m) => m.month === e.month);
    if (m) m.expenses = e.total;
  }

  return months;
}

export interface RevenueByGroup {
  label: string;
  total: number;
}

export async function getRevenueByActivity(year: number): Promise<RevenueByGroup[]> {
  const db = await getDb();
  return db.select<RevenueByGroup[]>(
    `SELECT COALESCE(activity, 'N/A') as label,
     COALESCE(SUM(CASE WHEN currency != 'CHF' AND chf_equivalent > 0 THEN chf_equivalent ELSE total END), 0) as total
     FROM invoices WHERE strftime('%Y', invoice_date) = $1 AND status != 'cancelled'
     GROUP BY activity ORDER BY total DESC`,
    [String(year)]
  );
}

export async function getRevenueByClient(year: number): Promise<RevenueByGroup[]> {
  const db = await getDb();
  return db.select<RevenueByGroup[]>(
    `SELECT COALESCE(c.name, 'Unknown') as label,
     COALESCE(SUM(CASE WHEN i.currency != 'CHF' AND i.chf_equivalent > 0 THEN i.chf_equivalent ELSE i.total END), 0) as total
     FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
     WHERE strftime('%Y', i.invoice_date) = $1 AND i.status != 'cancelled'
     GROUP BY i.client_id ORDER BY total DESC`,
    [String(year)]
  );
}

export async function getDashboardKPIs(year: number): Promise<DashboardKPIs> {
  const db = await getDb();
  const yearStr = String(year);

  const [invoiced] = await db.select<{ total: number; count: number }[]>(
    `SELECT COALESCE(SUM(CASE WHEN currency != 'CHF' AND chf_equivalent > 0 THEN chf_equivalent ELSE total END), 0) as total, COUNT(*) as count
     FROM invoices WHERE strftime('%Y', invoice_date) = $1 AND status != 'cancelled'`,
    [yearStr]
  );

  const [open] = await db.select<{ total: number }[]>(
    `SELECT COALESCE(SUM(CASE WHEN currency != 'CHF' AND chf_equivalent > 0 THEN chf_equivalent ELSE total END), 0) as total
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

  const [incomeTotal] = await db.select<{ total: number }[]>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM income WHERE strftime('%Y', date) = $1`,
    [yearStr]
  );
  const otherIncome = incomeTotal?.total ?? 0;

  return {
    total_invoiced: (invoiced?.total ?? 0) + otherIncome,
    open_balance: open?.total ?? 0,
    overdue_count: overdue?.count ?? 0,
    total_expenses: expenses?.total ?? 0,
    net_result: (invoiced?.total ?? 0) + otherIncome - (expenses?.total ?? 0),
    invoice_count: invoiced?.count ?? 0,
  };
}
