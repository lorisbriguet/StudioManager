import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Modal, FormField, FormGrid, FormGroup, EmptyState, ICONS, MenuItem, Popover, SURFACE } from "./ui";
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
  // The project suggestions under the search field (closed by a click outside)
  const [suggestOpen, setSuggestOpen] = useState(false);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const { data: projects } = useProjects();
  const { data: tasks } = useTasksByProject(selectedProjectId ?? 0);
  const { startTimer, stopAndSave } = useTimerActions();

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setProjectSearch("");
      setSelectedProjectId(null);
      setSelectedTaskId(null);
      setSuggestOpen(false);
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
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      position="top"
      size="md"
      title={t.quick_timer}
      footer={
        <Button
          type="button"
          icon={ICONS.timer}
          disabled={!selectedProjectId || !selectedTaskId}
          onClick={handleStart}
        >
          {t.start_timer_for}
        </Button>
      }
    >
      <FormGrid cols={1}>
        {/* Project picker */}
        <div>
          <FormField label={t.select_project}>
            <Input
              type="text"
              placeholder={t.select_project}
              ref={projectInputRef}
              value={selectedProject ? selectedProject.name : projectSearch}
              onChange={(e) => {
                setProjectSearch(e.target.value);
                setSuggestOpen(true);
                setSelectedProjectId(null);
                setSelectedTaskId(null);
              }}
              onFocus={() => {
                if (selectedProject) {
                  setProjectSearch(selectedProject.name);
                  setSuggestOpen(true);
                  setSelectedProjectId(null);
                  setSelectedTaskId(null);
                }
              }}
              autoFocus
            />
          </FormField>
          {suggestOpen && !selectedProjectId && projectSearch && filteredProjects.length > 0 && (
            // Typing stays in the field: the panel takes no focus
            <Popover
              anchor={projectInputRef}
              onClose={() => setSuggestOpen(false)}
              matchWidth
              autoFocus={false}
              className="max-h-44 overflow-y-auto"
            >
              {filteredProjects.map((p) => (
                <MenuItem
                  key={p.id}
                  onClick={() => {
                    setSelectedProjectId(p.id);
                    setSelectedTaskId(null);
                    setProjectSearch("");
                    setSuggestOpen(false);
                  }}
                >
                  {p.name}
                </MenuItem>
              ))}
            </Popover>
          )}
        </div>

        {/* Task picker */}
        {selectedProjectId && (
          <FormGroup label={t.select_task}>
            {todoTasks.length === 0 ? (
              <EmptyState size="sm" message={t.no_open_tasks_in_project} />
            ) : (
              <div className={`${SURFACE} p-1 max-h-44 overflow-y-auto`}>
                {todoTasks.map((task) => (
                  <MenuItem
                    key={task.id}
                    selected={selectedTaskId === task.id}
                    aria-pressed={selectedTaskId === task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    {task.title}
                  </MenuItem>
                ))}
              </div>
            )}
          </FormGroup>
        )}
      </FormGrid>
    </Modal>
  );
}
