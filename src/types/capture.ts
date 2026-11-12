export type CaptureSource = "hotkey" | "menubar" | "agent" | "reminders";
export type CaptureStatus = "new" | "filed" | "dismissed";
export type CaptureOutcome = "note" | "needs_word" | "ready";

export interface Capture {
  id: number;
  text: string;
  source: CaptureSource;
  status: CaptureStatus;
  project_id: number | null;
  task_id: number | null;
  subtask_id: number | null;
  outcome: CaptureOutcome | null;
  inbox_reason: string | null;
  brief_tries: number;
  reminder_id: string | null;
  created_at: string;
  updated_at: string;
}
