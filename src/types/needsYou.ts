export type NeedsYouKind = "decide" | "check" | "alone";
export type NeedsYouStatus = "open" | "answered" | "dismissed";
export type NeedsYouDecidedBy = "user" | "lead" | "app";

/** A row of needs_you: what waits on Loris, or what was done without him. */
export interface NeedsYouRow {
  id: number;
  kind: NeedsYouKind;
  task_id: number | null;
  subtask_id: number | null;
  link_id: number | null;
  title: string;
  body: string;
  recommendation: string | null;
  /** JSON array of strings, as stored. */
  options: string | null;
  is_decision: number;
  status: NeedsYouStatus;
  answer: string | null;
  decided_by: NeedsYouDecidedBy | null;
  reason: string | null;
  /** waiting, running, done, skipped. */
  lead_state: string | null;
  check_passed: number | null;
  check_output: string | null;
  change_lines: number | null;
  /** JSON array of always-asks rules the change touches, as stored. */
  touches: string | null;
  delivered_at: string | null;
  created_at: string;
  answered_at: string | null;
}
