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
  LineChart,
  Line,
  Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { ICONS } from "../ui/icons";
import { useCountUp } from "../../hooks/useCountUp";
import { StatTile } from "../ui/StatTile";
import { STAT_VALUE } from "../ui/tokens";
import { toLocalISO } from "../../utils/localDate";
import { getPlannedVsActual } from "../../db/queries/tasks";
import {
  getTimeThisWeek,
  getTopTimeConsumers,
  getWeeklyTrend,
  getProjectTimeDistribution,
  getBillableSummary,
} from "../../db/queries/timeEntries";
import { useChartTheme } from "../../hooks/useChartTheme";
import { useT } from "../../i18n/useT";
import { tagHash } from "../../lib/tagColors";
import { WidgetShell, WidgetTitle } from "./WidgetShell";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/Skeleton";
import { qk } from "../../db/queryKeys";
import { KPI_TILE } from "./widgetParts";

// ── Phase 13: Time tracking widgets ──

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtHours(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export function TimeThisWeek() {
  const t = useT();
  const chart = useChartTheme();
  const { data } = useQuery({ queryKey: qk.dashboard.timeThisWeek, queryFn: getTimeThisWeek });
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const now = new Date();
    const dayOfWeek = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(monday.getDate() - dayOfWeek + 1);
    return WEEKDAYS.map((label, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      const iso = toLocalISO(d);
      const entry = data.find((e) => e.day === iso);
      return { day: label, minutes: entry?.minutes ?? 0 };
    });
  }, [data]);

  const totalMin = chartData.reduce((s, d) => s + d.minutes, 0);

  if (!data?.length) return <TimeWidgetState title={t.time_this_week} loading={data === undefined} />;

  return (
    <WidgetShell>
      <WidgetTitle>{t.time_this_week}</WidgetTitle>
      <div className={`${STAT_VALUE} mb-2`}>{fmtHours(totalMin)}</div>
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
    </WidgetShell>
  );
}

/** A time widget before it has data: its title, then a skeleton (loading) or "No tracked time yet". */
function TimeWidgetState({ title, loading }: { title: string; loading: boolean }) {
  const t = useT();
  return (
    <WidgetShell>
      <WidgetTitle>{title}</WidgetTitle>
      {loading ? <ListSkeleton size="sm" rows={3} /> : <EmptyState size="sm" icon={ICONS.time} message={t.no_tracked_time} className="flex-1" />}
    </WidgetShell>
  );
}

export function PlannedVsActual() {
  const t = useT();
  const chart = useChartTheme();
  const { data } = useQuery({ queryKey: qk.dashboard.plannedVsActual, queryFn: getPlannedVsActual });

  if (!data?.length) return <TimeWidgetState title={t.planned_vs_actual} loading={data === undefined} />;

  const chartData = data.map((d) => ({
    name: d.project_name.length > 15 ? d.project_name.slice(0, 14) + "..." : d.project_name,
    [t.planned]: Math.round(d.planned / 60 * 10) / 10,
    [t.tracked]: Math.round(d.tracked / 60 * 10) / 10,
  }));

  return (
    <WidgetShell>
      <WidgetTitle>{t.planned_vs_actual}</WidgetTitle>
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
    </WidgetShell>
  );
}

export function TopTimeConsumers() {
  const t = useT();
  const { data } = useQuery({ queryKey: qk.dashboard.topTimeConsumers, queryFn: () => getTopTimeConsumers(8) });

  if (!data?.length) return <TimeWidgetState title={t.top_time_consumers} loading={data === undefined} />;

  return (
    <WidgetShell>
      <WidgetTitle>{t.top_time_consumers}</WidgetTitle>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
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
    </WidgetShell>
  );
}

export function BillableSummary() {
  const t = useT();
  const { data } = useQuery({ queryKey: qk.dashboard.billableSummary, queryFn: getBillableSummary });
  const totalHours = Math.round((data?.total_minutes ?? 0) / 60 * 10) / 10;
  const animated = useCountUp(totalHours);

  return (
    <StatTile className={KPI_TILE} label={t.billable_summary} value={`${animated.toFixed(1)}h`} caption={t.tracked} />
  );
}

export function WeeklyTrendWidget() {
  const t = useT();
  const chart = useChartTheme();
  const { data } = useQuery({ queryKey: qk.dashboard.weeklyTrend, queryFn: getWeeklyTrend });

  if (!data?.length) return <TimeWidgetState title={t.weekly_trend} loading={data === undefined} />;

  const chartData = data.map((d) => ({
    week: d.week,
    hours: Math.round(d.minutes / 60 * 10) / 10,
  }));

  return (
    <WidgetShell>
      <WidgetTitle>{t.weekly_trend}</WidgetTitle>
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
    </WidgetShell>
  );
}

const PIE_COLORS = [
  "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)",
  "var(--color-chart-5)", "var(--color-chart-6)", "var(--color-chart-7)", "var(--color-chart-8)",
];

export function ProjectTimeDistribution() {
  const t = useT();
  const chart = useChartTheme();
  const { data } = useQuery({ queryKey: qk.dashboard.projectTimeDistribution, queryFn: getProjectTimeDistribution });

  if (!data?.length) return <TimeWidgetState title={t.project_time_distribution} loading={data === undefined} />;

  const chartData = data.map((d) => ({
    name: d.project_name,
    value: d.minutes,
  }));

  return (
    <WidgetShell>
      <WidgetTitle>{t.project_time_distribution}</WidgetTitle>
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
              {/* Hash the project name so slices keep their color across ranking changes */}
              {chartData.map((d) => (
                <Cell key={d.name} fill={PIE_COLORS[tagHash(d.name) % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => fmtHours(Number(value ?? 0))} contentStyle={chart.tooltipStyle} itemStyle={chart.pieItemStyle} labelStyle={{ color: "var(--color-text)" }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </WidgetShell>
  );
}
