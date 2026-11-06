import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useProjects } from "../../db/hooks/useProjects";
// V1.11 C1: task-list widgets (today, overdue, deadlines, this-week, stale,
// free-days, recently-completed) use useVisibleTasks so tasks of cancelled/
// completed projects are hidden. Widgets that scope tasks through an
// active-projects filter (progress, no-deadline, stale-projects) and pure
// historical aggregates (weekly-streak, busiest-day) keep useAllTasks.
import { useAllTasks, useVisibleTasks } from "../../db/hooks/useTasks";
import { todayLocalISO } from "../../utils/localDate";
import { useNow } from "../../hooks/useNow";
import { effectivePriority } from "../../types/task";
import { useT } from "../../i18n/useT";
import { WidgetShell, WidgetTitle } from "./WidgetShell";
import { ProgressBar } from "../ui/Feedback";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/Skeleton";
import { PriorityDot } from "./widgetParts";

// ── Project progress ──

export function ProjectProgress() {
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
    <WidgetShell>
      <WidgetTitle>{t.progress}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-3">
        {activeProjects.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="block hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="truncate">{p.name}</span>
              <span className="text-xs text-muted shrink-0 ml-2">{p.done}/{p.total}</span>
            </div>
            <ProgressBar value={p.pct} aria-label={`${t.progress}: ${p.name}`} />
          </Link>
        ))}
        {projects === undefined ? <ListSkeleton size="sm" rows={3} /> : activeProjects.length === 0 && (
          <EmptyState size="sm" message={t.no_active_projects} />
        )}
      </div>
    </WidgetShell>
  );
}

// ── Upcoming deadlines ──

export function UpcomingDeadlines() {
  const { data: tasks } = useVisibleTasks();
  const { data: projects } = useProjects();
  const t = useT();
  const today = todayLocalISO();

  const projectName = (projectId: number) => projects?.find((p) => p.id === projectId)?.name ?? "";

  const upcoming = useMemo(() => {
    if (!tasks) return [];
    return tasks
      .filter((t) => t.due_date && t.due_date >= today && t.status !== "done")
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
      .slice(0, 8);
  }, [tasks, today]);

  return (
    <WidgetShell>
      <WidgetTitle>{t.deadline}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {upcoming.map((task) => (
          <Link key={task.id} to={`/projects/${task.project_id}`} className="flex items-center gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2">
            <PriorityDot priority={effectivePriority(task.priority, task.due_date, task.end_date)} />
            <span className="text-muted text-xs shrink-0">{projectName(task.project_id)}</span>
            <span className="truncate">{task.title}</span>
            <span className="text-xs text-muted ml-auto shrink-0">{task.due_date}</span>
          </Link>
        ))}
        {tasks === undefined ? <ListSkeleton size="sm" rows={3} /> : upcoming.length === 0 && (
          <EmptyState size="sm" message={t.no_upcoming_deadlines} />
        )}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: Projects without deadline ──

export function ProjectsWithoutDeadline() {
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
    <WidgetShell>
      <WidgetTitle>{t.projects_no_deadline}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {noDeadline.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2">
            <span className="truncate">{p.name}</span>
          </Link>
        ))}
        {projects === undefined || tasks === undefined ? <ListSkeleton size="sm" rows={3} /> : noDeadline.length === 0 && <EmptyState size="sm" message={t.all_projects_have_deadlines} />}
      </div>
    </WidgetShell>
  );
}

// ── Phase 18: Stale projects ──

export function StaleProjects() {
  const { data: projects } = useProjects();
  const { data: tasks } = useAllTasks();
  const t = useT();

  const now = useNow();
  const stale = useMemo(() => {
    if (!projects || !tasks) return [];
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
  }, [projects, tasks, now]);

  return (
    <WidgetShell>
      <WidgetTitle tone="warning">{t.stale_projects}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {stale.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2">
            <span className="truncate">{p.name}</span>
            <span className="text-xs text-warning-text shrink-0 ml-2">{p.daysInactive}{t.days_inactive}</span>
          </Link>
        ))}
        {projects === undefined || tasks === undefined ? <ListSkeleton size="sm" rows={3} /> : stale.length === 0 && <EmptyState size="sm" message={t.no_stale_projects} />}
      </div>
    </WidgetShell>
  );
}
