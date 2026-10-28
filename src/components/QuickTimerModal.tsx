import { useEffect, useMemo, useState } from "react";
import { Timer } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Kbd, Modal, SECTION_LABEL } from "./ui";
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
  const { startTimer, stopAndSave } = useTimerActions();

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setProjectSearch("");
      setSelectedProjectId(null);
      setSelectedTaskId(null);
    }
  }, [open]);

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
    // Read from the store directly to avoid acting on a stale snapshot.
    if (useAppStore.getState().activeTimer) {
      await stopAndSave();
      // If saving failed the previous timer is still running — keep it rather
      // than overwriting the unsaved time (stopAndSave surfaced the error).
      if (useAppStore.getState().activeTimer) return;
    }
    startTimer(selectedTaskId, selectedProjectId, selectedProject.name);
    toast.success(t.start_timer);
    close();
  };

  return (
    <Modal open={open} onClose={close} position="top" size="sm" padding={false} aria-label={t.quick_timer}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--color-border)]">
        <Timer size={16} className="text-[var(--color-accent)] shrink-0" />
        <span className="text-sm font-medium">{t.quick_timer}</span>
        <Kbd className="ml-auto">Esc</Kbd>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-3">
        {/* Project picker */}
        <div className="flex flex-col gap-1.5">
          <label className={SECTION_LABEL}>
            {t.select_project}
          </label>
          <Input
            type="text"
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
            <label className={SECTION_LABEL}>
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
        <Button
          type="button"
          variant="primary"
          size="md"
          icon={<Timer size={14} />}
          disabled={!selectedProjectId || !selectedTaskId}
          onClick={handleStart}
          className="mt-1 w-full justify-center disabled:cursor-not-allowed"
        >
          {t.start_timer_for}
        </Button>
      </div>
    </Modal>
  );
}
