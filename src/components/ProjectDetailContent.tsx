import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWikiArticlesByProject } from "../db/hooks/useWiki";
import { Plus, ChevronRight, ChevronDown, Trash2, GripVertical, ExternalLink, Bookmark, X, Play, Square, FolderOpen, BookOpen } from "lucide-react";
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
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  useReorderSubtasks,
} from "../db/hooks/useTasks";
import { TaskDatePicker } from "./TaskDatePicker";
import { WorkloadTable } from "./workload/WorkloadTable";
import { NamedTable } from "./NamedTable";
import { ProjectBlockLayout } from "./ProjectBlockLayout";
import { useProjectTables, useCreateProjectTable } from "../db/hooks/useProjectTables";
import type { BlockType } from "../types/project";
import { WorkloadColumnEditor } from "./workload/WorkloadColumnEditor";
import {
  useProjectWorkloadConfig,
  useSetProjectWorkloadConfig,
} from "../db/hooks/useWorkload";
import {
  useResourcesByProject,
  useLinkResourceToProject,
  useUnlinkResourceFromProject,
} from "../db/hooks/useResources";
import { getResources } from "../db/queries/resources";
import type { WorkloadColumn } from "../types/workload";
import { DEFAULT_WORKLOAD_COLUMNS } from "../types/workload";
import type { ProjectStatus } from "../types/project";
import { effectivePriority, type TaskPriority } from "../types/task";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { useTabStore } from "../stores/tab-store";
import { useTimerActions } from "../hooks/useTimerActions";
import { open as openDirectory } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { useT } from "../i18n/useT";
import { getTagColor } from "../lib/tagColors";
import { useAppStore } from "../stores/app-store";

interface Props {
  projectId: number;
  compact?: boolean;
}

export function ProjectDetailContent({ projectId, compact }: Props) {
  const { data: project, isLoading } = useProject(projectId);
  const { data: client } = useClient(project?.client_id ?? "");
  const { data: tasks } = useTasksByProject(projectId);
  const updateProject = useUpdateProject();
  const { data: allSubtasks } = useSubtasksByProject(projectId);

  const [status, setStatus] = useState<ProjectStatus>("active");
  const [sectionCtxMenu, setSectionCtxMenu] = useState<ContextMenuState<string> | null>(null);
  const openTab = useTabStore((s) => s.openTab);
  const [editingColumn, setEditingColumn] = useState<{
    column: WorkloadColumn | null;
    index: number;
  } | null>(null);
  const { data: wlConfig } = useProjectWorkloadConfig(projectId);
  const setWlConfig = useSetProjectWorkloadConfig(projectId);
  const t = useT();
  const navigate = useNavigate();
  const darkMode = useAppStore((s) => s.darkMode);
  const { data: wikiArticles } = useWikiArticlesByProject(projectId);

  const wlColumns = wlConfig?.columns ?? DEFAULT_WORKLOAD_COLUMNS;
  const wlTemplateId = wlConfig?.template_id ?? null;

  const handleSaveColumn = useCallback(
    (col: WorkloadColumn) => {
      let next = [...wlColumns];
      if (editingColumn && editingColumn.column) {
        // Editing existing
        next[editingColumn.index] = col;
      } else {
        // Adding new
        next.push(col);
      }
      // Only one column can be the calendar color source — clear others
      if (col.calendarColor) {
        next = next.map((c) =>
          c.key === col.key ? c : { ...c, calendarColor: false }
        );
      }
      setWlConfig.mutate({ templateId: wlTemplateId, columns: next });
    },
    [wlColumns, wlTemplateId, editingColumn, setWlConfig]
  );

  const handleDeleteColumn = useCallback(() => {
    if (editingColumn === null) return;
    const next = wlColumns.filter((_, i) => i !== editingColumn.index);
    setWlConfig.mutate({ templateId: wlTemplateId, columns: next });
  }, [wlColumns, wlTemplateId, editingColumn, setWlConfig]);

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

  const renderBlock = (type: BlockType): React.ReactNode => {
    switch (type) {
      case "notes":
        return (
          <div>
            <textarea
              placeholder={t.notes}
              defaultValue={project.notes ?? ""}
              onBlur={(e) => {
                const val = e.target.value;
                if (val !== (project.notes ?? "")) {
                  updateProject.mutate({ id: projectId, data: { notes: val } });
                }
              }}
              className="w-full border border-[var(--color-input-border)] bg-[var(--color-input)] rounded-lg px-3 py-2 text-sm resize-vertical min-h-[60px] max-h-[60vh] placeholder:text-muted"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
          </div>
        );
      case "tasks":
        return <ProjectTasksSection projectId={projectId} project={project} tasks={tasks ?? []} allSubtasks={allSubtasks ?? []} compact={compact} />;
      case "workload":
        return (
          <>
            <WorkloadTable
              projectId={projectId}
              onEditColumn={(col, idx) => setEditingColumn({ column: col, index: idx })}
            />
            {editingColumn !== null && (
              <WorkloadColumnEditor
                column={editingColumn.column}
                existingKeys={wlColumns.map((c) => c.key)}
                onSave={handleSaveColumn}
                onDelete={editingColumn.column ? handleDeleteColumn : undefined}
                onClose={() => setEditingColumn(null)}
              />
            )}
          </>
        );
      case "resources":
        return <ProjectResources projectId={projectId} />;
      case "named_tables":
        return <ProjectNamedTables projectId={projectId} />;
      case "invoices":
        return (
          <div className="text-sm text-muted">
            <Link to={`/invoices?project=${projectId}`} className="text-accent hover:underline">
              {t.invoices}
            </Link>
          </div>
        );
      case "quotes":
        return (
          <div className="text-sm text-muted">
            <Link to={`/quotes?project=${projectId}`} className="text-accent hover:underline">
              {t.quotes}
            </Link>
          </div>
        );
      case "wiki":
        return (
          <div className="text-sm">
            {(!wikiArticles || wikiArticles.length === 0) ? (
              <div className="text-muted">{t.no_wiki_articles_linked ?? "No wiki articles linked"}</div>
            ) : (
              <div className="divide-y divide-[var(--color-border-divider)]">
                {wikiArticles.map((article: { id: number; title: string; tags?: string[] }) => (
                  <button
                    key={article.id}
                    onClick={() => navigate(`/wiki?article=${article.id}`)}
                    className="w-full flex items-center gap-2 py-1.5 text-left hover:bg-[var(--color-hover-row)] rounded-md px-1 transition-colors"
                  >
                    <BookOpen size={14} className="text-muted shrink-0" />
                    <span className="text-sm truncate">{article.title}</span>
                    <div className="flex items-center gap-1 ml-auto shrink-0">
                      {(article.tags ?? []).map((tag: string) => {
                        const c = getTagColor(tag, darkMode);
                        return (
                          <span
                            key={tag}
                            style={{ background: c.bg, color: c.text }}
                            className="px-2 py-0.5 text-xs rounded-full font-medium"
                          >
                            {tag}
                          </span>
                        );
                      })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h2 className={compact ? "text-base font-semibold tracking-tight" : "text-xl font-semibold tracking-tight"}>
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
            className="border border-[var(--color-input-border)] bg-[var(--color-input)] rounded-lg px-2 py-1 text-xs"
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
              className="bg-transparent border-none text-xs text-muted cursor-pointer hover:text-[var(--color-text-secondary)]"
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
              className="bg-transparent border-none text-xs text-muted cursor-pointer hover:text-[var(--color-text-secondary)]"
            />
          </div>
          {project.folder_path ? (
            <button
              onClick={() => openUrl(project.folder_path!)}
              className="text-muted hover:text-[var(--color-text-secondary)] text-xs flex items-center gap-1"
            >
              <FolderOpen size={12} />
              {t.folder}
            </button>
          ) : (
            <button
              onClick={async () => {
                const dir = await openDirectory({ directory: true, title: t.set_folder });
                if (typeof dir === "string") {
                  updateProject.mutate({ id: projectId, data: { folder_path: dir } });
                }
              }}
              className="text-muted hover:text-[var(--color-text-secondary)] text-xs flex items-center gap-1"
            >
              <FolderOpen size={12} />
              {t.set_folder}
            </button>
          )}
        </div>

        {totalCount > 0 && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-muted mb-1">
              <span>{t.progress}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 bg-[var(--color-input)] rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <ProjectBlockLayout project={project} projectId={projectId} renderBlock={renderBlock} />

        {sectionCtxMenu && (
          <ContextMenu
            x={sectionCtxMenu.x}
            y={sectionCtxMenu.y}
            onClose={() => setSectionCtxMenu(null)}
            items={[
              { label: t.open_in_new_tab, icon: <ExternalLink size={14} />, onClick: () => openTab(`/projects/${projectId}`, project?.name ?? "") },
            ]}
          />
        )}
      </div>
  );
}

function ProjectResources({ projectId }: { projectId: number }) {
  const t = useT();
  const { data: linked } = useResourcesByProject(projectId);
  const linkResource = useLinkResourceToProject();
  const unlinkResource = useUnlinkResourceFromProject();
  const [showPicker, setShowPicker] = useState(false);
  const [allResources, setAllResources] = useState<{ id: number; name: string; url: string }[]>([]);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    if (showPicker) {
      getResources().then(setAllResources);
    }
  }, [showPicker]);

  const linkedIds = new Set((linked ?? []).map((r) => r.id));
  const unlinked = allResources.filter((r) => !linkedIds.has(r.id));

  return (
    <div className="mt-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 text-sm font-medium mb-2"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <Bookmark size={14} />
        {t.resources} {linked && linked.length > 0 && <span className="text-muted font-normal">({linked.length})</span>}
      </button>
      {!collapsed && (
        <div className="pl-5">
          {(linked ?? []).length === 0 && !showPicker && (
            <div className="text-xs text-muted mb-2">{t.no_resources_yet}</div>
          )}
          {(linked ?? []).map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1 group text-sm">
              <button
                onClick={() => {
                  let u = r.url;
                  if (u && !u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
                  import("@tauri-apps/plugin-shell").then((m) => m.open(u));
                }}
                className="flex items-center gap-1 text-accent hover:underline truncate max-w-[300px]"
              >
                <ExternalLink size={12} />
                {r.name}
              </button>
              <span className="text-xs text-muted truncate max-w-[200px]">
                {r.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </span>
              <button
                onClick={() => unlinkResource.mutate({ resourceId: r.id, projectId })}
                className="text-danger opacity-0 group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {showPicker ? (
            <div className="mt-2 border border-[var(--color-border-divider)] rounded-xl p-2">
              {unlinked.length === 0 ? (
                <div className="text-xs text-muted">{t.no_matching_resources}</div>
              ) : (
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {unlinked.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        linkResource.mutate({ resourceId: r.id, projectId });
                        setShowPicker(false);
                      }}
                      className="w-full text-left px-2 py-1 text-sm hover:bg-[var(--color-hover-row)] rounded-md flex items-center gap-2"
                    >
                      <Bookmark size={12} className="text-muted" />
                      {r.name}
                      <span className="text-xs text-muted ml-auto truncate max-w-[150px]">
                        {r.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setShowPicker(false)} className="text-xs text-muted mt-1 hover:text-[var(--color-text)]">
                {t.cancel}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowPicker(true)}
              className="flex items-center gap-1 text-xs text-accent hover:underline mt-1"
            >
              <Plus size={12} /> {t.add}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectTasksSection({ projectId, project, tasks, allSubtasks }: {
  projectId: number;
  project: { name: string };
  tasks: import("../types/task").Task[];
  allSubtasks: import("../types/task").Subtask[];
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
            <button
              key={f}
              onClick={() => setTaskFilter(f)}
              className={`px-2 py-0.5 text-[11px] rounded-full border ${
                taskFilter === f
                  ? "bg-accent text-white border-accent"
                  : "border-[var(--color-input-border)] text-muted hover:bg-[var(--color-hover-row)]"
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
          onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
          className="flex-1 border border-[var(--color-input-border)] bg-[var(--color-input)] rounded-lg px-3 py-1.5 text-sm"
        />
        <button onClick={addTask} className="p-1.5 text-muted hover:text-accent">
          <Plus size={16} />
        </button>
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
                <button
                  onClick={() => {
                    const next = new Set(expandedTasks);
                    next.has(tk.id) ? next.delete(tk.id) : next.add(tk.id);
                    setExpandedTasks(next);
                  }}
                  className="text-muted hover:text-[var(--color-text-secondary)] p-0.5"
                >
                  <ChevronRight size={14} className={`transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                </button>
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
                  <input
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
                    className="flex-1 text-sm border border-[var(--color-input-border)] bg-[var(--color-input)] rounded-lg px-1 py-0.5"
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
                      ? "text-red-500"
                      : "opacity-0 pointer-events-none group-hover/task:opacity-100 group-hover/task:pointer-events-auto text-muted hover:text-accent"
                  }`}
                  title={activeTimer?.taskId === tk.id ? t.stop_timer : t.start_timer}
                >
                  {activeTimer?.taskId === tk.id ? <Square size={14} /> : <Play size={14} />}
                </button>
                <button
                  onClick={() => deleteTask.mutate(tk.id, { onSuccess: () => toast.success(t.toast_task_deleted) })}
                  className="shrink-0 opacity-0 pointer-events-none group-hover/task:opacity-100 group-hover/task:pointer-events-auto text-muted hover:text-red-600 transition-opacity p-0.5"
                  title={t.delete}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {isExpanded && (
                <div className="ml-9 border-l border-[var(--color-border-divider)] pl-3 pb-1">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event: DragEndEvent) => {
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
                    <SortableSubtaskRow key={s.id} id={s.id}>
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
                        <input
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
                          className="flex-1 text-xs border border-[var(--color-input-border)] bg-[var(--color-input)] rounded-lg px-1 py-0.5"
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
                      <button
                        onClick={() => deleteSubtask.mutate(s.id, { onSuccess: () => toast.success(t.toast_subtask_deleted) })}
                        className="shrink-0 opacity-0 pointer-events-none group-hover/sub:opacity-100 group-hover/sub:pointer-events-auto text-muted hover:text-red-600 transition-opacity p-0.5"
                        title={t.delete}
                      >
                        <Trash2 size={14} />
                      </button>
                    </SortableSubtaskRow>
                  ))}
                  </SortableContext>
                  </DndContext>
                  <div className="flex gap-1.5 mt-1">
                    <input
                      placeholder={t.new_subtask}
                      value={newSubtaskText[tk.id] ?? ""}
                      onChange={(e) => setNewSubtaskText({ ...newSubtaskText, [tk.id]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const text = (newSubtaskText[tk.id] ?? "").trim();
                          if (!text) return;
                          createSubtask.mutate(
                            { task_id: tk.id, title: text, status: "todo", due_date: null, end_date: null, start_time: null, end_time: null, reminder: null, sort_order: subtasks.length },
                            { onSuccess: () => setNewSubtaskText({ ...newSubtaskText, [tk.id]: "" }), onError: (err) => toast.error(`Failed to create subtask: ${String(err)}`) }
                          );
                        }
                      }}
                      className="flex-1 border border-[var(--color-input-border)] bg-[var(--color-input)] rounded-lg px-2 py-1 text-xs"
                    />
                    <button
                      onClick={() => {
                        const text = (newSubtaskText[tk.id] ?? "").trim();
                        if (!text) return;
                        createSubtask.mutate(
                          { task_id: tk.id, title: text, status: "todo", due_date: null, end_date: null, start_time: null, end_time: null, reminder: null, sort_order: subtasks.length },
                          { onSuccess: () => setNewSubtaskText({ ...newSubtaskText, [tk.id]: "" }), onError: (err) => toast.error(`Failed to create subtask: ${String(err)}`) }
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
        {tasks.length === 0 && (
          <div className="text-sm text-muted py-4 text-center">{t.no_tasks_yet}</div>
        )}
      </div>
    </div>
  );
}

function SortableSubtaskRow({ id, children }: { id: number; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 py-1 group/sub">
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted hover:text-[var(--color-text-secondary)] opacity-0 group-hover/sub:opacity-100 shrink-0"
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </div>
      {children}
    </div>
  );
}

const PRIORITY_CYCLE: TaskPriority[] = ["low", "medium", "high"];

function ProjectNamedTables({ projectId }: { projectId: number }) {
  const t = useT();
  const { data: tables } = useProjectTables(projectId);
  const createTable = useCreateProjectTable(projectId);
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2">
        <button onClick={() => setCollapsed(!collapsed)} className="text-muted hover:text-[var(--color-text-secondary)]">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <h2 className="text-sm font-medium">
          {t.custom_tables} {tables && tables.length > 0 && <span className="text-muted font-normal">({tables.length})</span>}
        </h2>
        <button
          onClick={() => createTable.mutate({ name: "Untitled" })}
          className="text-muted hover:text-accent"
          title={t.add_table}
        >
          <Plus size={14} />
        </button>
      </div>
      {!collapsed && (
        <div className="space-y-3">
          {(!tables || tables.length === 0) && (
            <div className="text-xs text-muted">{t.no_tables_yet}</div>
          )}
          {(tables ?? []).map((tbl) => (
            <NamedTable key={tbl.id} table={tbl} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}

function PriorityBadge({ priority, onClick }: { priority: TaskPriority; onClick?: () => void }) {
  const colors: Record<TaskPriority, string> = {
    high: "bg-danger",
    medium: "bg-warning",
    low: "bg-success",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer hover:opacity-70"
      title={`Priority: ${priority}`}
    >
      <span className={`dot ${colors[priority]}`} />
    </button>
  );
}
