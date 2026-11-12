import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";

beforeEach(async () => {
  await freshRealDb();
});

describe("captures schema (migration 016)", () => {
  it("keeps a capture when its task is deleted, and clears the link", () => {
    const db = rawDb();
    db.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Studio A')").run();
    db.prepare("INSERT INTO projects (id, client_id, name) VALUES (1, 'c1', 'Identity')").run();
    db.prepare("INSERT INTO tasks (id, project_id, title) VALUES (5, 1, 'Poster tool')").run();
    db.prepare(
      "INSERT INTO captures (id, text, source, status, project_id, task_id) VALUES (9, 'Try a new grid', 'hotkey', 'filed', 1, 5)"
    ).run();

    db.prepare("DELETE FROM tasks WHERE id = 5").run();

    const row = db.prepare("SELECT task_id, project_id, status FROM captures WHERE id = 9").get() as {
      task_id: number | null;
      project_id: number | null;
      status: string;
    };
    expect(row).toEqual({ task_id: null, project_id: 1, status: "filed" });
  });
});
