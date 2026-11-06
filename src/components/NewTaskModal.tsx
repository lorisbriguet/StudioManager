import { useState } from "react";
import { FormModal, FormGrid, FormField, Input, Select } from "./ui";
import { useAppStore } from "../stores/app-store";
import { useProjects } from "../db/hooks/useProjects";
import { useCreateTask, useTasksByProject } from "../db/hooks/useTasks";
import { useT } from "../i18n/useT";

/**
 * The New task form, opened by Cmd+N on the Tasks page or a project page
 * and by the palette's New task (see newEntityFor in lib/newEntity.ts).
 */
export function NewTaskModal() {
  const newTask = useAppStore((s) => s.newTask);
  const close = useAppStore((s) => s.closeNewTask);
  if (!newTask) return null;
  return <NewTaskForm initialProjectId={newTask.projectId} onClose={close} />;
}

function NewTaskForm({ initialProjectId, onClose }: { initialProjectId: number | null; onClose: () => void }) {
  const t = useT();
  const { data: projects } = useProjects();
  // Active projects, plus the one this form was opened from whatever its status.
  const choices = (projects ?? []).filter((p) => p.status === "active" || p.id === initialProjectId);
  const [projectId, setProjectId] = useState<number | null>(initialProjectId);
  const selected = projectId ?? choices[0]?.id ?? null;
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | undefined>();
  const { data: projectTasks } = useTasksByProject(selected ?? 0);
  const createTask = useCreateTask();

  const submit = async () => {
    if (!title.trim()) {
      setError(t.task_title_required);
      return;
    }
    if (selected == null) return;
    // Awaited so FormModal ignores a second submit while it runs.
    await createTask.mutateAsync({
      project_id: selected,
      title: title.trim(),
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
      sort_order: projectTasks?.length ?? 0,
    });
    onClose();
  };

  return (
    <FormModal
      open
      size="sm"
      onClose={onClose}
      title={t.new_task_action}
      submitLabel={t.save}
      submitDisabled={selected == null}
      onSubmit={submit}
      submitting={createTask.isPending}
    >
      <FormGrid cols={1}>
        <FormField label={t.task_title} required error={error}>
          <Input
            autoFocus
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(undefined); }}
          />
        </FormField>
        <FormField label={t.project} required>
          <Select
            value={selected ?? ""}
            placeholder={t.select_project}
            onChange={(e) => setProjectId(Number(e.target.value))}
          >
            {choices.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </FormField>
      </FormGrid>
    </FormModal>
  );
}
