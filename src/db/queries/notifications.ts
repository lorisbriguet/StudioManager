import { getDb } from "../index";
import type { AppNotification } from "../../types/notification";
import { uiLabels } from "../../i18n/ui";

/** The panel shows the newest ones only; the unread count still covers all. */
export const NOTIFICATIONS_LIST_LIMIT = 200;

export async function getNotifications(): Promise<AppNotification[]> {
  const db = await getDb();
  return db.select<AppNotification[]>(
    "SELECT * FROM notifications ORDER BY created_at DESC LIMIT $1",
    [NOTIFICATIONS_LIST_LIMIT]
  );
}

/**
 * Run at startup so the table doesn't grow forever: read notifications go
 * after 90 days, and routine auto-backup ones after 14 days even if unread
 * (one is written per backup). Auto-backup rows are known by their title, in
 * any language, since the language may have changed since they were written.
 */
export async function purgeOldNotifications(): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM notifications WHERE read = 1 AND created_at < datetime('now', '-90 days')"
  );
  const backupTitles = [...new Set(Object.values(uiLabels).map((l) => l.auto_backup_title))];
  const placeholders = backupTitles.map((_, i) => `$${i + 1}`).join(", ");
  await db.execute(
    `DELETE FROM notifications WHERE title IN (${placeholders}) AND created_at < datetime('now', '-14 days')`,
    backupTitles
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
    `INSERT INTO notifications (type, title, message, read, link, title_key, message_key, params)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.type, data.title, data.message, data.read, data.link,
      data.title_key ?? null, data.message_key ?? null, data.params ?? null,
    ]
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
