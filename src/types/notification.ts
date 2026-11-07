type NotificationType = "overdue" | "info" | "warning" | "error";

export interface AppNotification {
  id: number;
  type: NotificationType;
  /** The text in the language it was written in; shown when there is no key. */
  title: string;
  message: string;
  read: number; // 0 or 1
  link: string | null;
  created_at: string;
  /** Label keys and their values (JSON), to show the notice in the current language. */
  title_key?: string | null;
  message_key?: string | null;
  params?: string | null;
}
