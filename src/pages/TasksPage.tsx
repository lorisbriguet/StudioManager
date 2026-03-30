import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Plus, GripVertical, Trash2, ExternalLink, Play, Square, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { undoable } from "../lib/undo";
import { ask } from "@tauri-apps/plugin-dialog";
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
import { useAllTasks, useUpdateTask, useCreateTask, useDeleteTask, useCreateSubtask, useUpdateSubtask, useDeleteSubtask } from "../db/hooks/useTasks";
import { getAllSubtasks } from "../db/queries/tasks";
import { useQuery } from "@tanstack/react-query";
import { useProjects } from "../db/hooks/useProjects";
import { useClients } from "../db/hooks/useClients";
import { TaskDatePicker } from "../components/TaskDatePicker";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { BulkActionBar } from "../components/BulkActionBar";
import { SavedFilterBar } from "../components/SavedFilterBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { useTabStore } from "../stores/tab-store";
import { useTimerActions } from "../hooks/useTimerActions";
import { useT } from "../i18n/useT";
import { PageHeader, SearchBar, PageSpinner, EmptyState } from "../components/ui";
import { taskStatusVariant, statusClasses } from "../lib/statusColors";
import type { Task, Subtask, TaskStatus } from "../types/task";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";

export function TasksPage() {
  const t = useT();
  const openTab = useTabStore((s) => s.openTab);
  const { data: tasks, isLoading } = useAllTasks();
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
  const [newSubtaskText, setNewSubtaskText] = useState<Record<number, string>>({});
  const [newTaskText, setNewTaskText] = useState<Record<number, string>>({});
  const [editingTask, setEditingTask] = useState<number | null>(null);
  const [editingSubtask, setEditingSubtask] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<Task> | null>(null);
  const [subCtxMenu, setSubCtxMenu] = useState<ContextMenuState<Subtask> | null>(null);
  const [headerCtxMenu, setHeaderCtxMenu] = useState<ContextMenuState<{ projectId: number; projectName: string }> | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("tasksCollapsedProjects");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [projectOrder, setProjectOrder] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem("tasksProjectOrder");
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const projectsMap = useMemo(() => new Map(projects?.map((p) => [p.id, p]) ?? []), [projects]);
  const clientsMap = useMemo(() => new Map(clients?.map((c) => [c.id, c.name]) ?? []), [clients]);

  const projectName = (projectId: number) =>
    projectsMap.get(projectId)?.name ?? "";

  const clientForProject = (projectId: number) => {
    const project = projectsMap.get(projectId);
    if (!project) return "";
    return clientsMap.get(project.client_id) ?? "";
  };

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
  }, [tasks, projects, clients, filter, search, projectOrder, filterConditions, filterLogic]);

  const flatTasks = useMemo(() => grouped.flatMap((g) => g.tasks), [grouped]);
  const bulk = useBulkSelect(flatTasks);

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

  const bulkDelete = useCallback(async () => {
    if (!(await ask(t.confirm_bulk_delete, { kind: "warning" }))) return;
    const ids = [...bulk.selected] as number[];
    ids.forEach((id) => deleteTask.mutate(id));
    bulk.clearSelection();
  }, [bulk, deleteTask, t]);

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
      localStorage.setItem("tasksProjectOrder", JSON.stringify(ids));
    },
    [grouped]
  );

  const statusTabs: { value: TaskStatus | "all"; label: string }[] = [
    { value: "all", label: t.all },
    { value: "todo", label: t.todo },
    { value: "done", label: t.done },
  ];

  if (isLoading) return <PageSpinner />;

  return (
    <div>
      <PageHeader title={t.tasks} />

      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-2">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setFilter(tab.value); setActiveFilterId(null); setFilterConditions([]); }}
              className={`px-3 py-1 text-xs rounded-full border ${
                filter === tab.value
                  ? "bg-accent text-white border-accent"
                  : "border-[var(--color-input-border)] text-muted hover:bg-[var(--color-hover-row)]"
              }`}
            >
              {tab.label}
            </button>
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
              className="px-4 py-2 border-b border-[var(--color-border-header)] flex items-center gap-2 select-none"
              onContextMenu={(e) => { e.preventDefault(); setHeaderCtxMenu({ x: e.clientX, y: e.clientY, item: { projectId: g.projectId, projectName: g.projectName } }); }}
            >
              <DragHandle attributes={attributes} listeners={listeners} />
              <button
                onClick={() => {
                  const next = new Set(collapsedProjects);
                  next.has(g.projectId) ? next.delete(g.projectId) : next.add(g.projectId);
                  setCollapsedProjects(next);
                  localStorage.setItem("tasksCollapsedProjects", JSON.stringify([...next]));
                }}
                className="flex items-center gap-2 flex-1 text-left"
              >
              <ChevronRight
                size={14}
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
                      className="flex items-center gap-3 px-4 py-2.5 group/task"
                      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: tk }); }}
                    >
                      <input
                        type="checkbox"
                        checked={bulk.selected.has(tk.id)}
                        onChange={(e) => bulk.toggleItem(tk.id, e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-[var(--accent)] shrink-0"
                      />
                      <button
                        onClick={() => {
                          const next = new Set(expandedTasks);
                          next.has(tk.id) ? next.delete(tk.id) : next.add(tk.id);
                          setExpandedTasks(next);
                        }}
                        className="text-muted hover:text-[var(--color-text-secondary)] p-0.5"
                      >
                        <ChevronRight
                          size={14}
                          className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        />
                      </button>
                      <input
                        type="checkbox"
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
                        className="rounded"
                      />
                      {editingTask === tk.id ? (
                        <input
                          autoFocus
                          defaultValue={tk.title}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val && val !== tk.title) {
                              updateTask.mutate({ id: tk.id, data: { title: val } });
                            }
                            setEditingTask(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditingTask(null);
                          }}
                          className="flex-1 text-sm border border-[var(--color-input-border)] rounded px-1 py-0.5"
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
                      <select
                        value={tk.status}
                        onChange={(e) =>
                          updateTask.mutate({
                            id: tk.id,
                            data: { status: e.target.value as TaskStatus },
                          })
                        }
                        className={`px-2 py-1 text-xs rounded-full border-0 appearance-none cursor-pointer ${statusClasses(taskStatusVariant(tk.status))}`}
                      >
                        <option value="todo">{t.todo}</option>
                        <option value="done">{t.done}</option>
                      </select>
                      <TaskDatePicker
                        dueDate={tk.due_date}
                        endDate={tk.end_date}
                        startTime={tk.start_time}
                        endTime={tk.end_time}
                        reminder={tk.reminder}
                        onChange={(vals) => updateTask.mutate({ id: tk.id, data: vals })}
                        compact
                      />
                      <button
                        onClick={() => handleTimerToggle(tk.id, tk.project_id)}
                        className={`p-0.5 transition-opacity ${
                          activeTimer?.taskId === tk.id
                            ? "text-red-500"
                            : "opacity-0 group-hover/task:opacity-100 text-muted hover:text-accent"
                        }`}
                        title={activeTimer?.taskId === tk.id ? t.stop_timer : t.start_timer}
                      >
                        {activeTimer?.taskId === tk.id ? <Square size={14} /> : <Play size={14} />}
                      </button>
                      <button
                        onClick={() => deleteTask.mutate(tk.id, {
                          onSuccess: () => toast.success(t.toast_task_deleted),
                        })}
                        className="opacity-0 group-hover/task:opacity-100 text-muted hover:text-red-600 transition-opacity p-0.5"
                        title={t.delete}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="ml-12 mr-4 border-l border-[var(--color-border-divider)] pl-3 pb-2 mb-1">
                        {filteredSubs.map((s) => (
                          <div key={s.id} data-task-row className="flex items-center gap-2 py-1 group/sub" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSubCtxMenu({ x: e.clientX, y: e.clientY, item: s }); }}>
                            <input
                              type="checkbox"
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
                              className="rounded"
                            />
                            {editingSubtask === s.id ? (
                              <input
                                autoFocus
                                defaultValue={s.title}
                                onBlur={(e) => {
                                  const val = e.target.value.trim();
                                  if (val && val !== s.title) {
                                    updateSubtask.mutate({ id: s.id, data: { title: val } });
                                  }
                                  setEditingSubtask(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  if (e.key === "Escape") setEditingSubtask(null);
                                }}
                                className="flex-1 text-xs border border-[var(--color-input-border)] rounded px-1 py-0.5"
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
                              compact
                            />
                            <button
                              onClick={() => deleteSubtask.mutate(s.id, {
                                onSuccess: () => toast.success(t.toast_subtask_deleted),
                              })}
                              className="opacity-0 group-hover/sub:opacity-100 text-muted hover:text-red-600 transition-opacity p-0.5"
                              title={t.delete}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-1.5 mt-1">
                          <input
                            placeholder={t.new_subtask}
                            value={newSubtaskText[tk.id] ?? ""}
                            onChange={(e) =>
                              setNewSubtaskText({ ...newSubtaskText, [tk.id]: e.target.value })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const text = (newSubtaskText[tk.id] ?? "").trim();
                                if (!text) return;
                                createSubtask.mutate(
                                  {
                                    task_id: tk.id,
                                    title: text,
                                    status: "todo",
                                    due_date: null,
                                    end_date: null,
                                    start_time: null,
                                    end_time: null,
                                    reminder: null,
                                    sort_order: taskSubs.length,
                                  },
                                  {
                                    onSuccess: () =>
                                      setNewSubtaskText({ ...newSubtaskText, [tk.id]: "" }),
                                    onError: (err) =>
                                      toast.error(`Failed to create subtask: ${String(err)}`),
                                  }
                                );
                              }
                            }}
                            className="flex-1 border border-[var(--color-input-border)] rounded px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() => {
                              const text = (newSubtaskText[tk.id] ?? "").trim();
                              if (!text) return;
                              createSubtask.mutate(
                                {
                                  task_id: tk.id,
                                  title: text,
                                  status: "todo",
                                  due_date: null,
                                  end_date: null,
                                  start_time: null,
                                  end_time: null,
                                  reminder: null,
                                  sort_order: taskSubs.length,
                                },
                                {
                                  onSuccess: () =>
                                    setNewSubtaskText({ ...newSubtaskText, [tk.id]: "" }),
                                  onError: (err) =>
                                    toast.error(`Failed to create subtask: ${String(err)}`),
                                }
                              );
                            }}
                            className="p-1 text-muted hover:text-accent"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>}
            {!collapsedProjects.has(g.projectId) && <div className="flex gap-2 px-4 py-2 border-t border-[var(--color-border-divider)]">
              <input
                placeholder={t.new_task}
                value={newTaskText[g.projectId] ?? ""}
                onChange={(e) =>
                  setNewTaskText({ ...newTaskText, [g.projectId]: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const text = (newTaskText[g.projectId] ?? "").trim();
                    if (!text) return;
                    createTask.mutate(
                      {
                        project_id: g.projectId,
                        title: text,
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
                      },
                      {
                        onSuccess: () =>
                          setNewTaskText({ ...newTaskText, [g.projectId]: "" }),
                      }
                    );
                  }
                }}
                className="flex-1 border border-[var(--color-input-border)] rounded-md px-3 py-1.5 text-sm"
              />
              <button
                onClick={() => {
                  const text = (newTaskText[g.projectId] ?? "").trim();
                  if (!text) return;
                  createTask.mutate(
                    {
                      project_id: g.projectId,
                      title: text,
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
                    },
                    {
                      onSuccess: () =>
                        setNewTaskText({ ...newTaskText, [g.projectId]: "" }),
                    }
                  );
                }}
                className="p-1.5 text-muted hover:text-accent"
              >
                <Plus size={16} />
              </button>
            </div>}
            </>)}
          </SortableProjectGroup>
        ))}
        {grouped.length === 0 && !isLoading && (
          <EmptyState message={search ? t.no_matching_tasks : (t.no_tasks ?? "No tasks found")} icon={<CheckCircle size={32} />} />
        )}
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
            { label: t.open_in_new_tab, icon: <ExternalLink size={14} />, onClick: () => openTab(`/projects/${ctxMenu.item.project_id}`, projectName(ctxMenu.item.project_id)) },
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteTask.mutate(ctxMenu.item.id) },
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
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteSubtask.mutate(subCtxMenu.item.id) },
          ]}
        />
      )}
      {headerCtxMenu && (
        <ContextMenu
          x={headerCtxMenu.x}
          y={headerCtxMenu.y}
          onClose={() => setHeaderCtxMenu(null)}
          items={[
            { label: t.open_in_new_tab, icon: <ExternalLink size={14} />, onClick: () => openTab(`/projects/${headerCtxMenu.item.projectId}`, headerCtxMenu.item.projectName) },
          ]}
        />
      )}
      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.mark_done, icon: <CheckCircle size={14} />, onClick: bulkMarkDone },
          { label: t.delete, icon: <Trash2 size={14} />, onClick: bulkDelete, danger: true },
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

function DragHandle({ attributes, listeners }: { attributes: SortableReturn["attributes"]; listeners: SortableReturn["listeners"] }) {
  const t = useT();
  return (
    <div
      {...attributes}
      {...listeners}
      className="cursor-grab text-muted hover:text-[var(--color-text-secondary)] shrink-0 -my-1 p-0.5"
      aria-label={t.drag_to_reorder}
    >
      <GripVertical size={14} />
    </div>
  );
}
