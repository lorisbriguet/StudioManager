import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { notify } from "../lib/notify";
import { useProjects, useCreateProject, useUpdateProject, useDeleteProject } from "../db/hooks/useProjects";
import { useClients } from "../db/hooks/useClients";
import { useAllTasks } from "../db/hooks/useTasks";
import { getAllSubtasks } from "../db/queries/tasks";
import { useQuery } from "@tanstack/react-query";
import type { Subtask } from "../types/task";
import { useAppStore } from "../stores/app-store";
import { useTabStore } from "../stores/tab-store";
import { ContextMenu, type ContextMenuState } from "../components/ui/ContextMenu";
import { useStartAgentOn } from "../hooks/useStartAgentOn";
import { useNewItem } from "../hooks/useNewItem";
import { agentMenuItems } from "../lib/agentStart";
import { BulkActionBar } from "../components/ui/BulkActionBar";
import { SavedFilterBar } from "../components/shared/SavedFilterBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { useListNavigation } from "../hooks/useListNavigation";
import { SidePeek } from "../components/layout/SidePeek";
import { formatDisplayDate } from "../utils/formatDate";
import { ProjectDetailContent } from "../components/ProjectDetailContent";
import type { ProjectStatus } from "../types/project";
import { effectivePriority, type TaskPriority } from "../types/task";
import { useT } from "../i18n/useT";
import type { UIKey } from "../i18n/ui";
import { ICONS, Checkbox, Button, Badge, PageHeader, SearchBar, DatePicker, Input, FormField, FormGrid, FormModal, EmptyState, QueryState, CardGridSkeleton, Select, FilterChip, ProgressBar, HEADING_2, Card, CARD_GAP, CARD_LINK, CARD_CONTROL, revealClass } from "../components/ui";
import { undoable, deleteWithUndo } from "../lib/undo";
import { confirmDelete } from "../lib/confirm";
import { useBulkDelete } from "../hooks/useBulkDelete";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";

import { projectStatusVariant } from "../lib/statusColors";
import { pickableClients } from "../types/client";
import { qk } from "../db/queryKeys";
import { usePeek } from "../hooks/usePeek";

const statusKeys: Record<ProjectStatus, UIKey> = {
  active: "active",
  completed: "completed",
  on_hold: "on_hold",
  cancelled: "cancelled",
};

const priorityRank: Record<TaskPriority, number> = { low: 0, medium: 1, high: 2 };

export function ProjectsPage() {
  const projectsQuery = useProjects();
  const { data: projects } = projectsQuery;
  const { data: clients } = useClients();
  const { data: allTasks } = useAllTasks();
  const { data: allSubtasks } = useQuery({ queryKey: qk.subtasks.all, queryFn: getAllSubtasks });
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const navigate = useNavigate();
  const openTab = useTabStore((s) => s.openTab);
  const projectOpenMode = useAppStore((s) => s.projectOpenMode);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<{ id: number; name: string }> | null>(null);
  const [showForm, setShowForm] = useState(false);
  // Cmd+N and the palette's New project open the form (lib/newEntity.ts).
  useNewItem("/projects", () => setShowForm(true));
  const [filter, setFilter] = useState<ProjectStatus | "all">("active");
  const [search, setSearch] = useState("");
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<ConditionLogic>("and");
  // Opened on each click / Enter (the peek takes focus again), moved by the arrows.
  const { peekId, openKey: peekOpenKey, open: openPeek, move: movePeek, close: closePeek } = usePeek();
  const t = useT();
  const { enabled: agentsOn, start: startAgentOn } = useStartAgentOn();

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

  // Cascading (a project takes its tasks with it): ask first, then Undo.
  const deleteSelection = useBulkDelete("projects", (id: number) => deleteProject.mutateAsync(id), {
    message: t.delete_projects_cascade,
  });
  const bulkDelete = () => void deleteSelection([...bulk.selected] as number[], bulk.clearSelection);

  const handleProjectClick = useCallback((projectId: number) => {
    if (projectOpenMode === "peek") {
      openPeek(projectId);
    } else {
      navigate(`/projects/${projectId}`);
    }
  }, [projectOpenMode, navigate, openPeek]);

  // Keyboard card navigation (flat list, visual/card order; no Left/Right).
  const { focusIdx, setFocusIdx } = useListNavigation({
    items: filtered,
    onOpen: useCallback((p: (typeof filtered)[0]) => handleProjectClick(p.id), [handleProjectClick]),
    onMenu: useCallback(
      (p: (typeof filtered)[0], pos: { x: number; y: number }) =>
        setCtxMenu({ ...pos, item: { id: p.id, name: p.name } }),
      []
    ),
    // While the peek is open, the arrows show the project they land on.
    onMove: useCallback((p: (typeof filtered)[0]) => { if (peekId !== null) movePeek(p.id); }, [peekId, movePeek]),
  });

  // Closing the peek puts focus back on its project's card, where the arrows carry on.
  const peekCard = () => {
    const idx = filtered.findIndex((p) => p.id === peekId);
    if (idx < 0) return null;
    setFocusIdx(idx);
    return document.querySelectorAll<HTMLElement>("[data-list-row]")[idx] ?? null;
  };

  const filterLabels: Record<ProjectStatus | "all", string> = {
    all: t.all,
    active: t.active,
    completed: t.completed,
    on_hold: t.on_hold,
    cancelled: t.cancelled,
  };

  const clearFilters = () => {
    setSearch("");
    setFilter("all");
    setFilterConditions([]);
    setActiveFilterId(null);
  };

  return (
    <div className="flex flex-1 min-h-0 -m-8">
      <div className="min-w-0 overflow-y-auto flex-1 p-8">
        <PageHeader title={t.projects}>
          <Button icon={ICONS.add} onClick={() => setShowForm(true)}>{t.new_project}</Button>
        </PageHeader>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex flex-wrap gap-2">
            {(["all", "active", "completed", "on_hold", "cancelled"] as const).map((s) => (
              <FilterChip
                key={s}
                active={filter === s}
                onClick={() => { setFilter(s); setActiveFilterId(null); setFilterConditions([]); }}
              >
                {filterLabels[s]}
              </FilterChip>
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
            clients={pickableClients(clients)}
            submitting={createProject.isPending}
            onSave={(data) => createProject.mutateAsync(data).then(
              () => {
                notify.success(t.toast_project_created);
                setShowForm(false);
              },
              // The mutation's onError toast reports it; the form stays open.
              () => {}
            )}
            onCancel={() => setShowForm(false)}
          />
        )}

        <QueryState
          query={projectsQuery}
          skeleton={<CardGridSkeleton />}
          errorMessage={t.load_error_projects}
          empty={
            <EmptyState
              icon={ICONS.project}
              message={t.no_projects}
              action={<Button icon={ICONS.add} onClick={() => setShowForm(true)}>{t.new_project}</Button>}
            />
          }
          noResults={filtered.length === 0 ? { message: t.no_matching_projects, onClear: clearFilters } : undefined}
        >
        {() => (
        <div className={`grid ${CARD_GAP} p-px`} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {filtered.map((p, pi) => {
            const stats = taskStats[p.id] ?? { total: 0, pct: 0, maxPriority: "low" as TaskPriority };
            const pct = stats.pct;

            return (
              <Card
                key={p.id}
                data-list-row
                // The title is the button (stretched over the card); the checkbox sits above it.
                interactive="link"
                selected={peekId === p.id || bulk.selected.has(p.id)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: { id: p.id, name: p.name } }); }}
                className={`group${pi === focusIdx ? " focus-row" : ""}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Checkbox
                      checked={bulk.selected.has(p.id)}
                      aria-label={t.select_row.replace("{name}", p.name)}
                      onChange={(e) => bulk.toggleItem(p.id, e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)}
                      onClick={(e) => e.stopPropagation()}
                      className={`${CARD_CONTROL} shrink-0 transition-opacity ${
                        bulk.selected.has(p.id) || bulk.count > 0 ? "opacity-100" : `${revealClass(true)} focus-within:opacity-100`
                      }`}
                    />
                    <h2 className={`${HEADING_2} leading-tight truncate`}>
                      <button type="button" className={`${CARD_LINK} truncate max-w-full`} onClick={() => handleProjectClick(p.id)}>
                        {p.name}
                      </button>
                    </h2>
                  </div>
                  <Badge variant={projectStatusVariant(p.status)} className="shrink-0 ml-2">
                    {t[statusKeys[p.status]]}
                  </Badge>
                </div>

                <div className="text-xs text-muted mb-3">{clientName(p.client_id)}</div>

                {stats.total > 0 && (
                  <ProgressBar
                    value={pct}
                    label={`${stats.total} ${t.tasks.toLowerCase()}`}
                    showValue
                    className="mb-3"
                  />
                )}
                {stats.total === 0 && (
                  <div className="text-xs text-muted mb-3">{t.no_tasks}</div>
                )}

                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{p.deadline ? formatDisplayDate(p.deadline) : t.no_deadline}</span>
                  {stats.total > 0 && (
                    <span className={`dot ${
                      stats.maxPriority === "high" ? "bg-danger" : stats.maxPriority === "medium" ? "bg-warning" : "bg-success"
                    }`} />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
        )}
        </QueryState>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: t.view_details, icon: ICONS.preview, onClick: () => navigate(`/projects/${ctxMenu.item.id}`) },
            { label: t.open_in_new_tab, icon: ICONS.newTab, onClick: () => openTab(`/projects/${ctxMenu.item.id}`, ctxMenu.item.name) },
            ...agentMenuItems(agentsOn, startAgentOn, { kind: "project", id: ctxMenu.item.id }),
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: ICONS.delete, danger: true, onClick: async () => {
              const project = ctxMenu.item;
              if (!(await confirmDelete(project.name, t.delete_project_cascade))) return;
              deleteWithUndo(deleteProject, project.id, t.toast_project_deleted);
            } },
          ]}
        />
      )}

      {peekId !== null && (
        <SidePeek
          resizable
          focusKey={peekOpenKey}
          onClose={closePeek}
          onOpenFull={() => navigate(`/projects/${peekId}`)}
          returnFocus={peekCard}
        >
          <ProjectDetailContent key={peekId} projectId={peekId} compact />
        </SidePeek>
      )}

      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.mark_active, icon: ICONS.markActive, onClick: () => bulkSetStatus("active") },
          { label: t.mark_completed, icon: ICONS.markDone, onClick: () => bulkSetStatus("completed") },
          { label: t.mark_on_hold, icon: ICONS.onHold, onClick: () => bulkSetStatus("on_hold") },
          { label: t.delete, icon: ICONS.delete, onClick: bulkDelete, danger: true },
        ]}
      />
    </div>
  );
}

function NewProjectForm({
  clients,
  submitting,
  onSave,
  onCancel,
}: {
  clients: { id: string; name: string }[];
  /** The save is running (spinner, no second submit). */
  submitting?: boolean;
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
  }) => void | Promise<void>;
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
  const [errors, setErrors] = useState<{ name?: string; client_id?: string }>({});

  // No validate schema here: two required checks, shown under their fields.
  const submit = () => {
    const next = {
      name: form.name.trim() ? undefined : t.toast_name_required,
      client_id: form.client_id ? undefined : t.toast_select_client,
    };
    setErrors(next);
    if (next.name || next.client_id) return;
    // Returned so FormModal ignores a second submit while it runs.
    return onSave({
      ...form,
      start_date: form.start_date || null,
      deadline: form.deadline || null,
      layout_config: null,
      folder_path: null,
    });
  };

  return (
    <FormModal open onClose={onCancel} title={t.new_project} submitLabel={t.save} onSubmit={submit} submitting={submitting}>
      <FormGrid cols={2}>
        <FormField label={t.project_name} required error={errors.name}>
          <Input
            autoFocus
            value={form.name}
            onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors((er) => ({ ...er, name: undefined })); }}
          />
        </FormField>
        <FormField label={t.client} required error={errors.client_id}>
          <Select
            value={form.client_id}
            onChange={(e) => { setForm({ ...form, client_id: e.target.value }); setErrors((er) => ({ ...er, client_id: undefined })); }}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t.start}>
          <DatePicker
            value={form.start_date || null}
            onChange={(v) => setForm({ ...form, start_date: v ?? "" })}
          />
        </FormField>
        <FormField label={t.deadline}>
          <DatePicker
            value={form.deadline || null}
            onChange={(v) => setForm({ ...form, deadline: v ?? "" })}
          />
        </FormField>
      </FormGrid>
    </FormModal>
  );
}
