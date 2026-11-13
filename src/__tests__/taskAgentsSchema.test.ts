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

describe("task_agents schema (migration 017)", () => {
  it("removes a subtask's links with the subtask", () => {
    const db = rawDb();
    db.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Studio A')").run();
    db.prepare("INSERT INTO projects (id, client_id, name) VALUES (1, 'c1', 'Identity')").run();
    db.prepare("INSERT INTO tasks (id, project_id, title) VALUES (5, 1, 'Poster tool')").run();
    db.prepare("INSERT INTO subtasks (id, task_id, title) VALUES (7, 5, 'Contact sheet export')").run();
    db.prepare("INSERT INTO task_agents (subtask_id, short_id, name) VALUES (7, 'ab12', 'poster-agent')").run();

    db.prepare("DELETE FROM subtasks WHERE id = 7").run();

    const row = db.prepare("SELECT COUNT(*) AS n FROM task_agents").get() as { n: number };
    expect(row.n).toBe(0);
  });

  it("returns result on tasks and subtasks", () => {
    const db = rawDb();
    db.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Studio A')").run();
    db.prepare("INSERT INTO projects (id, client_id, name) VALUES (1, 'c1', 'Identity')").run();
    db.prepare("INSERT INTO tasks (id, project_id, title) VALUES (5, 1, 'Poster tool')").run();
    db.prepare("INSERT INTO subtasks (id, task_id, title) VALUES (7, 5, 'Contact sheet export')").run();
    expect(db.prepare("SELECT * FROM tasks WHERE id = 5").get()).toHaveProperty("result", null);
    expect(db.prepare("SELECT * FROM subtasks WHERE id = 7").get()).toHaveProperty("result", null);
  });
});
