import { describe, it, expect, beforeEach, vi } from "vitest";

// A real SQLite (src-tauri migrations + ensureSchema), so the batch, the
// foreign keys and the NOT NULL guard behave as shipped.
vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";
import {
  getCaptures,
  getBriefEntries,
  dismissCapture,
  restoreCapture,
  fileCaptureByHand,
  keepAsTask,
  markStarted,
  setBrief,
  briefAgain,
} from "../db/queries/captures";

const prep = (sql: string) => rawDb().prepare(sql.replace(/\$(\d+)/g, "?$1"));
const one = (sql: string, ...p: (string | number | null)[]) => prep(sql).get(...p) as Record<string, unknown> | undefined;
const count = (table: string) => (one(`SELECT COUNT(*) AS n FROM ${table}`) as { n: number }).n;

let projectId: number;
let taskId: number;

function capture(text: string, over: Record<string, string | number | null> = {}): number {
  const row: Record<string, string | number | null> = { source: "hotkey", status: "new", created_at: "2026-11-12 10:00:00", ...over };
  const r = prep(
    "INSERT INTO captures (text, source, status, project_id, task_id, subtask_id, outcome, brief_tries, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
  ).run(
    text, row.source as string, row.status as string,
    (row.project_id as number) ?? null, (row.task_id as number) ?? null, (row.subtask_id as number) ?? null,
    (row.outcome as string) ?? null, (row.brief_tries as number) ?? 0, row.created_at as string,
  );
  return Number(r.lastInsertRowid);
}

beforeEach(async () => {
  await freshRealDb();
  prep("INSERT INTO clients (id, name) VALUES ('c1', 'Studio A')").run();
  projectId = Number(prep("INSERT INTO projects (client_id, name) VALUES ('c1', 'Identity')").run().lastInsertRowid);
  taskId = Number(prep("INSERT INTO tasks (project_id, title, brief, stage) VALUES ($1, 'Poster tool', 'Build it', 'briefed')").run(projectId).lastInsertRowid);
});

describe("getCaptures", () => {
  it("lists one status, newest first, with the project and task names", async () => {
    capture("older", { created_at: "2026-11-12 09:00:00" });
    capture("newer", { created_at: "2026-11-12 11:00:00" });
    capture("filed one", { status: "filed", project_id: projectId, task_id: taskId, outcome: "note" });
    const rows = await getCaptures("new");
    expect(rows.map((r) => r.text)).toEqual(["newer", "older"]);
    const filed = await getCaptures("filed");
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({ project_name: "Identity", task_title: "Poster tool", subtask_title: null });
  });
});

describe("dismiss and restore", () => {
  it("dismisses a new capture and restores it", async () => {
    const id = capture("a thought");
    await dismissCapture(id);
    expect(one("SELECT status FROM captures WHERE id = $1", id)?.status).toBe("dismissed");
    expect((await getCaptures("new")).length).toBe(0);
    await restoreCapture(id);
    expect(one("SELECT status FROM captures WHERE id = $1", id)?.status).toBe("new");
  });

  it("does not dismiss a capture already filed, nor restore one that is not dismissed", async () => {
    const id = capture("done", { status: "filed", project_id: projectId, task_id: taskId, outcome: "note" });
    await dismissCapture(id);
    await restoreCapture(id);
    expect(one("SELECT status FROM captures WHERE id = $1", id)?.status).toBe("filed");
  });
});

describe("fileCaptureByHand", () => {
  it("creates a task with the words as notes and links the capture", async () => {
    const id = capture("Idea for the poster");
    const res = await fileCaptureByHand({ captureId: id, projectId, taskId: null, title: "Poster idea" });
    expect(res.kind).toBe("task");
    const task = one("SELECT * FROM tasks WHERE id = $1", res.id);
    expect(task).toMatchObject({ title: "Poster idea", notes: "Idea for the poster", project_id: projectId });
    expect(one("SELECT * FROM captures WHERE id = $1", id)).toMatchObject({
      status: "filed", outcome: "note", project_id: projectId, task_id: res.id, subtask_id: null,
    });
  });

  it("creates a subtask when a task is given", async () => {
    const id = capture("Check the grid");
    const res = await fileCaptureByHand({ captureId: id, projectId, taskId, title: "Check the grid" });
    expect(res.kind).toBe("subtask");
    expect(one("SELECT * FROM subtasks WHERE id = $1", res.id)).toMatchObject({ task_id: taskId, title: "Check the grid" });
    expect(one("SELECT * FROM captures WHERE id = $1", id)).toMatchObject({
      status: "filed", outcome: "note", project_id: projectId, task_id: taskId, subtask_id: res.id,
    });
  });

  it("refuses a capture filed meanwhile and writes nothing", async () => {
    const id = capture("raced");
    prep("UPDATE captures SET status = 'filed', task_id = $2 WHERE id = $1").run(id, taskId);
    const tasks = count("tasks");
    await expect(fileCaptureByHand({ captureId: id, projectId, taskId: null, title: "x" })).rejects.toThrow(/no longer new/);
    expect(count("tasks")).toBe(tasks);
    expect(one("SELECT task_id FROM captures WHERE id = $1", id)?.task_id).toBe(taskId);
  });

  it("closes the race inside the batch: a capture filed after the check still writes nothing", async () => {
    const id = capture("raced late");
    // The batch alone (no prior SELECT) must refuse a capture that is not new.
    const { TransactionBatch } = await import("../db");
    prep("UPDATE captures SET status = 'dismissed' WHERE id = $1").run(id);
    const b = new TransactionBatch();
    b.add("UPDATE captures SET status = CASE WHEN status = 'new' THEN 'filed' ELSE NULL END WHERE id = $1", [id]);
    b.add("INSERT INTO tasks (project_id, title) VALUES ($1, 'ghost')", [projectId]);
    await expect(b.commit()).rejects.toThrow();
    expect(one("SELECT id FROM tasks WHERE title = 'ghost'")).toBeUndefined();
  });

  it("refuses a dismissed capture and an unknown one", async () => {
    const id = capture("gone", { status: "dismissed" });
    await expect(fileCaptureByHand({ captureId: id, projectId, taskId: null, title: "x" })).rejects.toThrow();
    await expect(fileCaptureByHand({ captureId: 999, projectId, taskId: null, title: "x" })).rejects.toThrow();
    expect(count("tasks")).toBe(1);
  });
});

describe("getBriefEntries", () => {
  it("lists only filed needs_word captures with their task or subtask", async () => {
    const subId = Number(prep("INSERT INTO subtasks (task_id, title, brief) VALUES ($1, 'Grid', 'Check A4')").run(taskId).lastInsertRowid);
    const a = capture("task words", { status: "filed", project_id: projectId, task_id: taskId, outcome: "needs_word", created_at: "2026-11-12 08:00:00" });
    const b = capture("sub words", { status: "filed", project_id: projectId, task_id: taskId, subtask_id: subId, outcome: "needs_word", created_at: "2026-11-12 09:00:00" });
    capture("ready", { status: "filed", project_id: projectId, task_id: taskId, outcome: "ready" });
    capture("note", { status: "filed", project_id: projectId, task_id: taskId, outcome: "note" });
    capture("new one");
    capture("dismissed", { status: "dismissed", outcome: "needs_word", task_id: taskId });
    const entries = await getBriefEntries();
    expect(entries).toHaveLength(2);
    const byId = Object.fromEntries(entries.map((e) => [e.capture_id, e]));
    expect(byId[a]).toEqual({
      capture_id: a, capture_text: "task words", capture_created_at: "2026-11-12 08:00:00",
      kind: "task", item_id: taskId, title: "Poster tool", brief: "Build it",
      project_id: projectId, project_name: "Identity",
    });
    expect(byId[b]).toMatchObject({ kind: "subtask", item_id: subId, title: "Grid", brief: "Check A4", project_id: projectId, project_name: "Identity" });
  });

  it("skips an entry whose task no longer exists", async () => {
    capture("orphan", { status: "filed", project_id: projectId, task_id: taskId, outcome: "needs_word" });
    prep("DELETE FROM tasks WHERE id = $1").run(taskId);
    expect(await getBriefEntries()).toEqual([]);
  });
});

describe("keepAsTask, markStarted, setBrief, briefAgain", () => {
  it("keepAsTask sets the outcome to note and clears the stage", async () => {
    const id = capture("w", { status: "filed", project_id: projectId, task_id: taskId, outcome: "needs_word" });
    await keepAsTask(id);
    expect(one("SELECT outcome FROM captures WHERE id = $1", id)?.outcome).toBe("note");
    expect(one("SELECT stage, brief FROM tasks WHERE id = $1", taskId)).toMatchObject({ stage: null, brief: "Build it" });
  });

  it("markStarted sets the outcome to ready and clears the stage of a subtask", async () => {
    const subId = Number(prep("INSERT INTO subtasks (task_id, title, stage) VALUES ($1, 'Grid', 'briefed')").run(taskId).lastInsertRowid);
    const id = capture("w", { status: "filed", project_id: projectId, task_id: taskId, subtask_id: subId, outcome: "needs_word" });
    await markStarted(id);
    expect(one("SELECT outcome FROM captures WHERE id = $1", id)?.outcome).toBe("ready");
    expect(one("SELECT stage FROM subtasks WHERE id = $1", subId)?.stage).toBeNull();
    expect(one("SELECT stage FROM tasks WHERE id = $1", taskId)?.stage).toBe("briefed");
  });

  it("setBrief writes a task's or a subtask's brief", async () => {
    const subId = Number(prep("INSERT INTO subtasks (task_id, title) VALUES ($1, 'Grid')").run(taskId).lastInsertRowid);
    await setBrief("task", taskId, "New task brief");
    await setBrief("subtask", subId, "New sub brief");
    expect(one("SELECT brief FROM tasks WHERE id = $1", taskId)?.brief).toBe("New task brief");
    expect(one("SELECT brief FROM subtasks WHERE id = $1", subId)?.brief).toBe("New sub brief");
  });

  it("briefAgain resets the tries and the reason", async () => {
    const id = capture("failed", { brief_tries: 3 });
    prep("UPDATE captures SET inbox_reason = 'No project fits' WHERE id = $1").run(id);
    await briefAgain(id);
    expect(one("SELECT brief_tries, inbox_reason FROM captures WHERE id = $1", id)).toMatchObject({ brief_tries: 0, inbox_reason: null });
  });
});
