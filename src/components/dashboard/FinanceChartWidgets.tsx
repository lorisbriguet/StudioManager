import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { ICONS } from "../ui/icons";
import { StatTile } from "../ui/StatTile";
import { useMonthlyData, useRevenueByActivity, useRevenueByClient } from "../../db/hooks/useFinance";
import { useExpenses } from "../../db/hooks/useExpenses";
import { getExpenseCategories } from "../../db/queries/expenses";
import { useChartTheme } from "../../hooks/useChartTheme";
import { useT } from "../../i18n/useT";
import { useAppStore } from "../../stores/app-store";
import { useActivities } from "../../db/hooks/useActivities";
import { resolveActivityRevenue } from "../../lib/activityResolve";
import { tagHash } from "../../lib/tagColors";
import { useDashboardYear } from "./DashboardYearContext";
import { WidgetShell, WidgetTitle } from "./WidgetShell";
import { ProgressBar } from "../ui/Feedback";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/Skeleton";
import { formatMoney } from "../../lib/money";
import { qk } from "../../db/queryKeys";
import { KPI_TILE, formatCHF } from "./widgetParts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Chart widget ──

export function ChartRevenue() {
  const year = useDashboardYear();
  const { data: monthly } = useMonthlyData(year);
  const chart = useChartTheme();
  const t = useT();

  const chartData = monthly?.map((m, i) => ({
    name: MONTHS[i],
    revenue: m.revenue,
    expenses: m.expenses,
  })) ?? [];

  return (
    <WidgetShell>
      <WidgetTitle>{t.revenue} {year}</WidgetTitle>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.gridStroke} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: chart.tickFill }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: chart.tickFill }} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(value) => [formatMoney(Number(value ?? 0), "CHF"), ""]}
              contentStyle={chart.tooltipStyle}
              cursor={{ fill: chart.cursorFill }}
            />
            <Bar dataKey="revenue" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} name={t.revenue} />
            <Bar dataKey="expenses" fill="var(--color-chart-4)" radius={[4, 4, 0, 0]} name={t.expenses} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetShell>
  );
}

// ── Revenue by activity ──

const COLORS = [
  "var(--color-chart-2)",
  "var(--color-chart-1)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
  "var(--color-chart-8)",
];

export function RevenueByActivity() {
  const year = useDashboardYear();
  const { data: rawRows } = useRevenueByActivity(year);
  const { data: activities } = useActivities();
  const lang = useAppStore((s) => s.language);
  const t = useT();

  const rows = useMemo(
    () => resolveActivityRevenue(rawRows ?? [], activities ?? [], lang),
    [rawRows, activities, lang]
  );
  const total = rows.reduce((s, r) => s + r.total, 0);

  return (
    <WidgetShell>
      <WidgetTitle>{t.revenue_by_activity}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2">
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.total / total) * 100) : 0;
          return (
            <div key={r.key}>
              <div className="flex items-center justify-between text-sm mb-0.5">
                <span className="truncate">{r.label}</span>
                <span className="text-xs text-muted shrink-0 ml-2">{formatCHF(r.total)} ({pct}%)</span>
              </div>
              {/* Hash the stable key, not the sorted index: an activity keeps its color when rankings shift */}
              <ProgressBar value={pct} color={COLORS[tagHash(r.key) % COLORS.length]} aria-label={r.label} />
            </div>
          );
        })}
        {rawRows === undefined ? <ListSkeleton size="sm" rows={3} /> : rows.length === 0 && <EmptyState size="sm" message={t.no_revenue_in_year.replace("{year}", String(year))} />}
      </div>
    </WidgetShell>
  );
}

// ── Revenue by client ──

export function RevenueByClient() {
  const year = useDashboardYear();
  const { data: rows } = useRevenueByClient(year);
  const t = useT();

  const total = rows?.reduce((s, r) => s + r.total, 0) ?? 0;

  return (
    <WidgetShell>
      <WidgetTitle>{t.revenue_by_client}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2">
        {rows?.map((r) => {
          const pct = total > 0 ? Math.round((r.total / total) * 100) : 0;
          return (
            <div key={r.label}>
              <div className="flex items-center justify-between text-sm mb-0.5">
                <span className="truncate">{r.label}</span>
                <span className="text-xs text-muted shrink-0 ml-2">{formatCHF(r.total)} ({pct}%)</span>
              </div>
              {/* Hash the client name so colors survive ranking changes */}
              <ProgressBar value={pct} color={COLORS[tagHash(r.label) % COLORS.length]} aria-label={r.label} />
            </div>
          );
        })}
        {rows === undefined ? <ListSkeleton size="sm" rows={3} /> : rows.length === 0 && <EmptyState size="sm" message={t.no_revenue_in_year.replace("{year}", String(year))} />}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: Expense breakdown (pie chart) ──

export function ExpenseBreakdown() {
  const { data: expenses } = useExpenses();
  const { data: categories } = useQuery({ queryKey: qk.dashboard.expenseCategories, queryFn: getExpenseCategories });
  const chart = useChartTheme();
  const t = useT();
  const year = useDashboardYear();

  const data = useMemo(() => {
    if (!expenses || !categories) return [];
    const yearExpenses = expenses.filter((e) => e.invoice_date.startsWith(String(year)));
    const byCategory: Record<string, number> = {};
    for (const e of yearExpenses) {
      byCategory[e.category_code] = (byCategory[e.category_code] ?? 0) + e.amount;
    }
    return Object.entries(byCategory)
      .map(([code, total]) => {
        const cat = categories.find((c) => c.code === code);
        // name_fr to match the category labels on the Expenses page
        return { code, name: cat?.name_fr ?? code, value: total };
      })
      .sort((a, b) => b.value - a.value);
  }, [expenses, categories, year]);

  return (
    <WidgetShell>
      <WidgetTitle>{t.expense_breakdown} {year}</WidgetTitle>
      <div className="flex-1 min-h-0">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="80%" innerRadius="40%">
                {/* Hash the category code so slices keep their color across ranking changes */}
                {data.map((d) => <Cell key={d.code} fill={COLORS[tagHash(d.code) % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(value) => formatMoney(Number(value), "CHF")} contentStyle={chart.tooltipStyle} itemStyle={chart.pieItemStyle} labelStyle={{ color: "var(--color-text)" }} />
            </PieChart>
          </ResponsiveContainer>
        ) : expenses === undefined || categories === undefined ? (
          <ListSkeleton size="sm" rows={3} />
        ) : (
          <EmptyState size="sm" icon={ICONS.expense} message={t.no_expenses_in_year.replace("{year}", String(year))} className="h-full" />
        )}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: Monthly comparison ──

export function MonthlyComparison() {
  const year = useDashboardYear();
  const month = new Date().getMonth();
  const { data: currentYearData } = useMonthlyData(year);
  const { data: lastYearData } = useMonthlyData(year - 1);
  const t = useT();

  const currentRev = currentYearData?.[month]?.revenue ?? 0;
  const lastRev = lastYearData?.[month]?.revenue ?? 0;
  const diff = lastRev > 0 ? Math.round(((currentRev - lastRev) / lastRev) * 100) : 0;

  return (
    <StatTile
      className={KPI_TILE}
      label={t.monthly_comparison}
      value={formatCHF(currentRev)}
      caption={lastRev > 0 ? (
        <span className={diff >= 0 ? "text-success-text" : "text-danger-text"}>
          {diff >= 0 ? "+" : ""}{diff}% {t.vs_last_year}
        </span>
      ) : (
        <span>{t.vs_last_year}: {t.no_data}</span>
      )}
    />
  );
}
