import { useState, useCallback } from "react";
import { ChevronRight, Trash2, Play, Square, Plus } from "lucide-react";
import { toast } from "sonner";
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
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  useCreateTask,
  useUpdateTask,
  useCreateSubtask,
  useUpdateSubtask,
  useDeleteTask,
  useDeleteSubtask,
  useReorderSubtasks,
} from "../../db/hooks/useTasks";
import { TaskDatePicker } from "../TaskDatePicker";
import { effectivePriority, type TaskPriority } from "../../types/task";
import { useTimerActions } from "../../hooks/useTimerActions";
import { useT } from "../../i18n/useT";
import { PriorityBadge } from "./PriorityBadge";
import { SortableSubtaskRow } from "./SortableSubtaskRow";
import { IconButton, FilterChip, Input } from "../ui";

export function ProjectTasksSection({ projectId, project, tasks, allSubtasks }: {
  projectId: number;
  project: { name: string };
  tasks: import("../../types/task").Task[];
  allSubtasks: import("../../types/task").Subtask[];
  compact?: boolean;
}) {
  const t = useT();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const createSubtask = useCreateSubtask();
  const updateSubtask = useUpdateSubtask();
  const deleteSubtask = useDeleteSubtask();
  const reorderSubtasks = useReorderSubtasks();
  const { activeTimer, toggleTimer } = useTimerActions();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const [taskFilter, setTaskFilter] = useState<"todo" | "done" | "all">("todo");
  const [newTask, setNewTask] = useState("");
  const [expandedTasks, setExpandedTasks] = useState<Set<number>>(new Set());
  const [newSubtaskText, setNewSubtaskText] = useState<Record<number, string>>({});
  const [editingTask, setEditingTask] = useState<number | null>(null);
  const [editingSubtask, setEditingSubtask] = useState<number | null>(null);
  const [hoveredSubtask, setHoveredSubtask] = useState<number | null>(null);

  const totalCount = tasks.length;

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

  const handleTimerToggle = useCallback(async (taskId: number) => {
    await toggleTimer(taskId, projectId, project.name);
  }, [toggleTimer, projectId, project.name]);

  return (
    <div>
      <div className="flex justify-end mb-2">
        <div className="flex gap-1">
          {(["todo", "done", "all"] as const).map((f) => (
            <FilterChip key={f} active={taskFilter === f} onClick={() => setTaskFilter(f)}>
              {f === "todo" ? t.todo : f === "done" ? t.done : t.all}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <Input
          fullWidth={false}
          placeholder={t.new_task}
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
          className="flex-1"
        />
        <IconButton icon={Plus} label={t.new_task} size="md" tone="accent" onClick={addTask} />
      </div>

      <div className="space-y-0.5">
        {tasks.filter((tk) => taskFilter === "all" ? true : taskFilter === "done" ? tk.status === "done" : tk.status !== "done").map((tk) => {
          const subtasks = allSubtasks.filter((s) => s.task_id === tk.id);
          const filteredSubtasks = taskFilter === "all" ? subtasks : subtasks.filter((s) => taskFilter === "done" ? s.status === "done" : s.status !== "done");
          const isExpanded = expandedTasks.has(tk.id);
          const doneSubtasks = subtasks.filter((s) => s.status === "done").length;

          return (
            <div key={tk.id}>
              <div className="flex items-center gap-2 py-1.5 group/task">
                <IconButton
                  onClick={() => {
                    const next = new Set(expandedTasks);
                    if (next.has(tk.id)) next.delete(tk.id);
                    else next.add(tk.id);
                    setExpandedTasks(next);
                  }}
                  size="xs"
                  iconSize={14}
                  label={isExpanded ? t.collapse : t.expand}
                  icon={ChevronRight}
                  iconClassName={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
                <input
                  type="checkbox"
                  checked={tk.status === "done"}
                  onChange={(e) => {
                    if (e.target.checked) e.target.classList.add("check-pop");
                    updateTask.mutate({ id: tk.id, data: { status: tk.status === "done" ? "todo" : "done" } });
                  }}
                  onAnimationEnd={(e) => (e.target as HTMLElement).classList.remove("check-pop")}
                  className="rounded"
                />
                {editingTask === tk.id ? (
                  <Input
                    variant="inline"
                    fullWidth={false}
                    autoFocus
                    defaultValue={tk.title}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val && val !== tk.title) updateTask.mutate({ id: tk.id, data: { title: val } });
                      setEditingTask(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingTask(null);
                    }}
                    className="flex-1"
                  />
                ) : (
                  <span
                    onDoubleClick={() => setEditingTask(tk.id)}
                    className={`flex-1 text-sm cursor-text ${tk.status === "done" ? "line-through text-muted" : ""}`}
                  >
                    {tk.title}
                  </span>
                )}
                {subtasks.length > 0 && <span className="text-xs text-muted">{doneSubtasks}/{subtasks.length}</span>}
                <PriorityBadge
                  priority={effectivePriority(tk.priority, tk.due_date, tk.end_date)}
                  onClick={() => {
                    const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(tk.priority) + 1) % PRIORITY_CYCLE.length];
                    updateTask.mutate({ id: tk.id, data: { priority: next } });
                  }}
                />
                <TaskDatePicker
                  dueDate={tk.due_date} endDate={tk.end_date} startTime={tk.start_time}
                  endTime={tk.end_time} reminder={tk.reminder}
                  onChange={(vals) => updateTask.mutate({ id: tk.id, data: vals })}
                  compact
                />
                <button
                  onClick={() => handleTimerToggle(tk.id)}
                  className={`shrink-0 p-0.5 transition-opacity ${
                    activeTimer?.taskId === tk.id
                      ? "text-[var(--color-danger-text)]"
                      : "opacity-0 pointer-events-none group-hover/task:opacity-100 group-hover/task:pointer-events-auto text-muted hover:text-accent"
                  }`}
                  title={activeTimer?.taskId === tk.id ? t.stop_timer : t.start_timer}
                  aria-label={activeTimer?.taskId === tk.id ? t.stop_timer : t.start_timer}
                >
                  {activeTimer?.taskId === tk.id ? <Square size={14} /> : <Play size={14} />}
                </button>
                <IconButton
                  icon={Trash2}
                  label={t.delete}
                  tone="danger"
                  onClick={() => deleteTask.mutate(tk.id, { onSuccess: () => toast.success(t.toast_task_deleted) })}
                  className="opacity-0 pointer-events-none group-hover/task:opacity-100 group-hover/task:pointer-events-auto"
                />
              </div>
              {isExpanded && (
                <div className="ml-9 border-l border-[var(--color-border-divider)] pl-3 pb-1">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setHoveredSubtask(null)} onDragEnd={(event: DragEndEvent) => {
                    // Rows move under a stationary cursor — clear the hover
                    // state so no handle sticks around (#335)
                    setHoveredSubtask(null);
                    const { active, over } = event;
                    if (!over || active.id === over.id) return;
                    const ids = subtasks.map((s) => s.id);
                    const fromIdx = ids.indexOf(Number(active.id));
                    const toIdx = ids.indexOf(Number(over.id));
                    if (fromIdx !== -1 && toIdx !== -1) {
                      ids.splice(fromIdx, 1);
                      ids.splice(toIdx, 0, Number(active.id));
                      reorderSubtasks.mutate(ids);
                    }
                  }}>
                  <SortableContext items={filteredSubtasks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  {filteredSubtasks.map((s) => (
                    <SortableSubtaskRow key={s.id} id={s.id} hovered={hoveredSubtask === s.id} onHoverChange={setHoveredSubtask}>
                      <input
                        type="checkbox"
                        checked={s.status === "done"}
                        onChange={(e) => {
                          if (e.target.checked) e.target.classList.add("check-pop");
                          updateSubtask.mutate({ id: s.id, data: { status: s.status === "done" ? "todo" : "done" } });
                        }}
                        onAnimationEnd={(e) => (e.target as HTMLElement).classList.remove("check-pop")}
                        className="rounded"
                      />
                      {editingSubtask === s.id ? (
                        <Input
                          variant="inline"
                          fullWidth={false}
                          autoFocus
                          defaultValue={s.title}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val && val !== s.title) updateSubtask.mutate({ id: s.id, data: { title: val } });
                            setEditingSubtask(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditingSubtask(null);
                          }}
                          className="flex-1"
                        />
                      ) : (
                        <span
                          onDoubleClick={() => setEditingSubtask(s.id)}
                          className={`flex-1 text-xs cursor-text ${s.status === "done" ? "line-through text-muted" : ""}`}
                        >
                          {s.title}
                        </span>
                      )}
                      <TaskDatePicker
                        dueDate={s.due_date} endDate={s.end_date} startTime={s.start_time}
                        endTime={s.end_time} reminder={s.reminder}
                        onChange={(vals) => updateSubtask.mutate({ id: s.id, data: vals })}
                        compact
                      />
                      <IconButton
                        icon={Trash2}
                        label={t.delete}
                        tone="danger"
                        onClick={() => deleteSubtask.mutate(s.id, { onSuccess: () => toast.success(t.toast_subtask_deleted) })}
                        className="opacity-0 pointer-events-none group-hover/sub:opacity-100 group-hover/sub:pointer-events-auto"
                      />
                    </SortableSubtaskRow>
                  ))}
                  </SortableContext>
                  </DndContext>
                  <div className="flex gap-1.5 mt-1">
                    <Input
                      size="sm"
                      fullWidth={false}
                      placeholder={t.new_subtask}
                      value={newSubtaskText[tk.id] ?? ""}
                      onChange={(e) => setNewSubtaskText({ ...newSubtaskText, [tk.id]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const text = (newSubtaskText[tk.id] ?? "").trim();
                          if (!text) return;
                          createSubtask.mutate(
                            { task_id: tk.id, title: text, status: "todo", due_date: null, end_date: null, start_time: null, end_time: null, reminder: null, sort_order: subtasks.length },
                            { onSuccess: () => setNewSubtaskText({ ...newSubtaskText, [tk.id]: "" }), onError: (err) => toast.error(t.subtask_create_failed.replace("{error}", String(err))) }
                          );
                        }
                      }}
                      className="flex-1"
                    />
                    <IconButton
                      icon={Plus}
                      label={t.new_subtask}
                      tone="accent"
                      onClick={() => {
                        const text = (newSubtaskText[tk.id] ?? "").trim();
                        if (!text) return;
                        createSubtask.mutate(
                          { task_id: tk.id, title: text, status: "todo", due_date: null, end_date: null, start_time: null, end_time: null, reminder: null, sort_order: subtasks.length },
                          { onSuccess: () => setNewSubtaskText({ ...newSubtaskText, [tk.id]: "" }), onError: (err) => toast.error(t.subtask_create_failed.replace("{error}", String(err))) }
                        );
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {tasks.length === 0 && (
          <div className="text-sm text-muted py-4 text-center">{t.no_tasks_yet}</div>
        )}
      </div>
    </div>
  );
}

const PRIORITY_CYCLE: TaskPriority[] = ["low", "medium", "high"];
