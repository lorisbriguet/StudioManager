/** Part 2 writes result or no_result; part 3 adds its own values. */
export type LinkOutcome = "result" | "no_result";

export interface TaskAgent {
  id: number;
  task_id: number | null;
  subtask_id: number | null;
  session_id: string | null;
  short_id: string;
  name: string;
  model: string | null;
  branch: string | null;
  pr_url: string | null;
  started_at: string;
  reported_at: string | null;
  ended_at: string | null;
  outcome: LinkOutcome | null;
}
