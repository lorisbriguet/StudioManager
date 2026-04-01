import { useEffect, useMemo, useState } from "react";
import { Timer } from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "../stores/app-store";
import { useProjects } from "../db/hooks/useProjects";
import { useTasksByProject } from "../db/hooks/useTasks";
import { useTimerActions } from "../hooks/useTimerActions";
import { useT } from "../i18n/useT";

export function QuickTimerModal() {
  const open = useAppStore((s) => s.quickTimerOpen);
  const close = useAppStore((s) => s.closeQuickTimer);
  const t = useT();

  const [projectSearch, setProjectSearch] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

  const { data: projects } = useProjects();
  const { data: tasks } = useTasksByProject(selectedProjectId ?? 0);
  const { startTimer, activeTimer, stopAndSave } = useTimerActions();

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setProjectSearch("");
      setSelectedProjectId(null);
      setSelectedTaskId(null);
    }
  }, [open]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    const q = projectSearch.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, projectSearch]);

  const todoTasks = useMemo(() => {
    if (!tasks) return [];
    return tasks.filter((t) => t.status === "todo");
  }, [tasks]);

  const selectedProject = useMemo(
    () => projects?.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const handleStart = async () => {
    if (!selectedProjectId || !selectedTaskId || !selectedProject) return;
    if (activeTimer) await stopAndSave();
    startTimer(selectedTaskId, selectedProjectId, selectedProject.name);
    toast.success(t.start_timer);
    close();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/40" onClick={close} />
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-[400px] px-4">
        <div className="bg-[var(--color-surface)] rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.5)] border border-[var(--color-border)] overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--color-border)]">
            <Timer size={16} className="text-[var(--color-accent)] shrink-0" />
            <span className="text-sm font-medium">{t.quick_timer}</span>
            <kbd className="ml-auto text-[10px] text-muted bg-[var(--color-input-bg,var(--color-surface))] border border-[var(--color-border)] px-1.5 py-0.5 rounded shrink-0">
              ESC
            </kbd>
          </div>

          {/* Body */}
          <div className="p-4 flex flex-col gap-3">
            {/* Project picker */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted uppercase tracking-widest">
                {t.select_project}
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--color-input-bg,var(--color-surface))] border border-[var(--color-border)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-0 placeholder:text-muted"
                placeholder={t.select_project}
                value={selectedProject ? selectedProject.name : projectSearch}
                onChange={(e) => {
                  setProjectSearch(e.target.value);
                  setSelectedProjectId(null);
                  setSelectedTaskId(null);
                }}
                onFocus={() => {
                  if (selectedProject) {
                    setProjectSearch(selectedProject.name);
                    setSelectedProjectId(null);
                    setSelectedTaskId(null);
                  }
                }}
                autoFocus
              />
              {!selectedProjectId && projectSearch && filteredProjects.length > 0 && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden max-h-44 overflow-y-auto shadow-md">
                  {filteredProjects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-accent-light)] transition-colors"
                      onClick={() => {
                        setSelectedProjectId(p.id);
                        setSelectedTaskId(null);
                        setProjectSearch("");
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Task picker */}
            {selectedProjectId && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted uppercase tracking-widest">
                  {t.select_task}
                </label>
                {todoTasks.length === 0 ? (
                  <p className="text-sm text-muted px-1">{t.no_results}</p>
                ) : (
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden max-h-44 overflow-y-auto">
                    {todoTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        className={[
                          "w-full text-left px-3 py-2 text-sm transition-colors",
                          selectedTaskId === task.id
                            ? "bg-[var(--color-accent-light)] font-medium"
                            : "hover:bg-[var(--color-accent-light)]",
                        ].join(" ")}
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        {task.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Start button */}
            <button
              type="button"
              disabled={!selectedProjectId || !selectedTaskId}
              onClick={handleStart}
              className="mt-1 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Timer size={14} />
              {t.start_timer_for}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
