import { getDb } from "../index";
import type { AppNotification } from "../../types/notification";

export async function getNotifications(): Promise<AppNotification[]> {
  const db = await getDb();
  return db.select<AppNotification[]>(
    "SELECT * FROM notifications ORDER BY created_at DESC"
  );
}

export async function getUnreadCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM notifications WHERE read = 0"
  );
  return rows[0]?.count ?? 0;
}

export async function createNotification(
  data: Omit<AppNotification, "id" | "created_at">
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO notifications (type, title, message, read, link)
     VALUES ($1, $2, $3, $4, $5)`,
    [data.type, data.title, data.message, data.read, data.link]
  );
  return result.lastInsertId ?? 0;
}

export async function markNotificationRead(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE notifications SET read = 1 WHERE id = $1", [id]);
}

export async function markAllNotificationsRead(): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE notifications SET read = 1 WHERE read = 0");
}

export async function deleteNotification(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM notifications WHERE id = $1", [id]);
}

export async function clearAllNotifications(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM notifications");
}
