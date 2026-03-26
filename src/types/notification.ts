export type NotificationType = "overdue" | "info" | "warning" | "error";

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  read: number; // 0 or 1
  link: string | null;
  created_at: string;
}
