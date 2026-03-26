export type ProjectStatus = "active" | "completed" | "on_hold" | "cancelled";

export interface Project {
  id: number;
  client_id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  start_date: string | null;
  deadline: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}
