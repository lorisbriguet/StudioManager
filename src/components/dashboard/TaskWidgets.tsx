import { useMemo } from "react";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { ICONS, ICON_SIZE } from "../ui/icons";
import { StatTile } from "../ui/StatTile";
import { useProjects } from "../../db/hooks/useProjects";
// V1.11 C1: task-list widgets (today, overdue, deadlines, this-week, stale,
// free-days, recently-completed) use useVisibleTasks so tasks of cancelled/
// completed projects are hidden. Widgets that scope tasks through an
// active-projects filter (progress, no-deadline, stale-projects) and pure
// historical aggregates (weekly-streak, busiest-day) keep useAllTasks.
import { useAllTasks, useVisibleTasks } from "../../db/hooks/useTasks";
import { todayLocalISO } from "../../utils/localDate";
import { getSubtasksWithDueDate } from "../../db/queries/tasks";
import { effectivePriority } from "../../types/task";
import { useChartTheme } from "../../hooks/useChartTheme";
import { useT } from "../../i18n/useT";
import { WidgetShell, WidgetTitle } from "./WidgetShell";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/Skeleton";
import { qk } from "../../db/queryKeys";
import { useNow } from "../../hooks/useNow";
import { KPI_TILE, PriorityDot } from "./widgetParts";

// ── Today tasks ──

export function TodayTasks() {
  const { data: tasks } = useVisibleTasks();
  const { data: subtasks } = useQuery({ queryKey: qk.subtasks.withDueDate, queryFn: getSubtasksWithDueDate });
  const { data: projects } = useProjects();
  const t = useT();
  const today = todayLocalISO();

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
    <WidgetShell>
      <WidgetTitle>{t.today}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {todayTasks.map((task) => (
          <Link key={`t-${task.id}`} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2">
            <PriorityDot priority={effectivePriority(task.priority, task.due_date, task.end_date)} />
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
            {task.start_time && <span className="text-xs text-muted ml-auto shrink-0">{task.start_time.slice(0, 5)}</span>}
          </Link>
        ))}
        {todaySubtasks.map((s) => (
          <Link key={`s-${s.id}`} to={`/projects/${s.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2">
            <PriorityDot priority="high" />
            <span className="text-muted text-xs shrink-0">{projectName(s.project_id)}</span>
            <span className="truncate opacity-70">↳ {s.title}</span>
            {s.start_time && <span className="text-xs text-muted ml-auto shrink-0">{s.start_time.slice(0, 5)}</span>}
          </Link>
        ))}
        {tasks === undefined ? <ListSkeleton size="sm" rows={3} /> : todayTasks.length === 0 && todaySubtasks.length === 0 && (
          <EmptyState size="sm" message={t.nothing_due_today} />
        )}
      </div>
    </WidgetShell>
  );
}

// ── Overdue tasks ──

export function OverdueTasks() {
  const { data: tasks } = useVisibleTasks();
  const { data: subtasks } = useQuery({ queryKey: qk.subtasks.withDueDate, queryFn: getSubtasksWithDueDate });
  const { data: projects } = useProjects();
  const t = useT();
  const today = todayLocalISO();

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
    <WidgetShell>
      <WidgetTitle tone="danger">{t.overdue}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {overdueTasks.map((task) => (
          <Link key={`t-${task.id}`} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2">
            <PriorityDot priority="high" />
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
            <span className="text-xs text-danger-text ml-auto shrink-0">{task.due_date}</span>
          </Link>
        ))}
        {overdueSubtasks.map((s) => (
          <Link key={`s-${s.id}`} to={`/projects/${s.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2">
            <PriorityDot priority="high" />
            <span className="text-muted text-xs shrink-0">{projectName(s.project_id)}</span>
            <span className="truncate opacity-70">↳ {s.title}</span>
            <span className="text-xs text-danger-text ml-auto shrink-0">{s.due_date}</span>
          </Link>
        ))}
        {tasks === undefined ? <ListSkeleton size="sm" rows={3} /> : overdueTasks.length === 0 && overdueSubtasks.length === 0 && (
          <EmptyState size="sm" message={t.nothing_overdue} />
        )}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: Stale tasks ──

export function StaleTasks() {
  const { data: tasks } = useVisibleTasks();
  const { data: projects } = useProjects();
  const t = useT();

  const projectName = (projectId: number) => projects?.find((p) => p.id === projectId)?.name ?? "";

  const now = useNow();
  const stale = useMemo(() => {
    if (!tasks) return [];
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
  }, [tasks, now]);

  return (
    <WidgetShell>
      <WidgetTitle tone="warning">{t.stale_tasks}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {stale.map((task) => (
          <Link key={task.id} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2">
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
            <span className="text-xs text-warning-text ml-auto shrink-0">{task.daysInactive}{t.days_inactive}</span>
          </Link>
        ))}
        {tasks === undefined ? <ListSkeleton size="sm" rows={3} /> : stale.length === 0 && <EmptyState size="sm" message={t.no_stale_tasks} />}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: Recently completed ──

export function RecentlyCompleted() {
  const { data: tasks } = useVisibleTasks();
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
    <WidgetShell>
      <WidgetTitle>{t.recently_completed}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {completed.map((task) => (
          <Link key={task.id} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2">
            <ICONS.done size={ICON_SIZE.control} className="text-success-text shrink-0" />
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
          </Link>
        ))}
        {tasks === undefined ? <ListSkeleton size="sm" rows={3} /> : completed.length === 0 && <EmptyState size="sm" message={t.no_completed_tasks} />}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: Weekly streak ──

export function WeeklyStreak() {
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
    <StatTile className={KPI_TILE} label={t.weekly_streak} value={streak} caption={t.weeks} />
  );
}

// ── Phase 18: Busiest day of week ──

const DAY_NAMES_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function BusiestDay() {
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
    <WidgetShell>
      <WidgetTitle>{t.busiest_day}</WidgetTitle>
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
    </WidgetShell>
  );
}
