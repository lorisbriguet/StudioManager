/** Part 2 writes result or no_result; part 3 adds merged, to_check, stuck and wrapped_up. */
export type LinkOutcome = "result" | "no_result" | "merged" | "to_check" | "stuck" | "wrapped_up";

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
  /** Watcher fields (migration 018), optional so hand-built links still compile. */
  /** 'watcher'; null: started by hand. */
  started_by?: string | null;
  worktree?: string | null;
  base_ref?: string | null;
  /** running, passed, failed, none, error. */
  check_state?: string | null;
  resumes?: number;
  check_fails?: number;
  sent_back?: number;
  question_sessions?: number;
  check_sessions?: number;
  wrap_asked_at?: string | null;
}
