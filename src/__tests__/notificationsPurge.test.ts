import { describe, it, expect, beforeEach, vi } from "vitest";

// A real SQLite so the date arithmetic in the purge runs as shipped.
vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";
import {
  getNotifications,
  getUnreadCount,
  purgeOldNotifications,
  NOTIFICATIONS_LIST_LIMIT,
} from "../db/queries/notifications";
import { uiLabels } from "../i18n/ui";

function add(title: string, read: number, daysAgo: number, message = "") {
  rawDb()
    .prepare(
      "INSERT INTO notifications (type, title, message, read, created_at) VALUES ('info', ?, ?, ?, datetime('now', ?))"
    )
    .run(title, message, read, `-${daysAgo} days`);
}

const messages = () =>
  (rawDb().prepare("SELECT message FROM notifications ORDER BY message").all() as { message: string }[]).map((r) => r.message);

const titles = () =>
  (rawDb().prepare("SELECT title FROM notifications ORDER BY title").all() as { title: string }[]).map((r) => r.title);

beforeEach(async () => {
  await freshRealDb();
  rawDb().exec("DELETE FROM notifications");
});

describe("purgeOldNotifications", () => {
  it("deletes read notifications older than 90 days and keeps the rest", async () => {
    add("old read", 1, 91);
    add("old unread", 0, 200);
    add("recent read", 1, 89);
    add("recent unread", 0, 1);

    await purgeOldNotifications();

    expect(titles()).toEqual(["old unread", "recent read", "recent unread"]);
  });

  it("deletes auto-backup notifications older than 14 days, read or not, in either language", async () => {
    const en = uiLabels.EN.auto_backup_title;
    const fr = uiLabels.FR.auto_backup_title;
    add(en, 0, 15, "old en");
    add(fr, 0, 30, "old fr");
    add(en, 0, 13, "recent en");
    add(fr, 1, 2, "recent fr");
    add("Other", 0, 30, "other unread");

    await purgeOldNotifications();

    expect(messages()).toEqual(["other unread", "recent en", "recent fr"]);
  });
});

describe("getNotifications", () => {
  it(`returns at most ${NOTIFICATIONS_LIST_LIMIT}, newest first, while the unread count covers all`, async () => {
    const stmt = rawDb().prepare(
      "INSERT INTO notifications (type, title, message, read, created_at) VALUES ('info', ?, '', 0, datetime('now', ?))"
    );
    for (let i = 0; i < NOTIFICATIONS_LIST_LIMIT + 5; i++) stmt.run(`n${i}`, `-${i} minutes`);

    const list = await getNotifications();

    expect(list).toHaveLength(NOTIFICATIONS_LIST_LIMIT);
    expect(list[0].title).toBe("n0");
    expect(await getUnreadCount()).toBe(NOTIFICATIONS_LIST_LIMIT + 5);
  });
});
