import { useState, useMemo, useCallback } from "react";
import { IconButton } from "../components/ui/IconButton";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { deleteWithUndo, undoable } from "../lib/undo";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useVisibleTasks, useUpdateTask, useCreateTask, useDeleteTask, useCreateSubtask, useUpdateSubtask, useDeleteSubtask } from "../db/hooks/useTasks";
import { getAllSubtasks } from "../db/queries/tasks";
import { useQuery } from "@tanstack/react-query";
import { useProjects } from "../db/hooks/useProjects";
import { useClients } from "../db/hooks/useClients";
import { TaskDatePicker } from "../components/TaskDatePicker";
import { ContextMenu, type ContextMenuState } from "../components/ui/ContextMenu";
import { BulkActionBar } from "../components/ui/BulkActionBar";
import { SavedFilterBar } from "../components/shared/SavedFilterBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { useBulkDelete } from "../hooks/useBulkDelete";
import { useListNavigation } from "../hooks/useListNavigation";
import { useTabStore } from "../stores/tab-store";
import { useOrgStore } from "../stores/org-store";
import { useTimerActions } from "../hooks/useTimerActions";
import { useT } from "../i18n/useT";
import { ICONS, ICON_SIZE, Checkbox, Button, Dropdown, PageHeader, SearchBar, EmptyState, QueryError, NoResults, ListSkeleton, Select, FilterChip, AddRow, InlineRename, DragHandle } from "../components/ui";
import { taskStatusVariant, statusClasses } from "../lib/statusColors";
import type { Task, Subtask, TaskStatus } from "../types/task";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";
import { PILL } from "../components/ui/tokens";

export function TasksPage() {
  const t = useT();
  const openTab = useTabStore((s) => s.openTab);
  // V1.11 C1: tasks of cancelled/completed projects are hidden, so their
  // project groups disappear entirely (groups are derived from the tasks).
  // EmptyState below reads this filtered source: if every task in the DB
  // belongs to a cancelled/completed project, the page shows "no tasks yet" —
  // sensible, since nothing actionable exists and no groups render.
  const tasksQuery = useVisibleTasks();
  const navigate = useNavigate();
  const { data: tasks } = tasksQuery;
  // First run: the project picked from the empty state's "New task" gets an empty group (its add-task row).
  const [startProjectId, setStartProjectId] = useState<number | null>(null);
  const { data: projects } = useProjects();
  const { data: clients } = useClients();
  const { data: subtasks } = useQuery({ queryKey: ["subtasks"], queryFn: getAllSubtasks });
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const createSubtask = useCreateSubtask();
  const updateSubtask = useUpdateSubtask();
  const deleteSubtask = useDeleteSubtask();
  const { activeTimer, toggleTimer } = useTimerActions();
  const [filter, setFilter] = useState<TaskStatus | "all">("todo");
  const [search, setSearch] = useState("");
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const [editingTask, setEditingTask] = useState<number | null>(null);
  const [editingSubtask, setEditingSubtask] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<Task> | null>(null);
  const [subCtxMenu, setSubCtxMenu] = useState<ContextMenuState<Subtask> | null>(null);
  const [headerCtxMenu, setHeaderCtxMenu] = useState<ContextMenuState<{ projectId: number; projectName: string }> | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem(useOrgStore.getState().orgKey("tasksCollapsedProjects"));
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [projectOrder, setProjectOrder] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem(useOrgStore.getState().orgKey("tasksProjectOrder"));
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const projectsMap = useMemo(() => new Map(projects?.map((p) => [p.id, p]) ?? []), [projects]);
  const clientsMap = useMemo(() => new Map(clients?.map((c) => [c.id, c.name]) ?? []), [clients]);

  const projectName = useCallback((projectId: number) =>
    projectsMap.get(projectId)?.name ?? "", [projectsMap]);

  const clientForProject = useCallback((projectId: number) => {
    const project = projectsMap.get(projectId);
    if (!project) return "";
    return clientsMap.get(project.client_id) ?? "";
  }, [projectsMap, clientsMap]);

  const handleTimerToggle = useCallback(async (taskId: number, projectId: number) => {
    await toggleTimer(taskId, projectId, projectName(projectId));
  }, [toggleTimer, projectName]);

  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<ConditionLogic>("and");

  const applyFilter = useCallback((filters: SavedFilterData) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    if (filters.filter === "all" || filters.filter === "todo" || filters.filter === "done") setFilter(filters.filter as TaskStatus | "all");
    setFilterConditions(filters.conditions ?? []);
    setFilterLogic(filters.conditionLogic ?? "and");
  }, []);

  const taskFields = useMemo<FilterableField[]>(() => [
    { key: "title", label: t.tasks, type: "string" },
    { key: "priority", label: "Priority", type: "select", options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ]},
    { key: "status", label: t.status, type: "select", options: [
      { value: "todo", label: t.todo },
      { value: "done", label: t.done },
    ]},
  ], [t]);

  const grouped = useMemo(() => {
    if (!tasks) return [];
    let rows = tasks;
    if (filter !== "all") rows = rows.filter((tk) => tk.status === filter);
    const q = search.toLowerCase();
    if (q) {
      rows = rows.filter(
        (tk) =>
          tk.title.toLowerCase().includes(q) ||
          projectName(tk.project_id).toLowerCase().includes(q)
      );
    }
    rows = applyFilterConditions(rows, filterConditions, filterLogic);
    const groups = new Map<number, typeof rows>();
    for (const tk of rows) {
      const arr = groups.get(tk.project_id) ?? [];
      arr.push(tk);
      groups.set(tk.project_id, arr);
    }
    if (startProjectId != null && !groups.has(startProjectId)) groups.set(startProjectId, []);
    const result = Array.from(groups.entries()).map(([projectId, items]) => ({
      projectId,
      projectName: projectName(projectId),
      clientName: clientForProject(projectId),
      tasks: items,
    }));
    if (projectOrder.length > 0) {
      result.sort((a, b) => {
        const ai = projectOrder.indexOf(a.projectId);
        const bi = projectOrder.indexOf(b.projectId);
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      });
    }
    return result;
  }, [tasks, projectName, clientForProject, filter, search, projectOrder, filterConditions, filterLogic, startProjectId]);

  const flatTasks = useMemo(() => grouped.flatMap((g) => g.tasks), [grouped]);
  const bulk = useBulkSelect(flatTasks);

  // Keyboard row navigation — only the tasks of non-collapsed projects are
  // navigation stops. Group headers and subtasks are not.
  const navigableTasks = useMemo(
    () => grouped.filter((g) => !collapsedProjects.has(g.projectId)).flatMap((g) => g.tasks),
    [grouped, collapsedProjects]
  );
  const taskIdxById = useMemo(
    () => new Map(navigableTasks.map((tk, i) => [tk.id, i])),
    [navigableTasks]
  );

  const toggleTaskExpanded = useCallback((taskId: number) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const { focusIdx } = useListNavigation({
    items: navigableTasks,
    onOpen: useCallback((tk: Task) => toggleTaskExpanded(tk.id), [toggleTaskExpanded]),
    onMenu: useCallback((tk: Task, pos: { x: number; y: number }) => setCtxMenu({ ...pos, item: tk }), []),
  });

  const bulkMarkDone = useCallback(() => {
    const ids = [...bulk.selected] as number[];
    const prevStates = ids.map((id) => {
      const tk = flatTasks.find((task) => task.id === id);
      return { id, status: tk?.status };
    });
    ids.forEach((id) => updateTask.mutate({ id, data: { status: "done" } }));
    undoable(t.bulk_updated, async () => {
      await Promise.all(
        prevStates.map((prev) =>
          updateTask.mutateAsync({ id: prev.id, data: { status: (prev.status ?? "todo") as TaskStatus } })
        )
      );
    });
    bulk.clearSelection();
  }, [bulk, updateTask, flatTasks, t]);

  const deleteSelection = useBulkDelete("tasks", (id: number) => deleteTask.mutateAsync(id));
  const bulkDelete = () => void deleteSelection([...bulk.selected] as number[], bulk.clearSelection);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const projectIds = useMemo(() => grouped.map((g) => g.projectId), [grouped]);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = Number(active.id);
      const overId = Number(over.id);
      const ids = grouped.map((g) => g.projectId);
      const fromIdx = ids.indexOf(activeId);
      const toIdx = ids.indexOf(overId);
      if (fromIdx === -1 || toIdx === -1) return;
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, activeId);
      setProjectOrder(ids);
      localStorage.setItem(useOrgStore.getState().orgKey("tasksProjectOrder"), JSON.stringify(ids));
    },
    [grouped]
  );

  const statusTabs: { value: TaskStatus | "all"; label: string }[] = [
    { value: "all", label: t.all },
    { value: "todo", label: t.todo },
    { value: "done", label: t.done },
  ];

  if (tasks === undefined) return (
    <div>
      <PageHeader title={t.tasks} />
      {tasksQuery.isError ? (
        <QueryError message={t.load_error_tasks} onRetry={tasksQuery.refetch} retrying={tasksQuery.isFetching} />
      ) : (
        <ListSkeleton rows={8} />
      )}
    </div>
  );

  const clearFilters = () => {
    setSearch("");
    setFilter("all");
    setFilterConditions([]);
    setActiveFilterId(null);
  };
  const activeProjects = (projects ?? []).filter((p) => p.status === "active");

  return (
    <div>
      <PageHeader title={t.tasks} />

      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-2">
          {statusTabs.map((tab) => (
            <FilterChip
              key={tab.value}
              active={filter === tab.value}
              onClick={() => { setFilter(tab.value); setActiveFilterId(null); setFilterConditions([]); }}
            >
              {tab.label}
            </FilterChip>
          ))}
        </div>
        <SearchBar
          value={search}
          onChange={(v) => { setSearch(v); setActiveFilterId(null); setFilterConditions([]); }}
          placeholder={t.search_tasks}
        />
      </div>

      <SavedFilterBar
        page="tasks"
        currentFilters={{ search, filter, conditions: filterConditions, conditionLogic: filterLogic }}
        onApply={applyFilter}
        activeFilterId={activeFilterId}
        onActiveChange={setActiveFilterId}
        fields={taskFields}
      />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleProjectDragEnd}>
      <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
      <div className="space-y-4">
        {grouped.map((g) => (
          <SortableProjectGroup key={g.projectId} id={g.projectId}>
            {({ attributes, listeners }) => (<>
            <div
              className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-2 select-none"
              onContextMenu={(e) => { e.preventDefault(); setHeaderCtxMenu({ x: e.clientX, y: e.clientY, item: { projectId: g.projectId, projectName: g.projectName } }); }}
            >
              <DragHandle {...attributes} {...listeners} className="-my-1 p-0.5" />
              <button
                onClick={() => {
                  const next = new Set(collapsedProjects);
                  if (next.has(g.projectId)) next.delete(g.projectId);
                  else next.add(g.projectId);
                  setCollapsedProjects(next);
                  localStorage.setItem(useOrgStore.getState().orgKey("tasksCollapsedProjects"), JSON.stringify([...next]));
                }}
                className="flex items-center gap-2 flex-1 text-left"
              >
              <ChevronRight
                size={ICON_SIZE.menu}
                className={`text-muted transition-transform shrink-0 ${collapsedProjects.has(g.projectId) ? "" : "rotate-90"}`}
              />
              <Link
                to={`/projects/${g.projectId}`}
                onClick={(e) => e.stopPropagation()}
                className="text-sm font-medium text-accent hover:underline"
              >
                {g.projectName}
              </Link>
              {g.clientName && (
                <span className="text-xs text-muted">/ {g.clientName}</span>
              )}
              <span className="text-xs text-muted ml-auto">{g.tasks.length} task{g.tasks.length !== 1 ? "s" : ""}</span>
              </button>
            </div>
            {!collapsedProjects.has(g.projectId) && <div className="divide-y divide-[var(--color-border-divider)]">
              {g.tasks.map((tk) => {
                const taskSubs = subtasks?.filter((s) => s.task_id === tk.id) ?? [];
                const filteredSubs = filter === "all" ? taskSubs : taskSubs.filter((s) => s.status === filter);
                const isExpanded = expandedTasks.has(tk.id);
                const doneSubtasks = taskSubs.filter((s) => s.status === "done").length;

                return (
                  <div key={tk.id} data-task-row>
                    <div
                      data-list-row
                      className={`flex items-center gap-3 px-4 py-2.5 group/task${taskIdxById.get(tk.id) === focusIdx ? " focus-row" : ""}`}
                      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: tk }); }}
                    >
                      <Checkbox
                        checked={bulk.selected.has(tk.id)}
                        onChange={(e) => bulk.toggleItem(tk.id, e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0"
                      />
                      <IconButton
                        onClick={() => toggleTaskExpanded(tk.id)}
                        size="xs"
                        label={isExpanded ? t.collapse : t.expand}
                        icon={ChevronRight}
                        iconClassName={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                      <Checkbox
                        checked={tk.status === "done"}
                        onChange={(e) => {
                          if (e.target.checked) e.target.classList.add("check-pop");
                          const newStatus = tk.status === "done" ? "todo" : "done";
                          const willExit = filter !== "all" && newStatus !== filter;
                          if (willExit) {
                            const row = (e.target as HTMLElement).closest("[data-task-row]");
                            if (row) {
                              row.classList.add("task-exit");
                              setTimeout(() => {
                                updateTask.mutate({ id: tk.id, data: { status: newStatus } });
                              }, 450);
                              return;
                            }
                          }
                          updateTask.mutate({ id: tk.id, data: { status: newStatus } });
                        }}
                        onAnimationEnd={(e) => (e.target as HTMLElement).classList.remove("check-pop")}
                      />
                      {editingTask === tk.id ? (
                        <InlineRename
                          value={tk.title}
                          label={t.rename}
                          onSave={(title) => {
                            updateTask.mutate({ id: tk.id, data: { title } });
                            setEditingTask(null);
                          }}
                          onCancel={() => setEditingTask(null)}
                          className="flex-1 text-sm"
                        />
                      ) : (
                        <span
                          onDoubleClick={() => setEditingTask(tk.id)}
                          className={`flex-1 text-sm select-none ${
                            tk.status === "done" ? "line-through text-muted" : ""
                          }`}
                        >
                          {tk.title}
                        </span>
                      )}
                      {taskSubs.length > 0 && (
                        <span className="text-xs text-muted">
                          {doneSubtasks}/{taskSubs.length}
                        </span>
                      )}
                      <Select
                        value={tk.status}
                        onChange={(e) =>
                          updateTask.mutate({
                            id: tk.id,
                            data: { status: e.target.value as TaskStatus },
                          })
                        }
                        variant="bare"
                        fullWidth={false}
                        className={`${PILL} ${statusClasses(taskStatusVariant(tk.status))}`}
                      >
                        <option value="todo">{t.todo}</option>
                        <option value="done">{t.done}</option>
                      </Select>
                      <TaskDatePicker
                        dueDate={tk.due_date}
                        endDate={tk.end_date}
                        startTime={tk.start_time}
                        endTime={tk.end_time}
                        reminder={tk.reminder}
                        onChange={(vals) => updateTask.mutate({ id: tk.id, data: vals })}
                      />
                      <IconButton
                        icon={activeTimer?.taskId === tk.id ? ICONS.stopTimer : ICONS.startTimer}
                        label={activeTimer?.taskId === tk.id ? t.stop_timer : t.start_timer}
                        size="xs"
                        tone="accent"
                        color={activeTimer?.taskId === tk.id ? "danger" : undefined}
                        onClick={() => handleTimerToggle(tk.id, tk.project_id)}
                        className={
                          activeTimer?.taskId === tk.id
                            ? ""
                            : "opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100"
                        }
                      />
                      <IconButton size="xs"
                        onClick={() => deleteWithUndo(deleteTask, tk.id, t.toast_task_deleted)}
                        icon={ICONS.delete}
                        label={t.delete}
                        tone="danger"
                        reveal="task"
                      />
                    </div>
                    {isExpanded && (
                      <div className="ml-12 mr-4 border-l border-[var(--color-border-divider)] pl-3 pb-2 mb-1">
                        {filteredSubs.map((s) => (
                          <div key={s.id} data-task-row className="flex items-center gap-2 py-1 group/sub" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSubCtxMenu({ x: e.clientX, y: e.clientY, item: s }); }}>
                            <Checkbox
                              checked={s.status === "done"}
                              onChange={(e) => {
                                if (e.target.checked) e.target.classList.add("check-pop");
                                const newStatus = s.status === "done" ? "todo" : "done";
                                const willExit = filter !== "all" && newStatus !== filter;
                                if (willExit) {
                                  const row = (e.target as HTMLElement).closest("[data-task-row]");
                                  if (row) {
                                    row.classList.add("task-exit");
                                    setTimeout(() => {
                                      updateSubtask.mutate({ id: s.id, data: { status: newStatus } });
                                    }, 450);
                                    return;
                                  }
                                }
                                updateSubtask.mutate({ id: s.id, data: { status: newStatus } });
                              }}
                              onAnimationEnd={(e) => (e.target as HTMLElement).classList.remove("check-pop")}
                            />
                            {editingSubtask === s.id ? (
                              <InlineRename
                                value={s.title}
                                label={t.rename}
                                onSave={(title) => {
                                  updateSubtask.mutate({ id: s.id, data: { title } });
                                  setEditingSubtask(null);
                                }}
                                onCancel={() => setEditingSubtask(null)}
                                className="flex-1 text-xs"
                              />
                            ) : (
                              <span
                                onDoubleClick={() => setEditingSubtask(s.id)}
                                className={`flex-1 text-xs select-none ${
                                  s.status === "done" ? "line-through text-muted" : ""
                                }`}
                              >
                                {s.title}
                              </span>
                            )}
                            <TaskDatePicker
                              dueDate={s.due_date}
                              endDate={s.end_date}
                              startTime={s.start_time}
                              endTime={s.end_time}
                              reminder={s.reminder}
                              onChange={(vals) => updateSubtask.mutate({ id: s.id, data: vals })}
                            />
                            <IconButton size="xs"
                              onClick={() => deleteWithUndo(deleteSubtask, s.id, t.toast_subtask_deleted)}
                              icon={ICONS.delete}
                              label={t.delete}
                              tone="danger"
                              reveal="sub"
                            />
                          </div>
                        ))}
                        <AddRow
                          className="mt-1"
                          placeholder={t.new_subtask}
                          onAdd={(title) =>
                            createSubtask.mutateAsync({
                              task_id: tk.id,
                              title,
                              status: "todo",
                              due_date: null,
                              end_date: null,
                              start_time: null,
                              end_time: null,
                              reminder: null,
                              sort_order: taskSubs.length,
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>}
            {!collapsedProjects.has(g.projectId) && (
              <AddRow
                className="px-4 py-2 border-t border-[var(--color-border-divider)]"
                placeholder={t.new_task}
                onAdd={(title) => {
                  // A second Enter while the first create is in flight adds nothing.
                  if (createTask.isPending) return false;
                  return createTask.mutateAsync({
                    project_id: g.projectId,
                    title,
                    description: "",
                    status: "todo",
                    priority: "low",
                    due_date: null,
                    end_date: null,
                    start_time: null,
                    end_time: null,
                    reminder: null,
                    scheduled_start: null,
                    scheduled_end: null,
                    notes: "",
                    sort_order: g.tasks.length,
                  });
                }}
              />
            )}
            </>)}
          </SortableProjectGroup>
        ))}
        {grouped.length === 0 && (tasks.length === 0 ? (
          <EmptyState
            icon={ICONS.task}
            message={t.no_tasks_yet}
            hint={t.no_tasks_yet_hint}
            action={
              activeProjects.length > 0 ? (
                <Dropdown
                  trigger={<Button icon={ICONS.add}>{t.new_task}</Button>}
                  items={activeProjects.map((p) => ({ label: p.name, onSelect: () => setStartProjectId(p.id) }))}
                />
              ) : (
                <Button icon={ICONS.add} onClick={() => navigate("/projects")}>{t.new_project}</Button>
              )
            }
          />
        ) : (
          <NoResults message={t.no_matching_tasks} onClear={clearFilters} />
        ))}
      </div>
      </SortableContext>
      </DndContext>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: ctxMenu.item.status === "done" ? t.todo : t.done, onClick: () => updateTask.mutate({ id: ctxMenu.item.id, data: { status: ctxMenu.item.status === "done" ? "todo" : "done" } }) },
            { label: t.open_in_new_tab, icon: ICONS.newTab, onClick: () => openTab(`/projects/${ctxMenu.item.project_id}`, projectName(ctxMenu.item.project_id)) },
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: ICONS.delete, danger: true, onClick: () => deleteWithUndo(deleteTask, ctxMenu.item.id, t.toast_task_deleted) },
          ]}
        />
      )}
      {subCtxMenu && (
        <ContextMenu
          x={subCtxMenu.x}
          y={subCtxMenu.y}
          onClose={() => setSubCtxMenu(null)}
          items={[
            { label: subCtxMenu.item.status === "done" ? t.todo : t.done, onClick: () => updateSubtask.mutate({ id: subCtxMenu.item.id, data: { status: subCtxMenu.item.status === "done" ? "todo" : "done" } }) },
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: ICONS.delete, danger: true, onClick: () => deleteWithUndo(deleteSubtask, subCtxMenu.item.id, t.toast_subtask_deleted) },
          ]}
        />
      )}
      {headerCtxMenu && (
        <ContextMenu
          x={headerCtxMenu.x}
          y={headerCtxMenu.y}
          onClose={() => setHeaderCtxMenu(null)}
          items={[
            { label: t.open_in_new_tab, icon: ICONS.newTab, onClick: () => openTab(`/projects/${headerCtxMenu.item.projectId}`, headerCtxMenu.item.projectName) },
          ]}
        />
      )}
      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.mark_done, icon: ICONS.markDone, onClick: bulkMarkDone },
          { label: t.delete, icon: ICONS.delete, onClick: bulkDelete, danger: true },
        ]}
      />
    </div>
  );
}

type SortableReturn = ReturnType<typeof useSortable>;

function SortableProjectGroup({ id, children }: { id: number; children: (dragHandleProps: { attributes: SortableReturn["attributes"]; listeners: SortableReturn["listeners"] }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg overflow-hidden">
      {children({ attributes, listeners })}
    </div>
  );
}
