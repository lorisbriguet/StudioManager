export type TaskStatus = "todo" | "done";
export type TaskPriority = "low" | "medium" | "high";

const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, medium: 1, high: 2 };
const RANK_TO_PRIORITY: TaskPriority[] = ["low", "medium", "high"];

/** Returns the effective priority: due today/past → high, due tomorrow → medium, otherwise stored value (whichever is higher). */
export function effectivePriority(stored: TaskPriority, dueDate: string | null): TaskPriority {
  if (!dueDate) return stored;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
  let datePriority: TaskPriority = "low";
  if (diffDays <= 0) datePriority = "high";
  else if (diffDays === 1) datePriority = "medium";
  return RANK_TO_PRIORITY[Math.max(PRIORITY_RANK[stored], PRIORITY_RANK[datePriority])];
}

export type ReminderOption = "none" | "at_time" | "5min" | "15min" | "30min" | "1h" | "1d";

export interface Task {
  id: number;
  project_id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  reminder: ReminderOption | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  calendar_event_id: string | null;
  notes: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Subtask {
  id: number;
  task_id: number;
  title: string;
  status: TaskStatus;
  due_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  reminder: ReminderOption | null;
  calendar_event_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
