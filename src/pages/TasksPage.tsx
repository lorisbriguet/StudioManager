import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Search, ChevronRight, Plus, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAllTasks, useUpdateTask, useCreateTask, useDeleteTask, useCreateSubtask, useUpdateSubtask, useDeleteSubtask } from "../db/hooks/useTasks";
import { getAllSubtasks } from "../db/queries/tasks";
import { useQuery } from "@tanstack/react-query";
import { useProjects } from "../db/hooks/useProjects";
import { useClients } from "../db/hooks/useClients";
import { TaskDatePicker } from "../components/TaskDatePicker";
import { useT } from "../i18n/useT";
import type { TaskStatus } from "../types/task";

const statusColors: Record<TaskStatus, string> = {
  todo: "!bg-yellow-100 !text-yellow-700 dark:!bg-yellow-900/40 dark:!text-yellow-300",
  done: "!bg-green-100 !text-green-700 dark:!bg-green-900/40 dark:!text-green-300",
};

export function TasksPage() {
  const t = useT();
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
  const [filter, setFilter] = useState<TaskStatus | "all">("todo");
  const [search, setSearch] = useState("");
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const [newSubtaskText, setNewSubtaskText] = useState<Record<number, string>>({});
  const [newTaskText, setNewTaskText] = useState<Record<number, string>>({});
  const [editingTask, setEditingTask] = useState<number | null>(null);
  const [editingSubtask, setEditingSubtask] = useState<number | null>(null);
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

  const projectName = (projectId: number) =>
    projects?.find((p) => p.id === projectId)?.name ?? "";

  const clientForProject = (projectId: number) => {
    const project = projects?.find((p) => p.id === projectId);
    if (!project) return "";
    return clients?.find((c) => c.id === project.client_id)?.name ?? "";
  };

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
  }, [tasks, projects, clients, filter, search, projectOrder]);

  const moveProject = (projectId: number, direction: -1 | 1) => {
    const ids = grouped.map((g) => g.projectId);
    const idx = ids.indexOf(projectId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= ids.length) return;
    ids.splice(idx, 1);
    ids.splice(newIdx, 0, projectId);
    setProjectOrder(ids);
    localStorage.setItem("tasksProjectOrder", JSON.stringify(ids));
  };

  const statusTabs: { value: TaskStatus | "all"; label: string }[] = [
    { value: "all", label: t.all },
    { value: "todo", label: t.todo },
    { value: "done", label: t.done },
  ];

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">{t.tasks}</h1>

      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-2">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-3 py-1 text-xs rounded-full border ${
                filter === tab.value
                  ? "bg-accent text-white border-accent"
                  : "border-gray-200 text-muted hover:bg-gray-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Search size={16} className="text-muted" />
          <input
            placeholder={t.search_tasks}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-200 rounded-md px-3 py-1.5 text-sm w-64"
          />
        </div>
      </div>

      <div className="space-y-4">
        {grouped.map((g, gi) => (
          <div
            key={g.projectId}
            className="border border-gray-200 rounded-lg overflow-hidden"
          >
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center gap-2">
              <div className="flex flex-col shrink-0 -my-1">
                <button
                  onClick={(e) => { e.stopPropagation(); moveProject(g.projectId, -1); }}
                  disabled={gi === 0}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-default p-0 leading-none"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); moveProject(g.projectId, 1); }}
                  disabled={gi === grouped.length - 1}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-default p-0 leading-none"
                >
                  <ArrowDown size={12} />
                </button>
              </div>
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
            {!collapsedProjects.has(g.projectId) && <div className="divide-y divide-gray-100">
              {g.tasks.map((tk) => {
                const taskSubs = subtasks?.filter((s) => s.task_id === tk.id) ?? [];
                const filteredSubs = filter === "all" ? taskSubs : taskSubs.filter((s) => s.status === filter);
                const isExpanded = expandedTasks.has(tk.id);
                const doneSubtasks = taskSubs.filter((s) => s.status === "done").length;

                return (
                  <div key={tk.id}>
                    <div className="flex items-center gap-3 px-4 py-2.5 group/task">
                      <button
                        onClick={() => {
                          const next = new Set(expandedTasks);
                          next.has(tk.id) ? next.delete(tk.id) : next.add(tk.id);
                          setExpandedTasks(next);
                        }}
                        className="text-muted hover:text-gray-700 p-0.5"
                      >
                        <ChevronRight
                          size={14}
                          className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        />
                      </button>
                      <input
                        type="checkbox"
                        checked={tk.status === "done"}
                        onChange={() =>
                          updateTask.mutate({
                            id: tk.id,
                            data: { status: tk.status === "done" ? "todo" : "done" },
                          })
                        }
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
                          className="flex-1 text-sm border border-gray-200 rounded px-1 py-0.5"
                        />
                      ) : (
                        <span
                          onDoubleClick={() => setEditingTask(tk.id)}
                          className={`flex-1 text-sm cursor-text ${
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
                        className={`px-2 py-1 text-xs rounded-full border-0 appearance-none cursor-pointer ${statusColors[tk.status]}`}
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
                      <div className="ml-12 mr-4 border-l border-gray-200 pl-3 pb-2 mb-1">
                        {filteredSubs.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 py-1 group/sub">
                            <input
                              type="checkbox"
                              checked={s.status === "done"}
                              onChange={() =>
                                updateSubtask.mutate({
                                  id: s.id,
                                  data: { status: s.status === "done" ? "todo" : "done" },
                                })
                              }
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
                                className="flex-1 text-xs border border-gray-200 rounded px-1 py-0.5"
                              />
                            ) : (
                              <span
                                onDoubleClick={() => setEditingSubtask(s.id)}
                                className={`flex-1 text-xs cursor-text ${
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
                            className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs"
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
            {!collapsedProjects.has(g.projectId) && <div className="flex gap-2 px-4 py-2 border-t border-gray-100">
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
                        priority: "medium",
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
                className="flex-1 border border-gray-200 rounded-md px-3 py-1.5 text-sm"
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
                      priority: "medium",
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
                <Plus size={18} />
              </button>
            </div>}
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="text-sm text-muted text-center py-8">
            {search ? t.no_matching_tasks : t.no_tasks_yet}
          </div>
        )}
      </div>
    </div>
  );
}
