import { useState, useMemo, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, X, Eye, Trash2, ExternalLink, Maximize2, FolderOpen, Play, Pause, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { ask } from "@tauri-apps/plugin-dialog";
import { useProjects, useCreateProject, useUpdateProject, useDeleteProject } from "../db/hooks/useProjects";
import { useClients } from "../db/hooks/useClients";
import { useAllTasks } from "../db/hooks/useTasks";
import { getAllSubtasks } from "../db/queries/tasks";
import { useQuery } from "@tanstack/react-query";
import type { Subtask } from "../types/task";
import { useAppStore } from "../stores/app-store";
import { useTabStore } from "../stores/tab-store";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { BulkActionBar } from "../components/BulkActionBar";
import { SavedFilterBar } from "../components/SavedFilterBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { formatDisplayDate } from "../utils/formatDate";
import { ProjectDetailContent } from "../components/ProjectDetailContent";
import type { ProjectStatus } from "../types/project";
import { effectivePriority, type TaskPriority } from "../types/task";
import { useT } from "../i18n/useT";
import type { UIKey } from "../i18n/ui";
import { Button, Badge, Card, PageHeader, SearchBar, TableSkeleton, Input, EmptyState } from "../components/ui";
import { undoable, undoableFromStore } from "../lib/undo";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";

import type { BadgeVariant } from "../components/ui/Badge";

const statusBadgeVariant: Record<ProjectStatus, BadgeVariant> = {
  active: "accent",
  completed: "success",
  on_hold: "warning",
  cancelled: "neutral",
};

const statusKeys: Record<ProjectStatus, UIKey> = {
  active: "active",
  completed: "completed",
  on_hold: "on_hold",
  cancelled: "cancelled",
};

const priorityRank: Record<TaskPriority, number> = { low: 0, medium: 1, high: 2 };

export function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const { data: clients } = useClients();
  const { data: allTasks } = useAllTasks();
  const { data: allSubtasks } = useQuery({ queryKey: ["subtasks"], queryFn: getAllSubtasks });
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const navigate = useNavigate();
  const openTab = useTabStore((s) => s.openTab);
  const projectOpenMode = useAppStore((s) => s.projectOpenMode);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<{ id: number; name: string }> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<ProjectStatus | "all">("active");
  const [search, setSearch] = useState("");
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<ConditionLogic>("and");
  const [peekId, setPeekId] = useState<number | null>(null);
  const [closingPeek, setClosingPeek] = useState(false);
  const [peekWidth, setPeekWidth] = useState(() => {
    const saved = localStorage.getItem("peekWidth");
    return saved ? Math.max(20, Math.min(70, Number(saved))) : 50;
  });
  const peekRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const t = useT();

  const handleDividerPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const container = containerRef.current;
    if (!container) return;

    const onPointerMove = (ev: PointerEvent) => {
      if (!draggingRef.current || !container) return;
      const rect = container.getBoundingClientRect();
      const offsetFromRight = rect.right - ev.clientX;
      const pct = Math.max(20, Math.min(70, (offsetFromRight / rect.width) * 100));
      if (peekRef.current) {
        peekRef.current.style.width = `${pct}%`;
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      draggingRef.current = false;
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (container) {
        const rect = container.getBoundingClientRect();
        const offsetFromRight = rect.right - ev.clientX;
        const pct = Math.max(20, Math.min(70, (offsetFromRight / rect.width) * 100));
        setPeekWidth(pct);
        localStorage.setItem("peekWidth", String(Math.round(pct)));
      }
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }, []);

  const clientName = useCallback((clientId: string) =>
    clients?.find((c) => c.id === clientId)?.name ?? clientId, [clients]);

  const applyFilter = useCallback((filters: SavedFilterData) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    if (filters.filter === "all" || filters.filter === "active" || filters.filter === "completed" || filters.filter === "on_hold" || filters.filter === "cancelled") {
      setFilter(filters.filter as ProjectStatus | "all");
    }
    setFilterConditions(filters.conditions ?? []);
    setFilterLogic(filters.conditionLogic ?? "and");
  }, []);

  const projectFields = useMemo<FilterableField[]>(() => [
    { key: "name", label: t.project_name, type: "string" },
    { key: "client_id", label: t.client, type: "select", options: (clients ?? []).map((c) => ({ value: c.id, label: c.name })) },
    { key: "status", label: t.status, type: "select", options: [
      { value: "active", label: t.active },
      { value: "completed", label: t.completed },
      { value: "on_hold", label: t.on_hold },
      { value: "cancelled", label: t.cancelled },
    ]},
  ], [t, clients]);

  // Group subtasks by task_id
  const subtasksByTask = useMemo(() => {
    const map: Record<number, Subtask[]> = {};
    for (const s of allSubtasks ?? []) {
      (map[s.task_id] ??= []).push(s);
    }
    return map;
  }, [allSubtasks]);

  const taskStats = useMemo(() => {
    const map: Record<number, { total: number; pct: number; maxPriority: TaskPriority }> = {};
    // Group tasks by project
    const byProject: Record<number, typeof allTasks> = {};
    for (const tk of allTasks ?? []) {
      (byProject[tk.project_id] ??= []).push(tk);
      if (!map[tk.project_id]) map[tk.project_id] = { total: 0, pct: 0, maxPriority: "low" };
      map[tk.project_id].total++;
      if (tk.status !== "done") {
        const eff = effectivePriority(tk.priority, tk.due_date, tk.end_date);
        if (priorityRank[eff] > priorityRank[map[tk.project_id].maxPriority]) {
          map[tk.project_id].maxPriority = eff;
        }
      }
    }
    // Compute weighted progress per project
    for (const [pid, tasks] of Object.entries(byProject)) {
      const projectId = Number(pid);
      if (!tasks || tasks.length === 0) continue;
      const weight = 1 / tasks.length;
      let sum = 0;
      for (const tk of tasks) {
        const subs = subtasksByTask[tk.id];
        if (!subs || subs.length === 0) {
          if (tk.status === "done") sum += weight;
        } else {
          const doneSubs = subs.filter((s) => s.status === "done").length;
          sum += weight * (doneSubs / subs.length);
        }
      }
      map[projectId].pct = Math.round(sum * 100);
    }
    return map;
  }, [allTasks, subtasksByTask]);

  const filtered = useMemo(() => {
    let rows = projects ?? [];
    if (filter !== "all") rows = rows.filter((p) => p.status === filter);
    const q = search.toLowerCase();
    if (q) {
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          clientName(p.client_id).toLowerCase().includes(q)
      );
    }
    rows = applyFilterConditions(rows, filterConditions, filterLogic);
    return [...rows].sort((a, b) => {
      const pa = priorityRank[taskStats[a.id]?.maxPriority ?? "low"];
      const pb = priorityRank[taskStats[b.id]?.maxPriority ?? "low"];
      return pb - pa;
    });
  }, [projects, clientName, filter, search, taskStats, filterConditions, filterLogic]);

  const bulk = useBulkSelect(filtered);

  const bulkSetStatus = useCallback((status: ProjectStatus) => {
    const ids = [...bulk.selected] as number[];
    const prevStates = ids.map((id) => {
      const p = (projects ?? []).find((proj) => proj.id === id);
      return { id, status: p?.status };
    });
    ids.forEach((id) => updateProject.mutate({ id, data: { status } }));
    undoable(t.bulk_updated, async () => {
      await Promise.all(
        prevStates.map((prev) =>
          updateProject.mutateAsync({ id: prev.id, data: { status: prev.status as ProjectStatus } })
        )
      );
    });
    bulk.clearSelection();
  }, [bulk, updateProject, projects, t]);

  const bulkDelete = useCallback(async () => {
    if (!(await ask(t.confirm_bulk_delete, { kind: "warning" }))) return;
    const ids = [...bulk.selected] as number[];
    ids.forEach((id) => deleteProject.mutate(id));
    bulk.clearSelection();
  }, [bulk, deleteProject, t]);

  const handleProjectClick = (projectId: number) => {
    if (projectOpenMode === "peek") {
      setClosingPeek(false);
      setPeekId(projectId);
    } else {
      navigate(`/projects/${projectId}`);
    }
  };

  const handleClosePeek = () => {
    setClosingPeek(true);
  };

  const filterLabels: Record<ProjectStatus | "all", string> = {
    all: t.all,
    active: t.active,
    completed: t.completed,
    on_hold: t.on_hold,
    cancelled: t.cancelled,
  };

  if (isLoading) return (
    <div className="flex flex-1 min-h-0 -m-8">
      <div className="min-w-0 overflow-y-auto flex-1 p-8">
        <PageHeader title={t.projects}>
          <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>{t.new_project}</Button>
        </PageHeader>
        <TableSkeleton columns={4} />
      </div>
    </div>
  );

  return (
    <div ref={containerRef} className="flex flex-1 min-h-0 -m-8">
      <div className="min-w-0 overflow-y-auto flex-1 p-8">
        <PageHeader title={t.projects}>
          <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>{t.new_project}</Button>
        </PageHeader>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex flex-wrap gap-2">
            {(["all", "active", "completed", "on_hold", "cancelled"] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setFilter(s); setActiveFilterId(null); setFilterConditions([]); }}
                className={`px-3 py-1 text-xs rounded-full border ${
                  filter === s
                    ? "bg-accent text-white border-accent"
                    : "border-[var(--color-input-border)] text-muted hover:bg-[var(--color-hover-row)]"
                }`}
              >
                {filterLabels[s]}
              </button>
            ))}
          </div>
          <SearchBar
            value={search}
            onChange={(v) => { setSearch(v); setActiveFilterId(null); setFilterConditions([]); }}
            placeholder={t.search_projects}
            className="w-48"
          />
        </div>

        <SavedFilterBar
          page="projects"
          currentFilters={{ search, filter, conditions: filterConditions, conditionLogic: filterLogic }}
          onApply={applyFilter}
          activeFilterId={activeFilterId}
          onActiveChange={setActiveFilterId}
          fields={projectFields}
        />

        {showForm && (
          <NewProjectForm
            clients={clients ?? []}
            onSave={(data) => {
              createProject.mutate(data, {
                onSuccess: () => {
                  toast.success(t.toast_project_created);
                  setShowForm(false);
                },
              });
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        <div className="grid gap-4 p-px" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {filtered.map((p) => {
            const stats = taskStats[p.id] ?? { total: 0, pct: 0, maxPriority: "low" as TaskPriority };
            const pct = stats.pct;

            return (
              <div
                key={p.id}
                onClick={() => handleProjectClick(p.id)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: { id: p.id, name: p.name } }); }}
                className={`group block rounded-xl p-4 transition-all cursor-pointer ${
                  peekId === p.id
                    ? "bg-[var(--color-hover-row)] outline outline-1 outline-accent"
                    : bulk.selected.has(p.id)
                      ? "bg-[var(--color-hover-row)] outline outline-1 outline-accent"
                      : "bg-[var(--color-surface)] hover:bg-[var(--color-hover-row)]"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={bulk.selected.has(p.id)}
                      onChange={(e) => bulk.toggleItem(p.id, e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)}
                      onClick={(e) => e.stopPropagation()}
                      className={`accent-[var(--accent)] shrink-0 transition-opacity ${
                        bulk.selected.has(p.id) || bulk.count > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                    />
                    <h3 className="text-sm font-medium leading-tight truncate">{p.name}</h3>
                  </div>
                  <Badge variant={statusBadgeVariant[p.status]} className="shrink-0 ml-2">
                    {t[statusKeys[p.status]]}
                  </Badge>
                </div>

                <div className="text-xs text-muted mb-3">{clientName(p.client_id)}</div>

                {stats.total > 0 && (
                  <div className="mb-3">
                    <div className="flex justify-between text-[11px] text-muted mb-1">
                      <span>{stats.total} {t.tasks.toLowerCase()}</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-[var(--color-input)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}
                {stats.total === 0 && (
                  <div className="text-[11px] text-muted mb-3">{t.no_tasks}</div>
                )}

                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span>{p.deadline ? formatDisplayDate(p.deadline) : t.no_deadline}</span>
                  {stats.total > 0 && (
                    <span className={`dot ${
                      stats.maxPriority === "high" ? "bg-danger" : stats.maxPriority === "medium" ? "bg-warning" : "bg-success"
                    }`} />
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full">
              <EmptyState
                icon={<FolderOpen size={32} />}
                message={(projects?.length ?? 0) === 0 ? t.no_projects : t.no_matching_projects}
                action={(projects?.length ?? 0) === 0 ? (
                  <Button icon={<Plus size={16} />} onClick={() => setShowForm(true)}>{t.new_project}</Button>
                ) : undefined}
              />
            </div>
          )}
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: t.view_details, icon: <Eye size={14} />, onClick: () => navigate(`/projects/${ctxMenu.item.id}`) },
            { label: t.open_in_new_tab, icon: <ExternalLink size={14} />, onClick: () => openTab(`/projects/${ctxMenu.item.id}`, ctxMenu.item.name) },
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteProject.mutate(ctxMenu.item.id, { onSuccess: () => undoableFromStore(t.toast_project_deleted) }) },
          ]}
        />
      )}

      {/* Side Peek Panel */}
      {peekId !== null && (
        <>
        {/* Drag divider — separate from peek, not clipped by overflow */}
        <div
          onPointerDown={handleDividerPointerDown}
          className="shrink-0 w-[5px] cursor-col-resize relative group"
        >
          <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border-divider)] -translate-x-1/2" />
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-accent/20 transition-opacity" />
        </div>
        <div
          ref={peekRef}
          className={`shrink-0 overflow-y-auto ${closingPeek ? "peek-exit" : "peek-enter"}`}
          style={{ width: `${peekWidth}%` }}
          onClick={(e) => e.stopPropagation()}
          onAnimationEnd={() => { if (closingPeek) { setPeekId(null); setClosingPeek(false); } }}
        >
          <div className="flex items-center gap-1 p-2 border-b border-[var(--color-border-header)]">
            <button
              onClick={handleClosePeek}
              className="p-1.5 rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover-row)] hover:text-[var(--color-text-secondary)]"
              aria-label={t.close}
            >
              <X size={14} />
            </button>
            <div className="flex-1" />
            <Link
              to={`/projects/${peekId}`}
              className="p-1.5 rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover-row)] hover:text-[var(--color-text-secondary)]"
              title={t.open_full_page}
            >
              <Maximize2 size={14} />
            </Link>
          </div>
          <div className="p-4">
            <ProjectDetailContent key={peekId} projectId={peekId} compact />
          </div>
        </div>
        </>
      )}

      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.mark_active, icon: <Play size={14} />, onClick: () => bulkSetStatus("active") },
          { label: t.mark_completed, icon: <CheckCircle size={14} />, onClick: () => bulkSetStatus("completed") },
          { label: t.mark_on_hold, icon: <Pause size={14} />, onClick: () => bulkSetStatus("on_hold") },
          { label: t.delete, icon: <Trash2 size={14} />, onClick: bulkDelete, danger: true },
        ]}
      />
    </div>
  );
}

function NewProjectForm({
  clients,
  onSave,
  onCancel,
}: {
  clients: { id: string; name: string }[];
  onSave: (data: {
    client_id: string;
    name: string;
    description: string;
    status: ProjectStatus;
    start_date: string | null;
    deadline: string | null;
    notes: string;
    layout_config: string | null;
    folder_path: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    client_id: clients[0]?.id ?? "",
    name: "",
    description: "",
    status: "active" as ProjectStatus,
    start_date: "",
    deadline: "",
    notes: "",
  });
  const t = useT();

  return (
    <Card className="mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input
          placeholder={`${t.project_name} *`}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <select
          value={form.client_id}
          onChange={(e) => setForm({ ...form, client_id: e.target.value })}
          className="border border-[var(--color-input-border)] bg-[var(--color-input)] rounded-lg px-3 py-1.5 text-sm"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Input
          type="date"
          value={form.start_date}
          onChange={(e) => setForm({ ...form, start_date: e.target.value })}
        />
        <Input
          type="date"
          value={form.deadline}
          onChange={(e) => setForm({ ...form, deadline: e.target.value })}
        />
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            if (!form.name.trim()) return toast.error(t.toast_name_required);
            if (!form.client_id) return toast.error(t.toast_select_client);
            onSave({
              ...form,
              start_date: form.start_date || null,
              deadline: form.deadline || null,
              layout_config: null,
              folder_path: null,
            });
          }}
        >
          {t.save}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </Card>
  );
}
