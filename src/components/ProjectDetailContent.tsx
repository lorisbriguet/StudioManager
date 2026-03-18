import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Plus, ChevronRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useProject, useUpdateProject } from "../db/hooks/useProjects";
import { useClient } from "../db/hooks/useClients";
import {
  useTasksByProject,
  useCreateTask,
  useUpdateTask,
  useSubtasksByProject,
  useCreateSubtask,
  useUpdateSubtask,
  useDeleteTask,
  useDeleteSubtask,
} from "../db/hooks/useTasks";
import { TaskDatePicker } from "./TaskDatePicker";
import type { ProjectStatus } from "../types/project";
import { effectivePriority, type TaskPriority } from "../types/task";
import { useT } from "../i18n/useT";

interface Props {
  projectId: number;
  compact?: boolean;
}

export function ProjectDetailContent({ projectId, compact }: Props) {
  const { data: project, isLoading } = useProject(projectId);
  const { data: client } = useClient(project?.client_id ?? "");
  const { data: tasks } = useTasksByProject(projectId);
  const updateProject = useUpdateProject();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const { data: allSubtasks } = useSubtasksByProject(projectId);
  const createSubtask = useCreateSubtask();
  const updateSubtask = useUpdateSubtask();
  const deleteTask = useDeleteTask();
  const deleteSubtask = useDeleteSubtask();

  const [status, setStatus] = useState<ProjectStatus>("active");
  const [newTask, setNewTask] = useState("");
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const [newSubtaskText, setNewSubtaskText] = useState<Record<number, string>>({});
  const [editingTask, setEditingTask] = useState<number | null>(null);
  const [editingSubtask, setEditingSubtask] = useState<number | null>(null);
  const [taskFilter, setTaskFilter] = useState<"todo" | "done" | "all">("todo");
  const t = useT();

  useEffect(() => {
    if (project) setStatus(project.status);
  }, [project]);

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;
  if (!project) return <div className="text-muted text-sm">{t.no_projects}</div>;

  const totalCount = tasks?.length ?? 0;
  // Weighted progress: each task = 1/totalTasks weight, subdivided by subtasks
  const progress = (() => {
    if (!tasks || tasks.length === 0) return 0;
    const weight = 1 / tasks.length;
    let sum = 0;
    for (const tk of tasks) {
      const subs = allSubtasks?.filter((s) => s.task_id === tk.id) ?? [];
      if (subs.length === 0) {
        if (tk.status === "done") sum += weight;
      } else {
        const doneSubs = subs.filter((s) => s.status === "done").length;
        sum += weight * (doneSubs / subs.length);
      }
    }
    return Math.round(sum * 100);
  })();

  const addTask = () => {
    if (!newTask.trim()) return;
    createTask.mutate(
      {
        project_id: projectId,
        title: newTask.trim(),
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
        sort_order: totalCount,
      },
      { onSuccess: () => setNewTask("") }
    );
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h2 className={compact ? "text-base font-semibold" : "text-xl font-semibold"}>
            {project.name}
          </h2>
          {client && (
            <Link to={`/clients/${client.id}`} className="text-xs text-muted hover:text-accent">
              {client.name}
            </Link>
          )}
        </div>
        <select
          value={status}
          onChange={(e) => {
            const v = e.target.value as ProjectStatus;
            setStatus(v);
            updateProject.mutate(
              { id: projectId, data: { status: v } },
              { onSuccess: () => toast.success(t.toast_status_updated) }
            );
          }}
          className="border border-gray-200 rounded-md px-2 py-1 text-xs"
        >
          <option value="active">{t.active}</option>
          <option value="completed">{t.completed}</option>
          <option value="on_hold">{t.on_hold}</option>
          <option value="cancelled">{t.cancelled}</option>
        </select>
      </div>

      <div className="flex items-center gap-4 mb-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted">{t.start}</span>
          <input
            type="date"
            value={project.start_date ?? ""}
            onChange={(e) =>
              updateProject.mutate({
                id: projectId,
                data: { start_date: e.target.value || null },
              })
            }
            className="border border-gray-200 rounded px-2 py-1 text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted">{t.deadline}</span>
          <input
            type="date"
            value={project.deadline ?? ""}
            onChange={(e) =>
              updateProject.mutate({
                id: projectId,
                data: { deadline: e.target.value || null },
              })
            }
            className="border border-gray-200 rounded px-2 py-1 text-xs"
          />
        </div>
      </div>

      {totalCount > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-muted mb-1">
            <span>{t.progress}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="mb-4">
        <textarea
          placeholder={t.notes}
          defaultValue={project.notes ?? ""}
          onBlur={(e) => {
            const val = e.target.value;
            if (val !== (project.notes ?? "")) {
              updateProject.mutate({ id: projectId, data: { notes: val } });
            }
          }}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-vertical min-h-[60px] max-h-[60vh] placeholder:text-muted"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
      </div>

      <div className="border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">{t.tasks}</h3>
          <div className="flex gap-1">
            {(["todo", "done", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setTaskFilter(f)}
                className={`px-2 py-0.5 text-[11px] rounded-full border ${
                  taskFilter === f
                    ? "bg-accent text-white border-accent"
                    : "border-gray-200 text-muted hover:bg-gray-50"
                }`}
              >
                {f === "todo" ? t.todo : f === "done" ? t.done : t.all}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 mb-3">
          <input
            placeholder={t.new_task}
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTask();
            }}
            className="flex-1 border border-gray-200 rounded-md px-3 py-1.5 text-sm"
          />
          <button onClick={addTask} className="p-1.5 text-muted hover:text-accent">
            <Plus size={18} />
          </button>
        </div>

        <div className="space-y-0.5">
          {tasks?.filter((tk) => taskFilter === "all" ? true : taskFilter === "done" ? tk.status === "done" : tk.status !== "done").map((tk) => {
            const subtasks = allSubtasks?.filter((s) => s.task_id === tk.id) ?? [];
            const filteredSubtasks = taskFilter === "all" ? subtasks : subtasks.filter((s) => taskFilter === "done" ? s.status === "done" : s.status !== "done");
            const isExpanded = expandedTasks.has(tk.id);
            const doneSubtasks = subtasks.filter((s) => s.status === "done").length;

            return (
              <div key={tk.id}>
                <div className="flex items-center gap-2 py-1.5 group/task">
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
                  {subtasks.length > 0 && (
                    <span className="text-xs text-muted">
                      {doneSubtasks}/{subtasks.length}
                    </span>
                  )}
                  <PriorityBadge
                    priority={effectivePriority(tk.priority, tk.due_date, tk.end_date)}
                    onClick={() => {
                      const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(tk.priority) + 1) % PRIORITY_CYCLE.length];
                      updateTask.mutate({ id: tk.id, data: { priority: next } });
                    }}
                  />
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
                  <div className="ml-9 border-l border-gray-200 pl-3 pb-1">
                    {filteredSubtasks.map((s) => (
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
                                sort_order: subtasks.length,
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
                              sort_order: subtasks.length,
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
          {(!tasks || tasks.length === 0) && (
            <div className="text-sm text-muted py-4 text-center">{t.no_tasks_yet}</div>
          )}
        </div>
      </div>
    </div>
  );
}

const PRIORITY_CYCLE: TaskPriority[] = ["low", "medium", "high"];

function PriorityBadge({ priority, onClick }: { priority: TaskPriority; onClick?: () => void }) {
  const colors: Record<TaskPriority, string> = {
    high: "text-red-600",
    medium: "text-yellow-600",
    low: "text-gray-400",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs cursor-pointer hover:opacity-70 ${colors[priority]}`}
      title={`Priority: ${priority}`}
    >
      {priority === "high" ? "!!!" : priority === "medium" ? "!!" : "!"}
    </button>
  );
}
