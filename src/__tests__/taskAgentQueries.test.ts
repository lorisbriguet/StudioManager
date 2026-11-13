import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";
import {
  linkAgent,
  getItemAgents,
  getOpenLinks,
  wasCaptured,
  setStage,
} from "../db/queries/taskAgents";

const prep = (sql: string) => rawDb().prepare(sql.replace(/\$(\d+)/g, "?$1"));
const one = (sql: string, ...p: (string | number | null)[]) => prep(sql).get(...p) as Record<string, unknown> | undefined;

let projectId: number;
let taskId: number;
let subId: number;

beforeEach(async () => {
  await freshRealDb();
  prep("INSERT INTO clients (id, name) VALUES ('c1', 'Studio A')").run();
  projectId = Number(prep("INSERT INTO projects (client_id, name) VALUES ('c1', 'Identity')").run().lastInsertRowid);
  taskId = Number(prep("INSERT INTO tasks (project_id, title, stage) VALUES ($1, 'Poster tool', 'ready')").run(projectId).lastInsertRowid);
  subId = Number(prep("INSERT INTO subtasks (task_id, title) VALUES ($1, 'Contact sheet export')").run(taskId).lastInsertRowid);
});

describe("linkAgent", () => {
  it("writes the link and Running on a task", async () => {
    const id = await linkAgent({ kind: "task", id: taskId, shortId: "ab12cd34", name: "poster-tool", model: "sonnet" });
    expect(one("SELECT * FROM task_agents WHERE id = $1", id)).toMatchObject({
      task_id: taskId, subtask_id: null, short_id: "ab12cd34", name: "poster-tool", model: "sonnet", ended_at: null,
    });
    expect(one("SELECT stage FROM tasks WHERE id = $1", taskId)?.stage).toBe("running");
  });

  it("writes the link and Running on a subtask", async () => {
    const id = await linkAgent({ kind: "subtask", id: subId, shortId: "ef56", name: "sheet", model: null });
    expect(one("SELECT * FROM task_agents WHERE id = $1", id)).toMatchObject({ task_id: null, subtask_id: subId, model: null });
    expect(one("SELECT stage FROM subtasks WHERE id = $1", subId)?.stage).toBe("running");
    expect(one("SELECT stage FROM tasks WHERE id = $1", taskId)?.stage).toBe("ready");
  });

  it("writes the link but leaves the stage of a done task", async () => {
    prep("UPDATE tasks SET status = 'done', stage = NULL WHERE id = $1").run(taskId);
    await linkAgent({ kind: "task", id: taskId, shortId: "ab12", name: "n", model: null });
    expect(one("SELECT COUNT(*) AS n FROM task_agents")?.n).toBe(1);
    expect(one("SELECT stage FROM tasks WHERE id = $1", taskId)?.stage).toBeNull();
  });
});

describe("getItemAgents, getOpenLinks, wasCaptured", () => {
  it("lists an item's links newest first", async () => {
    prep("INSERT INTO task_agents (task_id, short_id, name, started_at) VALUES ($1, 'old1', 'a', '2026-11-12 09:00:00')").run(taskId);
    prep("INSERT INTO task_agents (task_id, short_id, name, started_at) VALUES ($1, 'new1', 'b', '2026-11-12 10:00:00')").run(taskId);
    prep("INSERT INTO task_agents (subtask_id, short_id, name) VALUES ($1, 'sub1', 'c')").run(subId);
    expect((await getItemAgents("task", taskId)).map((a) => a.short_id)).toEqual(["new1", "old1"]);
    expect((await getItemAgents("subtask", subId)).map((a) => a.short_id)).toEqual(["sub1"]);
  });

  it("getOpenLinks leaves out closed links", async () => {
    prep("INSERT INTO task_agents (task_id, short_id, name, session_id) VALUES ($1, 'open1', 'a', 'sess-1')").run(taskId);
    prep("INSERT INTO task_agents (subtask_id, short_id, name) VALUES ($1, 'open2', 'b')").run(subId);
    prep("INSERT INTO task_agents (task_id, short_id, name, ended_at) VALUES ($1, 'shut', 'c', '2026-11-12 11:00:00')").run(taskId);
    const rows = await getOpenLinks();
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ kind: "task", item_id: taskId, short_id: "open1", session_id: "sess-1" });
    expect(rows).toContainEqual({ kind: "subtask", item_id: subId, short_id: "open2", session_id: null });
  });

  it("wasCaptured is true only for an item a capture was filed as", async () => {
    expect(await wasCaptured("task", taskId)).toBe(false);
    prep("INSERT INTO captures (text, source, status, project_id, task_id, outcome) VALUES ('idea', 'hotkey', 'filed', $1, $2, 'note')").run(projectId, taskId);
    expect(await wasCaptured("task", taskId)).toBe(true);
    expect(await wasCaptured("subtask", subId)).toBe(false);
    prep("INSERT INTO captures (text, source, status, project_id, task_id, subtask_id, outcome) VALUES ('idea2', 'hotkey', 'filed', $1, $2, $3, 'note')").run(projectId, taskId, subId);
    expect(await wasCaptured("subtask", subId)).toBe(true);
  });
});

describe("setStage", () => {
  it("refuses to change a running item and writes nothing", async () => {
    prep("UPDATE tasks SET stage = 'running' WHERE id = $1").run(taskId);
    await expect(setStage("task", taskId, "briefed")).rejects.toThrow("The app sets this stage");
    expect(one("SELECT stage FROM tasks WHERE id = $1", taskId)?.stage).toBe("running");
  });

  it("sets and clears a stage, including from To check", async () => {
    await setStage("task", taskId, "briefed");
    expect(one("SELECT stage FROM tasks WHERE id = $1", taskId)?.stage).toBe("briefed");
    prep("UPDATE subtasks SET stage = 'to_check' WHERE id = $1").run(subId);
    await setStage("subtask", subId, null);
    expect(one("SELECT stage FROM subtasks WHERE id = $1", subId)?.stage).toBeNull();
  });

  it("refuses a hand-set stage over To check but allows clearing it", async () => {
    prep("UPDATE tasks SET stage = 'to_check' WHERE id = $1").run(taskId);
    await expect(setStage("task", taskId, "briefed")).rejects.toThrow("The app sets this stage");
    expect(one("SELECT stage FROM tasks WHERE id = $1", taskId)?.stage).toBe("to_check");
    await setStage("task", taskId, null);
    expect(one("SELECT stage FROM tasks WHERE id = $1", taskId)?.stage).toBeNull();
  });
});
