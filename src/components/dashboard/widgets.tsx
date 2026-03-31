import { useMemo, useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  LineChart,
  Line,
  Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { FileText, Receipt, ClipboardList, FolderPlus } from "lucide-react";
import { useCountUp } from "../../hooks/useCountUp";
import { useDashboardKPIs, useMonthlyData, useRevenueByActivity, useRevenueByClient } from "../../db/hooks/useFinance";
import { useProjects } from "../../db/hooks/useProjects";
import { useAllTasks } from "../../db/hooks/useTasks";
import { useInvoices } from "../../db/hooks/useInvoices";
import { useQuotes } from "../../db/hooks/useQuotes";
import { useExpenses } from "../../db/hooks/useExpenses";
import { useClients } from "../../db/hooks/useClients";
import {
  getSubtasksWithDueDate,
  getPlannedVsActual,
} from "../../db/queries/tasks";
import {
  getTimeThisWeek,
  getTopTimeConsumers,
  getWeeklyTrend,
  getProjectTimeDistribution,
  getBillableSummary,
} from "../../db/queries/timeEntries";
import { useDashboardStore } from "../../stores/dashboard-store";
import { effectivePriority } from "../../types/task";
import { useChartTheme } from "../../hooks/useChartTheme";
import { useT } from "../../i18n/useT";
import type { WidgetType } from "../../stores/dashboard-store";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCHF(amount: number): string {
  return `CHF ${amount.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PriorityDot({ priority }: { priority: string }) {
  const color = priority === "high" ? "bg-danger" : priority === "medium" ? "bg-warning" : "bg-success";
  return <span className={`dot-sm ${color}`} />;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "paid" ? "bg-success" :
    status === "overdue" ? "bg-danger" :
    status === "sent" ? "bg-warning" :
    status === "draft" ? "bg-indigo-500" :
    "bg-[var(--color-input-bg)]";
  return <span className={`dot-sm ml-2 ${color}`} />;
}

// ── KPI widgets ──

function KPIWidget({ label, value, numericValue, accent }: { label: string; value: string; numericValue?: number; accent?: boolean }) {
  const animated = useCountUp(numericValue ?? 0);
  const displayValue = numericValue != null
    ? `CHF ${animated.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value;
  return (
    <div className="h-full flex flex-col justify-center px-4">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-lg font-semibold ${accent ? "text-warning" : ""}`}>{displayValue}</div>
    </div>
  );
}

function KPIInvoiced() {
  const year = new Date().getFullYear();
  const { data: kpis } = useDashboardKPIs(year);
  const t = useT();
  return <KPIWidget label={t.total_invoiced} value={formatCHF(kpis?.total_invoiced ?? 0)} numericValue={kpis?.total_invoiced ?? 0} />;
}

function KPIBalance() {
  const year = new Date().getFullYear();
  const { data: kpis } = useDashboardKPIs(year);
  const t = useT();
  return <KPIWidget label={t.open_balance} value={formatCHF(kpis?.open_balance ?? 0)} numericValue={kpis?.open_balance ?? 0} accent={!!kpis?.open_balance} />;
}

function KPIExpenses() {
  const year = new Date().getFullYear();
  const { data: kpis } = useDashboardKPIs(year);
  const t = useT();
  return <KPIWidget label={t.total_expenses} value={formatCHF(kpis?.total_expenses ?? 0)} numericValue={kpis?.total_expenses ?? 0} />;
}

function KPINet() {
  const year = new Date().getFullYear();
  const { data: kpis } = useDashboardKPIs(year);
  const t = useT();
  return <KPIWidget label={t.net_result} value={formatCHF(kpis?.net_result ?? 0)} numericValue={kpis?.net_result ?? 0} />;
}

// ── Chart widget ──

function ChartRevenue() {
  const year = new Date().getFullYear();
  const { data: monthly } = useMonthlyData(year);
  const chart = useChartTheme();
  const t = useT();

  const chartData = monthly?.map((m, i) => ({
    name: MONTHS[i],
    revenue: m.revenue,
    expenses: m.expenses,
  })) ?? [];

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.revenue} {year}</h2>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.gridStroke} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: chart.tickFill }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: chart.tickFill }} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(value) => [`CHF ${Number(value ?? 0).toFixed(2)}`, ""]}
              contentStyle={chart.tooltipStyle}
              cursor={{ fill: chart.cursorFill }}
            />
            <Bar dataKey="revenue" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} name={t.revenue} />
            <Bar dataKey="expenses" fill="var(--color-chart-4)" radius={[4, 4, 0, 0]} name={t.expenses} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Recent invoices ──

function RecentInvoices() {
  const { data: invoices } = useInvoices();
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: async () => {
    const { getDb } = await import("../../db");
    const db = await getDb();
    return db.select<{ id: string; name: string }[]>("SELECT id, name FROM clients");
  }});
  const t = useT();

  const clientsMap = useMemo(() => new Map(clients?.map((c) => [c.id, c.name]) ?? []), [clients]);
  const clientName = (clientId: string) => clientsMap.get(clientId) ?? "";

  const recentInvoices = useMemo(() => {
    if (!invoices) return [];
    const priorityOrder: Record<string, number> = { overdue: 0, sent: 1, draft: 2, paid: 3, cancelled: 4 };
    return [...invoices]
      .sort((a, b) => (priorityOrder[a.status] ?? 9) - (priorityOrder[b.status] ?? 9))
      .slice(0, 5);
  }, [invoices]);

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">{t.recent_invoices}</h2>
        <Link to="/invoices" className="text-xs text-accent hover:underline">{t.view_all}</Link>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2">
        {recentInvoices.map((inv) => (
          <Link
            key={inv.id}
            to={`/invoices/${inv.id}/edit`}
            className="flex justify-between items-center text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1.5 -mx-2"
          >
            <div className="min-w-0 flex-1">
              <span className="font-medium">{inv.reference.startsWith("DRAFT") ? t.draft : inv.reference}</span>
              <StatusDot status={inv.status} />
              {clientName(inv.client_id) && (
                <span className="text-xs text-muted ml-2 truncate">{clientName(inv.client_id)}</span>
              )}
            </div>
            <span className="text-muted shrink-0 ml-2">CHF {inv.total.toFixed(2)}</span>
          </Link>
        ))}
        {recentInvoices.length === 0 && (
          <div className="text-xs text-muted">{t.no_invoices_yet}</div>
        )}
      </div>
    </div>
  );
}

// ── Today tasks ──

function TodayTasks() {
  const { data: tasks } = useAllTasks();
  const { data: subtasks } = useQuery({ queryKey: ["subtasks", "with-due-date"], queryFn: getSubtasksWithDueDate });
  const { data: projects } = useProjects();
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);

  const projectName = (projectId: number) => projects?.find((p) => p.id === projectId)?.name ?? "";

  const todayTasks = useMemo(
    () => tasks?.filter((t) => t.due_date === today && t.status !== "done") ?? [],
    [tasks, today]
  );
  const todaySubtasks = useMemo(
    () => subtasks?.filter((s) => s.due_date === today && s.status !== "done") ?? [],
    [subtasks, today]
  );

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.today}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {todayTasks.map((task) => (
          <Link key={`t-${task.id}`} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1 -mx-2">
            <PriorityDot priority={effectivePriority(task.priority, task.due_date, task.end_date)} />
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
            {task.start_time && <span className="text-xs text-muted ml-auto shrink-0">{task.start_time.slice(0, 5)}</span>}
          </Link>
        ))}
        {todaySubtasks.map((s) => (
          <Link key={`s-${s.id}`} to={`/projects/${s.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1 -mx-2">
            <PriorityDot priority="high" />
            <span className="text-muted text-xs shrink-0">{projectName(s.project_id)}</span>
            <span className="truncate opacity-70">↳ {s.title}</span>
            {s.start_time && <span className="text-xs text-muted ml-auto shrink-0">{s.start_time.slice(0, 5)}</span>}
          </Link>
        ))}
        {todayTasks.length === 0 && todaySubtasks.length === 0 && (
          <div className="text-xs text-muted">{t.nothing_due_today}</div>
        )}
      </div>
    </div>
  );
}

// ── Overdue tasks ──

function OverdueTasks() {
  const { data: tasks } = useAllTasks();
  const { data: subtasks } = useQuery({ queryKey: ["subtasks", "with-due-date"], queryFn: getSubtasksWithDueDate });
  const { data: projects } = useProjects();
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);

  const projectName = (projectId: number) => projects?.find((p) => p.id === projectId)?.name ?? "";

  const overdueTasks = useMemo(
    () => tasks?.filter((t) => t.due_date && t.due_date < today && t.status !== "done") ?? [],
    [tasks, today]
  );
  const overdueSubtasks = useMemo(
    () => subtasks?.filter((s) => s.due_date && s.due_date < today && s.status !== "done") ?? [],
    [subtasks, today]
  );

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3 text-danger">{t.overdue}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {overdueTasks.map((task) => (
          <Link key={`t-${task.id}`} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1 -mx-2">
            <PriorityDot priority="high" />
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
            <span className="text-xs text-danger ml-auto shrink-0">{task.due_date}</span>
          </Link>
        ))}
        {overdueSubtasks.map((s) => (
          <Link key={`s-${s.id}`} to={`/projects/${s.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1 -mx-2">
            <PriorityDot priority="high" />
            <span className="text-muted text-xs shrink-0">{projectName(s.project_id)}</span>
            <span className="truncate opacity-70">↳ {s.title}</span>
            <span className="text-xs text-danger ml-auto shrink-0">{s.due_date}</span>
          </Link>
        ))}
        {overdueTasks.length === 0 && overdueSubtasks.length === 0 && (
          <div className="text-xs text-muted">{t.no_overdue_items}</div>
        )}
      </div>
    </div>
  );
}

// ── Project progress ──

function ProjectProgress() {
  const { data: projects } = useProjects();
  const { data: tasks } = useAllTasks();
  const t = useT();

  // NOTE: Progress is task-level only. Subtask progress is not included here
  // because subtask data is not loaded in the global task query. For accurate
  // weighted progress (tasks + subtasks), a dedicated query would be needed.
  const activeProjects = useMemo(() => {
    if (!projects) return [];
    return projects
      .filter((p) => p.status === "active")
      .map((p) => {
        const projectTasks = tasks?.filter((t) => t.project_id === p.id) ?? [];
        const total = projectTasks.length;
        const done = projectTasks.filter((t) => t.status === "done").length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return { ...p, total, done, pct };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 8);
  }, [projects, tasks]);

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.progress}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-3">
        {activeProjects.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="block hover:bg-[var(--color-hover-row)] rounded px-2 py-1 -mx-2">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="truncate">{p.name}</span>
              <span className="text-xs text-muted shrink-0 ml-2">{p.done}/{p.total}</span>
            </div>
            <div className="w-full bg-[var(--color-input-bg)] rounded-full h-1.5">
              <div
                className="bg-accent rounded-full h-1.5 transition-all"
                style={{ width: `${p.pct}%` }}
              />
            </div>
          </Link>
        ))}
        {activeProjects.length === 0 && (
          <div className="text-xs text-muted">{t.no_projects}</div>
        )}
      </div>
    </div>
  );
}

// ── Upcoming deadlines ──

function UpcomingDeadlines() {
  const { data: tasks } = useAllTasks();
  const { data: projects } = useProjects();
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);

  const projectName = (projectId: number) => projects?.find((p) => p.id === projectId)?.name ?? "";

  const upcoming = useMemo(() => {
    if (!tasks) return [];
    return tasks
      .filter((t) => t.due_date && t.due_date >= today && t.status !== "done")
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
      .slice(0, 8);
  }, [tasks, today]);

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.deadline}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {upcoming.map((task) => (
          <Link key={task.id} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1 -mx-2">
            <PriorityDot priority={effectivePriority(task.priority, task.due_date, task.end_date)} />
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
            <span className="text-xs text-muted ml-auto shrink-0">{task.due_date}</span>
          </Link>
        ))}
        {upcoming.length === 0 && (
          <div className="text-xs text-muted">{t.nothing_due_today}</div>
        )}
      </div>
    </div>
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

function RevenueByActivity() {
  const year = new Date().getFullYear();
  const { data: rows } = useRevenueByActivity(year);
  const t = useT();

  const total = rows?.reduce((s, r) => s + r.total, 0) ?? 0;

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.revenue_by_activity}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2">
        {rows?.map((r, i) => {
          const pct = total > 0 ? Math.round((r.total / total) * 100) : 0;
          return (
            <div key={r.label}>
              <div className="flex items-center justify-between text-sm mb-0.5">
                <span className="truncate">{r.label}</span>
                <span className="text-xs text-muted shrink-0 ml-2">{formatCHF(r.total)} ({pct}%)</span>
              </div>
              <div className="w-full bg-[var(--color-input-bg)] rounded-full h-1.5">
                <div className="rounded-full h-1.5 transition-all" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
              </div>
            </div>
          );
        })}
        {(!rows || rows.length === 0) && <div className="text-xs text-muted">{t.no_invoices_yet}</div>}
      </div>
    </div>
  );
}

// ── Revenue by client ──

function RevenueByClient() {
  const year = new Date().getFullYear();
  const { data: rows } = useRevenueByClient(year);
  const t = useT();

  const total = rows?.reduce((s, r) => s + r.total, 0) ?? 0;

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.revenue_by_client}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2">
        {rows?.map((r, i) => {
          const pct = total > 0 ? Math.round((r.total / total) * 100) : 0;
          return (
            <div key={r.label}>
              <div className="flex items-center justify-between text-sm mb-0.5">
                <span className="truncate">{r.label}</span>
                <span className="text-xs text-muted shrink-0 ml-2">{formatCHF(r.total)} ({pct}%)</span>
              </div>
              <div className="w-full bg-[var(--color-input-bg)] rounded-full h-1.5">
                <div className="rounded-full h-1.5 transition-all" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
              </div>
            </div>
          );
        })}
        {(!rows || rows.length === 0) && <div className="text-xs text-muted">{t.no_invoices_yet}</div>}
      </div>
    </div>
  );
}

// ── This week events ──

function ThisWeekEvents() {
  const { data: tasks } = useAllTasks();
  const { data: projects } = useProjects();
  const t = useT();

  const projectName = (projectId: number) => projects?.find((p) => p.id === projectId)?.name ?? "";

  const weekEvents = useMemo(() => {
    if (!tasks) return [];
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const monStr = monday.toISOString().slice(0, 10);
    const sunStr = sunday.toISOString().slice(0, 10);

    return tasks
      .filter((t) => t.due_date && t.due_date >= monStr && t.due_date <= sunStr && t.status !== "done")
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "") || (a.start_time ?? "").localeCompare(b.start_time ?? ""));
  }, [tasks]);

  const dayLabel = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  };

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.this_week}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {weekEvents.map((task) => (
          <Link key={task.id} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1 -mx-2">
            <PriorityDot priority={effectivePriority(task.priority, task.due_date, task.end_date)} />
            <span className="text-muted text-xs shrink-0">{dayLabel(task.due_date!)}</span>
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
            {task.start_time && <span className="text-xs text-muted ml-auto shrink-0">{task.start_time.slice(0, 5)}</span>}
          </Link>
        ))}
        {weekEvents.length === 0 && <div className="text-xs text-muted">{t.nothing_due_today}</div>}
      </div>
    </div>
  );
}

// ── Phase 18: Unpaid invoices ──

function UnpaidInvoices() {
  const { data: invoices } = useInvoices();
  const { data: clients } = useClients();
  const t = useT();

  const clientsMap = useMemo(() => new Map(clients?.map((c) => [c.id, c.name]) ?? []), [clients]);
  const clientName = (clientId: string) => clientsMap.get(clientId) ?? "";

  const unpaid = useMemo(() => {
    if (!invoices) return [];
    return invoices
      .filter((inv) => inv.status === "sent" || inv.status === "overdue")
      .map((inv) => {
        const daysOut = Math.floor((Date.now() - new Date(inv.invoice_date).getTime()) / 86400000);
        return { ...inv, daysOut };
      })
      .sort((a, b) => b.daysOut - a.daysOut);
  }, [invoices]);

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.unpaid_invoices}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2">
        {unpaid.map((inv) => (
          <Link key={inv.id} to={`/invoices/${inv.id}/edit`} className="flex justify-between items-center text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1.5 -mx-2">
            <div className="min-w-0 flex-1">
              <span className="font-medium">{inv.reference}</span>
              <StatusDot status={inv.status} />
              {clientName(inv.client_id) && <span className="text-xs text-muted ml-2">{clientName(inv.client_id)}</span>}
            </div>
            <div className="text-right shrink-0 ml-2">
              <div className="text-muted text-xs">{inv.daysOut} {t.days_outstanding}</div>
              <div className="text-sm">CHF {inv.total.toFixed(2)}</div>
            </div>
          </Link>
        ))}
        {unpaid.length === 0 && <div className="text-xs text-muted">{t.no_data}</div>}
      </div>
    </div>
  );
}

// ── Phase 18: Expense breakdown (pie chart) ──

function ExpenseBreakdown() {
  const { data: expenses } = useExpenses();
  const { data: categories } = useQuery({ queryKey: ["expense-categories-all"], queryFn: async () => {
    const { getDb } = await import("../../db");
    const db = await getDb();
    return db.select<{ code: string; name_en: string; name_fr: string }[]>("SELECT code, name_en, name_fr FROM expense_categories");
  }});
  const chart = useChartTheme();
  const t = useT();
  const year = new Date().getFullYear();

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
        return { name: cat?.name_en ?? code, value: total };
      })
      .sort((a, b) => b.value - a.value);
  }, [expenses, categories, year]);

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.expense_breakdown} {year}</h2>
      <div className="flex-1 min-h-0">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="80%" innerRadius="40%" paddingAngle={2}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(value) => [`CHF ${Number(value).toFixed(2)}`, ""]} contentStyle={chart.tooltipStyle} itemStyle={chart.pieItemStyle} labelStyle={{ color: "var(--color-text)" }} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-xs text-muted">{t.no_data}</div>
        )}
      </div>
    </div>
  );
}

// ── Phase 18: Monthly comparison ──

function MonthlyComparison() {
  const year = new Date().getFullYear();
  const month = new Date().getMonth();
  const { data: currentYearData } = useMonthlyData(year);
  const { data: lastYearData } = useMonthlyData(year - 1);
  const t = useT();

  const currentRev = currentYearData?.[month]?.revenue ?? 0;
  const lastRev = lastYearData?.[month]?.revenue ?? 0;
  const diff = lastRev > 0 ? Math.round(((currentRev - lastRev) / lastRev) * 100) : 0;

  return (
    <div className="h-full flex flex-col justify-center px-4">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{t.monthly_comparison}</div>
      <div className="text-lg font-semibold">{formatCHF(currentRev)}</div>
      <div className="text-xs text-muted mt-1">
        {lastRev > 0 ? (
          <span className={diff >= 0 ? "text-success" : "text-danger"}>
            {diff >= 0 ? "+" : ""}{diff}% {t.vs_last_year}
          </span>
        ) : (
          <span>{t.vs_last_year}: {t.no_data}</span>
        )}
      </div>
    </div>
  );
}

// ── Phase 18: Profit margin ──

function ProfitMargin() {
  const year = new Date().getFullYear();
  const { data: kpis } = useDashboardKPIs(year);
  const t = useT();

  const revenue = kpis?.total_invoiced ?? 0;
  const net = kpis?.net_result ?? 0;
  const margin = revenue > 0 ? Math.round((net / revenue) * 100) : 0;

  return (
    <div className="h-full flex flex-col justify-center px-4">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{t.profit_margin}</div>
      <div className={`text-lg font-semibold ${margin < 0 ? "text-danger" : margin < 20 ? "text-warning" : "text-success"}`}>
        {margin}%
      </div>
      <div className="text-xs text-muted mt-1">{formatCHF(net)} / {formatCHF(revenue)}</div>
    </div>
  );
}

// ── Phase 18: Top client ──

function TopClient() {
  const year = new Date().getFullYear();
  const { data: rows } = useRevenueByClient(year);
  const t = useT();

  const top = rows?.[0];

  return (
    <div className="h-full flex flex-col justify-center px-4">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{t.top_client}</div>
      {top ? (
        <>
          <div className="text-lg font-semibold truncate">{top.label}</div>
          <div className="text-xs text-muted mt-1">{formatCHF(top.total)}</div>
        </>
      ) : (
        <div className="text-sm text-muted">{t.no_data}</div>
      )}
    </div>
  );
}

// ── Phase 18: Average invoice value ──

function AverageInvoiceValue() {
  const { data: invoices } = useInvoices();
  const t = useT();
  const year = new Date().getFullYear();

  const avg = useMemo(() => {
    if (!invoices) return 0;
    const yearInvoices = invoices.filter((i) => i.status !== "cancelled" && i.invoice_date.startsWith(String(year)));
    if (yearInvoices.length === 0) return 0;
    return yearInvoices.reduce((s, i) => s + i.total, 0) / yearInvoices.length;
  }, [invoices, year]);

  return <KPIWidget label={t.avg_invoice_value} value={formatCHF(avg)} />;
}

// ── Phase 18: Quote conversion rate ──

function QuoteConversionRate() {
  const { data: quotes } = useQuotes();
  const t = useT();

  const { rate, converted, total } = useMemo(() => {
    if (!quotes || quotes.length === 0) return { rate: 0, converted: 0, total: 0 };
    const converted = quotes.filter((q) => q.converted_to_invoice_id != null).length;
    return { rate: Math.round((converted / quotes.length) * 100), converted, total: quotes.length };
  }, [quotes]);

  return (
    <div className="h-full flex flex-col justify-center px-4">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{t.quote_conversion_rate}</div>
      <div className="text-lg font-semibold">{rate}%</div>
      <div className="text-xs text-muted mt-1">{converted}/{total} {t.of_quotes_converted}</div>
    </div>
  );
}

// ── Phase 18: Client activity ──

function ClientActivity() {
  const { data: clients } = useClients();
  const { data: invoices } = useInvoices();
  const t = useT();

  const { active, dormant } = useMemo(() => {
    if (!clients || !invoices) return { active: [], dormant: [] };
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cutoff = threeMonthsAgo.toISOString().slice(0, 10);

    const lastInvoice: Record<string, string> = {};
    for (const inv of invoices) {
      if (!lastInvoice[inv.client_id] || inv.invoice_date > lastInvoice[inv.client_id]) {
        lastInvoice[inv.client_id] = inv.invoice_date;
      }
    }

    const active: { name: string; lastDate: string }[] = [];
    const dormant: { name: string; lastDate: string }[] = [];
    for (const c of clients) {
      const last = lastInvoice[c.id];
      if (!last || last < cutoff) {
        dormant.push({ name: c.name, lastDate: last ?? "" });
      } else {
        active.push({ name: c.name, lastDate: last });
      }
    }
    return { active: active.sort((a, b) => b.lastDate.localeCompare(a.lastDate)), dormant };
  }, [clients, invoices]);

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.client_activity}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {active.slice(0, 5).map((c) => (
          <div key={c.name} className="flex items-center justify-between text-sm px-2 py-1 -mx-2">
            <span className="truncate">{c.name}</span>
            <span className="text-xs text-success shrink-0 ml-2">{t.active_clients}</span>
          </div>
        ))}
        {dormant.map((c) => (
          <div key={c.name} className="flex items-center justify-between text-sm px-2 py-1 -mx-2 opacity-60">
            <span className="truncate">{c.name}</span>
            <span className="text-xs text-warning shrink-0 ml-2">{t.dormant}</span>
          </div>
        ))}
        {active.length === 0 && dormant.length === 0 && <div className="text-xs text-muted">{t.no_data}</div>}
      </div>
    </div>
  );
}

// ── Phase 18: New clients this year ──

function NewClientsYear() {
  const { data: clients } = useClients();
  const t = useT();
  const year = new Date().getFullYear();

  const count = useMemo(() => {
    if (!clients) return 0;
    return clients.filter((c) => c.created_at?.startsWith(String(year))).length;
  }, [clients, year]);

  return (
    <div className="h-full flex flex-col justify-center px-4">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{t.new_clients_year}</div>
      <div className="text-lg font-semibold">{count}</div>
      <div className="text-xs text-muted mt-1">{t.new_this_year}</div>
    </div>
  );
}

// ── Phase 18: Stale tasks ──

function StaleTasks() {
  const { data: tasks } = useAllTasks();
  const { data: projects } = useProjects();
  const t = useT();

  const projectName = (projectId: number) => projects?.find((p) => p.id === projectId)?.name ?? "";

  const stale = useMemo(() => {
    if (!tasks) return [];
    const now = Date.now();
    return tasks
      .filter((task) => task.status !== "done")
      .map((task) => {
        const lastUpdate = new Date(task.updated_at).getTime();
        const daysInactive = Math.floor((now - lastUpdate) / 86400000);
        return { ...task, daysInactive };
      })
      .filter((t) => t.daysInactive >= 7)
      .sort((a, b) => b.daysInactive - a.daysInactive)
      .slice(0, 10);
  }, [tasks]);

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3 text-warning">{t.stale_tasks}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {stale.map((task) => (
          <Link key={task.id} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1 -mx-2">
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
            <span className="text-xs text-warning ml-auto shrink-0">{task.daysInactive}{t.days_inactive}</span>
          </Link>
        ))}
        {stale.length === 0 && <div className="text-xs text-muted">{t.no_stale_tasks}</div>}
      </div>
    </div>
  );
}

// ── Phase 18: Projects without deadline ──

function ProjectsWithoutDeadline() {
  const { data: projects } = useProjects();
  const { data: tasks } = useAllTasks();
  const t = useT();

  const noDeadline = useMemo(() => {
    if (!projects || !tasks) return [];
    return projects
      .filter((p) => p.status === "active")
      .filter((p) => {
        const projectTasks = tasks.filter((t) => t.project_id === p.id);
        return projectTasks.length > 0 && !projectTasks.some((t) => t.due_date);
      });
  }, [projects, tasks]);

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.projects_no_deadline}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {noDeadline.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1 -mx-2">
            <span className="truncate">{p.name}</span>
          </Link>
        ))}
        {noDeadline.length === 0 && <div className="text-xs text-muted">{t.no_data}</div>}
      </div>
    </div>
  );
}

// ── Phase 18: Free days this week ──

function FreeDaysWeek() {
  const { data: tasks } = useAllTasks();
  const t = useT();

  const freeDays = useMemo(() => {
    if (!tasks) return 0;
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));

    let free = 0;
    for (let i = 0; i < 5; i++) { // Mon-Fri
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const hasTasks = tasks.some((t) => t.due_date === dateStr && t.status !== "done");
      if (!hasTasks) free++;
    }
    return free;
  }, [tasks]);

  return (
    <div className="h-full flex flex-col justify-center px-4">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{t.free_days_week}</div>
      <div className="text-lg font-semibold">{freeDays}/5</div>
      <div className="text-xs text-muted mt-1">{t.free}</div>
    </div>
  );
}

// ── Phase 18: Upcoming reminders (invoices near payment deadline) ──

function UpcomingReminders() {
  const { data: invoices } = useInvoices();
  const { data: clients } = useClients();
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);

  const clientsMap = useMemo(() => new Map(clients?.map((c) => [c.id, c.name]) ?? []), [clients]);
  const clientName = (clientId: string) => clientsMap.get(clientId) ?? "";

  const upcoming = useMemo(() => {
    if (!invoices) return [];
    return invoices
      .filter((inv) => inv.status === "sent" && inv.due_date && inv.due_date >= today)
      .map((inv) => {
        const daysLeft = Math.floor((new Date(inv.due_date!).getTime() - Date.now()) / 86400000);
        return { ...inv, daysLeft };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 8);
  }, [invoices, today]);

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.upcoming_reminders}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2">
        {upcoming.map((inv) => (
          <Link key={inv.id} to={`/invoices/${inv.id}/edit`} className="flex justify-between items-center text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1.5 -mx-2">
            <div className="min-w-0 flex-1">
              <span className="font-medium">{inv.reference}</span>
              <span className="text-xs text-muted ml-2">{clientName(inv.client_id)}</span>
            </div>
            <span className={`text-xs shrink-0 ml-2 ${inv.daysLeft <= 3 ? "text-danger" : inv.daysLeft <= 7 ? "text-warning" : "text-muted"}`}>
              {inv.daysLeft} {t.days_outstanding}
            </span>
          </Link>
        ))}
        {upcoming.length === 0 && <div className="text-xs text-muted">{t.no_data}</div>}
      </div>
    </div>
  );
}

// ── Phase 18: Recently completed ──

function RecentlyCompleted() {
  const { data: tasks } = useAllTasks();
  const { data: projects } = useProjects();
  const t = useT();

  const projectName = (projectId: number) => projects?.find((p) => p.id === projectId)?.name ?? "";

  const completed = useMemo(() => {
    if (!tasks) return [];
    return tasks
      .filter((task) => task.status === "done")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 10);
  }, [tasks]);

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.recently_completed}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {completed.map((task) => (
          <Link key={task.id} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1 -mx-2">
            <span className="text-success text-xs shrink-0">&#10003;</span>
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
          </Link>
        ))}
        {completed.length === 0 && <div className="text-xs text-muted">{t.no_data}</div>}
      </div>
    </div>
  );
}

// ── Phase 18: Stale projects ──

function StaleProjects() {
  const { data: projects } = useProjects();
  const { data: tasks } = useAllTasks();
  const t = useT();

  const stale = useMemo(() => {
    if (!projects || !tasks) return [];
    const now = Date.now();
    return projects
      .filter((p) => p.status === "active")
      .map((p) => {
        const projectTasks = tasks.filter((task) => task.project_id === p.id);
        if (projectTasks.length === 0) return { ...p, daysInactive: 999 };
        const latestUpdate = Math.max(...projectTasks.map((t) => new Date(t.updated_at).getTime()));
        return { ...p, daysInactive: Math.floor((now - latestUpdate) / 86400000) };
      })
      .filter((p) => p.daysInactive >= 14)
      .sort((a, b) => b.daysInactive - a.daysInactive);
  }, [projects, tasks]);

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3 text-warning">{t.stale_projects}</h2>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {stale.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between text-sm hover:bg-[var(--color-hover-row)] rounded px-2 py-1 -mx-2">
            <span className="truncate">{p.name}</span>
            <span className="text-xs text-warning shrink-0 ml-2">{p.daysInactive}{t.days_inactive}</span>
          </Link>
        ))}
        {stale.length === 0 && <div className="text-xs text-muted">{t.no_stale_projects}</div>}
      </div>
    </div>
  );
}

// ── Phase 18: Weekly streak ──

function WeeklyStreak() {
  const { data: tasks } = useAllTasks();
  const t = useT();

  const streak = useMemo(() => {
    if (!tasks) return 0;
    const doneTasks = tasks.filter((t) => t.status === "done").map((t) => t.updated_at);
    if (doneTasks.length === 0) return 0;

    // Group by ISO week
    const weeks = new Set<string>();
    for (const dateStr of doneTasks) {
      const d = new Date(dateStr);
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
      weeks.add(`${d.getFullYear()}-W${weekNum}`);
    }

    // Count consecutive weeks back from current
    const now = new Date();
    let count = 0;
    for (let i = 0; i < 52; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
      if (weeks.has(`${d.getFullYear()}-W${weekNum}`)) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }, [tasks]);

  return (
    <div className="h-full flex flex-col justify-center px-4">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{t.weekly_streak}</div>
      <div className="text-lg font-semibold">{streak}</div>
      <div className="text-xs text-muted mt-1">{t.weeks}</div>
    </div>
  );
}

// ── Phase 18: Busiest day of week ──

const DAY_NAMES_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function BusiestDay() {
  const { data: tasks } = useAllTasks();
  const chart = useChartTheme();
  const t = useT();

  const data = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0]; // Mon(0)-Sun(6)
    if (!tasks) return DAY_NAMES_MON.map((name) => ({ name, count: 0 }));
    for (const task of tasks) {
      if (task.due_date) {
        const jsDay = new Date(task.due_date + "T00:00:00").getDay(); // 0=Sun
        const monIdx = (jsDay + 6) % 7; // Mon=0, Tue=1, ... Sun=6
        counts[monIdx]++;
      }
    }
    return DAY_NAMES_MON.map((name, i) => ({ name, count: counts[i] }));
  }, [tasks]);

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.busiest_day}</h2>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.gridStroke} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: chart.tickFill }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: chart.tickFill }} width={25} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={chart.tooltipStyle} />
            <Bar dataKey="count" fill="var(--color-accent)" radius={[4, 4, 0, 0]} name={t.tasks_due} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Phase 18: Quick create ──

function QuickCreate() {
  const navigate = useNavigate();
  const t = useT();

  const items = [
    { label: t.new_invoice, icon: <FileText size={16} />, to: "/invoices/new" },
    { label: t.new_quote, icon: <ClipboardList size={16} />, to: "/quotes/new" },
    { label: t.new_expense, icon: <Receipt size={16} />, to: "/expenses" },
    { label: t.new_project, icon: <FolderPlus size={16} />, to: "/projects" },
  ];

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-3">{t.quick_create}</h2>
      <div className="flex-1 grid grid-cols-2 gap-2 content-start">
        {items.map((item) => (
          <button
            key={item.to}
            type="button"
            onClick={() => navigate(item.to)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-[var(--color-input-bg)] hover:bg-[var(--color-hover-row)] transition-colors"
          >
            <span className="text-muted">{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Phase 18: Pinned notes ──

function PinnedNotes() {
  const { pinnedNotes, setPinnedNotes } = useDashboardStore();
  const t = useT();
  const [local, setLocal] = useState(pinnedNotes);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { setLocal(pinnedNotes); }, [pinnedNotes]);

  const handleChange = (value: string) => {
    setLocal(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setPinnedNotes(value), 500);
  };

  return (
    <div className="h-full flex flex-col p-4">
      <h2 className="text-sm font-medium mb-2">{t.pinned_notes}</h2>
      <textarea
        className="flex-1 w-full resize-none text-sm bg-[var(--color-input-bg)] rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-accent cursor-text"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        placeholder={t.notes}
      />
    </div>
  );
}

// ── Phase 13: Time tracking widgets ──

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtHours(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

function TimeThisWeek() {
  const t = useT();
  const chart = useChartTheme();
  const { data } = useQuery({ queryKey: ["time-this-week"], queryFn: getTimeThisWeek });
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const now = new Date();
    const dayOfWeek = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(monday.getDate() - dayOfWeek + 1);
    return WEEKDAYS.map((label, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const entry = data.find((e) => e.day === iso);
      return { day: label, minutes: entry?.minutes ?? 0 };
    });
  }, [data]);

  const totalMin = chartData.reduce((s, d) => s + d.minutes, 0);

  if (!data || data.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm text-muted">{t.no_time_data}</div>;
  }

  return (
    <div className="h-full flex flex-col p-3">
      <div className="text-xs text-muted mb-1">{t.time_this_week}</div>
      <div className="text-lg font-semibold mb-2">{fmtHours(totalMin)}</div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.gridStroke} vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: chart.tickFill }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: chart.tickFill }} tickFormatter={(v) => fmtHours(Number(v))} axisLine={false} tickLine={false} />
            <Tooltip formatter={(value) => fmtHours(Number(value ?? 0))} contentStyle={chart.tooltipStyle} cursor={{ fill: chart.cursorFill }} />
            <Bar dataKey="minutes" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PlannedVsActual() {
  const t = useT();
  const chart = useChartTheme();
  const { data } = useQuery({ queryKey: ["planned-vs-actual"], queryFn: getPlannedVsActual });

  if (!data || data.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm text-muted">{t.no_time_data}</div>;
  }

  const chartData = data.map((d) => ({
    name: d.project_name.length > 15 ? d.project_name.slice(0, 14) + "..." : d.project_name,
    [t.planned]: Math.round(d.planned / 60 * 10) / 10,
    [t.tracked]: Math.round(d.tracked / 60 * 10) / 10,
  }));

  return (
    <div className="h-full flex flex-col p-3">
      <div className="text-xs text-muted mb-2">{t.planned_vs_actual}</div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={chart.gridStroke} vertical={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: chart.tickFill }} unit="h" axisLine={false} tickLine={false} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: chart.tickFill }} width={90} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={chart.tooltipStyle} cursor={{ fill: chart.cursorFill }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey={t.planned} fill="var(--color-chart-3)" radius={[0, 4, 4, 0]} />
            <Bar dataKey={t.tracked} fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TopTimeConsumers() {
  const t = useT();
  const { data } = useQuery({ queryKey: ["top-time-consumers"], queryFn: () => getTopTimeConsumers(8) });

  if (!data || data.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm text-muted">{t.no_time_data}</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="text-xs text-muted mb-2">{t.top_time_consumers}</div>
      <div className="space-y-1.5">
        {data.map((task) => (
          <div key={task.id} className="flex items-center justify-between text-sm">
            <div className="truncate flex-1 mr-2">
              <span>{task.title}</span>
              <span className="text-xs text-muted ml-1">({task.project_name})</span>
            </div>
            <span className="text-xs font-medium shrink-0">{fmtHours(task.tracked_minutes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BillableSummary() {
  const t = useT();
  const { data } = useQuery({ queryKey: ["billable-summary"], queryFn: getBillableSummary });
  const totalHours = Math.round((data?.total_minutes ?? 0) / 60 * 10) / 10;
  const animated = useCountUp(totalHours);

  return (
    <div className="h-full flex flex-col justify-center px-4">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{t.billable_summary}</div>
      <div className="text-lg font-semibold">{animated.toFixed(1)}h</div>
      <div className="text-xs text-muted">{t.tracked}</div>
    </div>
  );
}

function WeeklyTrendWidget() {
  const t = useT();
  const chart = useChartTheme();
  const { data } = useQuery({ queryKey: ["weekly-trend"], queryFn: getWeeklyTrend });

  if (!data || data.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm text-muted">{t.no_time_data}</div>;
  }

  const chartData = data.map((d) => ({
    week: d.week,
    hours: Math.round(d.minutes / 60 * 10) / 10,
  }));

  return (
    <div className="h-full flex flex-col p-3">
      <div className="text-xs text-muted mb-2">{t.weekly_trend}</div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.gridStroke} vertical={false} />
            <XAxis dataKey="week" tick={{ fontSize: 10, fill: chart.tickFill }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: chart.tickFill }} unit="h" axisLine={false} tickLine={false} />
            <Tooltip formatter={(value) => `${value}h`} contentStyle={chart.tooltipStyle} cursor={{ fill: chart.cursorFill }} />
            <Line type="monotone" dataKey="hours" stroke="var(--color-chart-1)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const PIE_COLORS = [
  "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)",
  "var(--color-chart-5)", "var(--color-chart-6)", "var(--color-chart-7)", "var(--color-chart-8)",
];

function ProjectTimeDistribution() {
  const t = useT();
  const chart = useChartTheme();
  const { data } = useQuery({ queryKey: ["project-time-distribution"], queryFn: getProjectTimeDistribution });

  if (!data || data.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm text-muted">{t.no_time_data}</div>;
  }

  const chartData = data.map((d) => ({
    name: d.project_name,
    value: d.minutes,
  }));

  return (
    <div className="h-full flex flex-col p-3">
      <div className="text-xs text-muted mb-2">{t.project_time_distribution}</div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius="70%"
              label={({ name, percent, x, y, textAnchor }) => {
                const n = String(name ?? "");
                const label = `${n.length > 12 ? n.slice(0, 11) + "…" : n} ${((percent ?? 0) * 100).toFixed(0)}%`;
                return <text x={x} y={y} textAnchor={textAnchor} fill="var(--color-text)" fontSize={12}>{label}</text>;
              }}
              labelLine
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => fmtHours(Number(value ?? 0))} contentStyle={chart.tooltipStyle} itemStyle={chart.pieItemStyle} labelStyle={{ color: "var(--color-text)" }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Widget renderer ──

export function renderWidget(type: WidgetType) {
  switch (type) {
    case "kpi-invoiced": return <KPIInvoiced />;
    case "kpi-balance": return <KPIBalance />;
    case "kpi-expenses": return <KPIExpenses />;
    case "kpi-net": return <KPINet />;
    case "chart-revenue": return <ChartRevenue />;
    case "recent-invoices": return <RecentInvoices />;
    case "today-tasks": return <TodayTasks />;
    case "overdue-tasks": return <OverdueTasks />;
    case "project-progress": return <ProjectProgress />;
    case "upcoming-deadlines": return <UpcomingDeadlines />;
    case "revenue-by-activity": return <RevenueByActivity />;
    case "revenue-by-client": return <RevenueByClient />;
    case "this-week-events": return <ThisWeekEvents />;
    // Phase 18
    case "unpaid-invoices": return <UnpaidInvoices />;
    case "expense-breakdown": return <ExpenseBreakdown />;
    case "monthly-comparison": return <MonthlyComparison />;
    case "profit-margin": return <ProfitMargin />;
    case "top-client": return <TopClient />;
    case "average-invoice-value": return <AverageInvoiceValue />;
    case "quote-conversion-rate": return <QuoteConversionRate />;
    case "client-activity": return <ClientActivity />;
    case "new-clients-year": return <NewClientsYear />;
    case "stale-tasks": return <StaleTasks />;
    case "projects-without-deadline": return <ProjectsWithoutDeadline />;
    case "free-days-week": return <FreeDaysWeek />;
    case "upcoming-reminders": return <UpcomingReminders />;
    case "recently-completed": return <RecentlyCompleted />;
    case "stale-projects": return <StaleProjects />;
    case "weekly-streak": return <WeeklyStreak />;
    case "busiest-day": return <BusiestDay />;
    case "quick-create": return <QuickCreate />;
    case "pinned-notes": return <PinnedNotes />;
    // Phase 13 — Time tracking
    case "time-this-week": return <TimeThisWeek />;
    case "planned-vs-actual": return <PlannedVsActual />;
    case "top-time-consumers": return <TopTimeConsumers />;
    case "billable-summary": return <BillableSummary />;
    case "weekly-trend": return <WeeklyTrendWidget />;
    case "project-time-distribution": return <ProjectTimeDistribution />;
    default: return <div className="p-4 text-muted text-sm">Unknown widget</div>;
  }
}
