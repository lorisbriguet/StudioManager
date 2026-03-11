import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useDashboardKPIs, useMonthlyData } from "../db/hooks/useFinance";
import { useProjects } from "../db/hooks/useProjects";
import { useAllTasks } from "../db/hooks/useTasks";
import { useInvoices } from "../db/hooks/useInvoices";
import { getSubtasksWithDueDate } from "../db/queries/tasks";
import { useAppStore } from "../stores/app-store";
import { effectivePriority } from "../types/task";
import { useT } from "../i18n/useT";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function DashboardPage() {
  const currentYear = new Date().getFullYear();
  const { data: kpis, isLoading } = useDashboardKPIs(currentYear);
  const { data: monthly } = useMonthlyData(currentYear);
  const { data: projects } = useProjects();
  const { data: tasks } = useAllTasks();
  const { data: subtasks } = useQuery({ queryKey: ["subtasks", "with-due-date"], queryFn: getSubtasksWithDueDate });
  const { data: invoices } = useInvoices();
  const dark = useAppStore((s) => s.darkMode);
  const t = useT();

  const today = new Date().toISOString().slice(0, 10);

  const projectName = (projectId: number) =>
    projects?.find((p) => p.id === projectId)?.name ?? "";

  const todayTasks = useMemo(
    () => tasks?.filter((t) => t.due_date === today && t.status !== "done") ?? [],
    [tasks, today]
  );
  const overdueTasks = useMemo(
    () => tasks?.filter((t) => t.due_date && t.due_date < today && t.status !== "done") ?? [],
    [tasks, today]
  );
  const todaySubtasks = useMemo(
    () => subtasks?.filter((s) => s.due_date === today && s.status !== "done") ?? [],
    [subtasks, today]
  );
  const overdueSubtasks = useMemo(
    () => subtasks?.filter((s) => s.due_date && s.due_date < today && s.status !== "done") ?? [],
    [subtasks, today]
  );

  const recentInvoices = useMemo(() => {
    if (!invoices) return [];
    const priorityOrder: Record<string, number> = { overdue: 0, sent: 1, draft: 2, paid: 3, cancelled: 4 };
    return [...invoices]
      .sort((a, b) => (priorityOrder[a.status] ?? 9) - (priorityOrder[b.status] ?? 9))
      .slice(0, 5);
  }, [invoices]);

  if (isLoading) {
    return <div className="text-muted text-sm">{t.loading}</div>;
  }

  const chartData = monthly?.map((m, i) => ({
    name: MONTHS[i],
    revenue: m.revenue,
    expenses: m.expenses,
  })) ?? [];

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">{t.dashboard}</h1>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <KPICard label={t.total_invoiced} value={formatCHF(kpis?.total_invoiced ?? 0)} />
        <KPICard label={t.open_balance} value={formatCHF(kpis?.open_balance ?? 0)} accent={!!kpis?.open_balance} />
        <KPICard label={t.total_expenses} value={formatCHF(kpis?.total_expenses ?? 0)} />
        <KPICard label={t.net_result} value={formatCHF(kpis?.net_result ?? 0)} />
      </div>

      {(todayTasks.length > 0 || todaySubtasks.length > 0 || overdueTasks.length > 0 || overdueSubtasks.length > 0) && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Today */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h2 className="text-sm font-medium mb-3">{t.today}</h2>
            <div className="space-y-1.5">
              {todayTasks.map((t) => (
                <Link key={`t-${t.id}`} to={`/projects/${t.project_id}`} className="flex items-center gap-2 text-sm hover:bg-gray-50 rounded px-2 py-1 -mx-2">
                  <PriorityDot priority={effectivePriority(t.priority, t.due_date)} />
                  <span className="text-muted text-xs shrink-0">{projectName(t.project_id)}</span>
                  <span className="truncate">{t.title}</span>
                  {t.start_time && <span className="text-xs text-muted ml-auto shrink-0">{t.start_time.slice(0, 5)}</span>}
                </Link>
              ))}
              {todaySubtasks.map((s) => (
                <Link key={`s-${s.id}`} to={`/projects/${s.project_id}`} className="flex items-center gap-2 text-sm hover:bg-gray-50 rounded px-2 py-1 -mx-2">
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

          {/* Overdue */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h2 className="text-sm font-medium mb-3 text-danger">{t.overdue}</h2>
            <div className="space-y-1.5">
              {overdueTasks.map((t) => (
                <Link key={`t-${t.id}`} to={`/projects/${t.project_id}`} className="flex items-center gap-2 text-sm hover:bg-gray-50 rounded px-2 py-1 -mx-2">
                  <PriorityDot priority="high" />
                  <span className="text-muted text-xs shrink-0">{projectName(t.project_id)}</span>
                  <span className="truncate">{t.title}</span>
                  <span className="text-xs text-danger ml-auto shrink-0">{t.due_date}</span>
                </Link>
              ))}
              {overdueSubtasks.map((s) => (
                <Link key={`s-${s.id}`} to={`/projects/${s.project_id}`} className="flex items-center gap-2 text-sm hover:bg-gray-50 rounded px-2 py-1 -mx-2">
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
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Revenue chart */}
        <div className="col-span-2 border border-gray-200 rounded-lg p-4">
          <h2 className="text-sm font-medium mb-4">{t.revenue} {currentYear}</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={dark ? "#2d2d2d" : "#f0f0f0"} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: dark ? "#a3a3a3" : undefined }} />
              <YAxis tick={{ fontSize: 11, fill: dark ? "#a3a3a3" : undefined }} />
              <Tooltip
                formatter={(value) => [`CHF ${Number(value ?? 0).toFixed(2)}`, ""]}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid", borderColor: dark ? "#2d2d2d" : "#e5e5e5", backgroundColor: dark ? "#1e1e1e" : "#fff", color: dark ? "#e5e5e5" : undefined }}
                cursor={{ fill: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)" }}
              />
              <Bar dataKey="revenue" fill="#2563eb" radius={[3, 3, 0, 0]} name={t.revenue} />
              <Bar dataKey="expenses" fill="#dc2626" radius={[3, 3, 0, 0]} name={t.expenses} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent invoices */}
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">{t.recent_invoices}</h2>
            <Link to="/invoices" className="text-xs text-accent hover:underline">{t.view_all}</Link>
          </div>
          <div className="space-y-2">
            {recentInvoices.map((inv) => (
              <Link
                key={inv.id}
                to={`/invoices/${inv.id}/edit`}
                className="flex justify-between items-center text-sm hover:bg-gray-50 rounded px-2 py-1.5 -mx-2"
              >
                <div>
                  <span className="font-medium">{inv.reference}</span>
                  <StatusDot status={inv.status} />
                </div>
                <span className="text-muted">CHF {inv.total.toFixed(2)}</span>
              </Link>
            ))}
            {recentInvoices.length === 0 && (
              <div className="text-xs text-muted">{t.no_invoices_yet}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="text-xs text-muted uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-lg font-semibold ${accent ? "text-warning" : ""}`}>{value}</div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "paid" ? "bg-success" : status === "overdue" ? "bg-danger" : "bg-gray-300";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ml-2 ${color}`} />;
}

function PriorityDot({ priority }: { priority: string }) {
  const color = priority === "high" ? "bg-danger" : priority === "medium" ? "bg-yellow-500" : "bg-gray-300";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;
}

function formatCHF(amount: number): string {
  return `CHF ${amount.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
