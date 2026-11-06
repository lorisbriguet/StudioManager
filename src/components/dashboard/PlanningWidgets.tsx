import { useMemo, useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ICONS, ICON_SIZE } from "../ui/icons";
import { StatTile } from "../ui/StatTile";
import { Textarea } from "../ui/Input";
import { useProjects } from "../../db/hooks/useProjects";
// V1.11 C1: task-list widgets (today, overdue, deadlines, this-week, stale,
// free-days, recently-completed) use useVisibleTasks so tasks of cancelled/
// completed projects are hidden. Widgets that scope tasks through an
// active-projects filter (progress, no-deadline, stale-projects) and pure
// historical aggregates (weekly-streak, busiest-day) keep useAllTasks.
import { useVisibleTasks } from "../../db/hooks/useTasks";
import { toLocalISO } from "../../utils/localDate";
import { useDashboardStore } from "../../stores/dashboard-store";
import { effectivePriority } from "../../types/task";
import { useT } from "../../i18n/useT";
import { WidgetShell, WidgetTitle } from "./WidgetShell";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/Skeleton";
import { KPI_TILE, PriorityDot } from "./widgetParts";

// ── This week events ──

export function ThisWeekEvents() {
  const { data: tasks } = useVisibleTasks();
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

    const monStr = toLocalISO(monday);
    const sunStr = toLocalISO(sunday);

    return tasks
      .filter((t) => t.due_date && t.due_date >= monStr && t.due_date <= sunStr && t.status !== "done")
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "") || (a.start_time ?? "").localeCompare(b.start_time ?? ""));
  }, [tasks]);

  const dayLabel = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  };

  return (
    <WidgetShell>
      <WidgetTitle>{t.this_week}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {weekEvents.map((task) => (
          <Link key={task.id} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2">
            <PriorityDot priority={effectivePriority(task.priority, task.due_date, task.end_date)} />
            <span className="text-muted text-xs shrink-0">{dayLabel(task.due_date!)}</span>
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
            {task.start_time && <span className="text-xs text-muted ml-auto shrink-0">{task.start_time.slice(0, 5)}</span>}
          </Link>
        ))}
        {tasks === undefined ? <ListSkeleton size="sm" rows={3} /> : weekEvents.length === 0 && <EmptyState size="sm" message={t.nothing_due_this_week} />}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: Free days this week ──

export function FreeDaysWeek() {
  const { data: tasks } = useVisibleTasks();
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
      const dateStr = toLocalISO(d);
      const hasTasks = tasks.some((t) => t.due_date === dateStr && t.status !== "done");
      if (!hasTasks) free++;
    }
    return free;
  }, [tasks]);

  return (
    <StatTile className={KPI_TILE} label={t.free_days_week} value={`${freeDays}/5`} caption={t.free} />
  );
}

// ── Phase 18: Quick create ──

export function QuickCreate() {
  const navigate = useNavigate();
  const t = useT();

  const items = [
    { label: t.new_invoice, icon: ICONS.invoice, to: "/invoices/new" },
    { label: t.new_quote, icon: ICONS.quote, to: "/quotes/new" },
    { label: t.new_expense, icon: ICONS.expense, to: "/expenses" },
    { label: t.new_project, icon: ICONS.newProject, to: "/projects" },
  ];

  return (
    <WidgetShell>
      <WidgetTitle>{t.quick_create}</WidgetTitle>
      <div className="flex-1 grid grid-cols-2 gap-2 content-start">
        {items.map((item) => (
          <button
            key={item.to}
            type="button"
            onClick={() => navigate(item.to)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-[var(--color-input-bg)] hover:bg-[var(--color-hover-row)] transition-colors"
          >
            <item.icon size={ICON_SIZE.callout} className="text-muted shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: Pinned notes ──

export function PinnedNotes() {
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
    <WidgetShell>
      <WidgetTitle>{t.pinned_notes}</WidgetTitle>
      <Textarea
        fill
        className="flex-1 cursor-text"
        aria-label={t.pinned_notes}
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        placeholder={t.notes}
      />
    </WidgetShell>
  );
}
