import { useState } from "react";
import { useT } from "../../i18n/useT";
import { useProjects } from "../../db/hooks/useProjects";
import { useTasksByProject } from "../../db/hooks/useTasks";
import { useFileCaptureByHand } from "../../db/hooks/useCaptures";
import type { CaptureRow } from "../../db/queries/captures";
import { Button, FormActions, FormField, FormLayout, Input, Select } from "../ui";

/** Longest title a filed capture gets: the rest of the words stay in the notes. */
const TITLE_MAX = 80;

/** The first line of the words, cut to the title length. */
function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim().slice(0, TITLE_MAX);
}

/**
 * File a new capture by hand: a project from the active organisation's open projects, an
 * optional open task to file it under as a subtask, and a title (prefilled, at most 80
 * characters). The right column of the Inbox tab, in the shape of StartAgentForm.
 */
export function FileCaptureForm({ capture, onDone }: { capture: CaptureRow; onDone: () => void }) {
  const t = useT();
  const { data: projects = [] } = useProjects();
  const [projectId, setProjectId] = useState<number | null>(capture.project_id);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [title, setTitle] = useState(firstLine(capture.text));
  const { data: tasks = [] } = useTasksByProject(projectId ?? 0);
  const fileByHand = useFileCaptureByHand();

  const open = projects.filter((p) => p.status === "active");
  // The picked project stays selectable when it is no longer open.
  const picked = projects.find((p) => p.id === projectId);
  const options = picked && !open.includes(picked) ? [picked, ...open] : open;
  const openTasks = tasks.filter((x) => x.status === "todo");
  const valid = projectId !== null && title.trim() !== "";

  const submit = () => {
    if (!valid || projectId === null) return;
    fileByHand.mutate(
      { captureId: capture.id, projectId, taskId: taskId ?? undefined, title: title.trim() },
      { onSuccess: onDone },
    );
  };

  return (
    <FormLayout
      as="form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-sm text-muted whitespace-pre-wrap">{capture.text}</p>
      <FormField label={t.capture_file_project}>
        <Select
          aria-label={t.capture_file_project}
          value={projectId ?? ""}
          onChange={(e) => {
            setProjectId(e.target.value ? Number(e.target.value) : null);
            setTaskId(null);
          }}
          searchable
        >
          <option value="" />
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t.capture_as_subtask}>
        <Select
          aria-label={t.capture_as_subtask}
          value={taskId ?? ""}
          disabled={projectId === null}
          onChange={(e) => setTaskId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{t.capture_file_no_task}</option>
          {openTasks.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t.capture_file_title}>
        <Input aria-label={t.capture_file_title} value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
      </FormField>
      <FormActions>
        <Button variant="secondary" onClick={onDone}>
          {t.capture_file_cancel}
        </Button>
        <Button type="submit" disabled={!valid || fileByHand.isPending}>
          {t.capture_file_submit}
        </Button>
      </FormActions>
    </FormLayout>
  );
}
