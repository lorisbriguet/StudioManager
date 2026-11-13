import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";
import {
  getOpenEntries,
  getAloneEntries,
  countOpen,
  answerEntry,
  dismissEntry,
  reopenEntry,
} from "../db/queries/needsYou";
import { setProjectAgentSettings, getProject, updateProject } from "../db/queries/projects";

const prep = (sql: string) => rawDb().prepare(sql.replace(/\$(\d+)/g, "?$1"));
const one = (sql: string, ...p: (string | number | null)[]) => prep(sql).get(...p) as Record<string, unknown> | undefined;
const run = (sql: string, ...p: (string | number | null)[]) => Number(prep(sql).run(...p).lastInsertRowid);

let projectId: number;
let taskId: number;
let subId: number;
let linkId: number;

function entry(
  kind: string,
  extra: { sub?: number | null; link?: number | null; status?: string; decided_by?: string | null; created?: string } = {},
) {
  const task = extra.sub ? null : taskId;
  return run(
    `INSERT INTO needs_you (kind, task_id, subtask_id, link_id, title, body, status, decided_by, created_at, answered_at)
     VALUES ($1, $2, $3, $4, 'Which format?', 'PNG or SVG', $5, $6, COALESCE($7, datetime('now')), CASE WHEN $5 = 'open' THEN NULL ELSE COALESCE($7, datetime('now')) END)`,
    kind, task, extra.sub ?? null, extra.link === undefined ? linkId : extra.link, extra.status ?? "open", extra.decided_by ?? null, extra.created ?? null,
  );
}

beforeEach(async () => {
  await freshRealDb();
  run("INSERT INTO clients (id, name) VALUES ('c1', 'Studio A')");
  projectId = run("INSERT INTO projects (client_id, name) VALUES ('c1', 'Identity')");
  taskId = run("INSERT INTO tasks (project_id, title, stage) VALUES ($1, 'Poster tool', 'running')", projectId);
  subId = run("INSERT INTO subtasks (task_id, title) VALUES ($1, 'Contact sheet export')", taskId);
  linkId = run("INSERT INTO task_agents (task_id, short_id, name, session_id) VALUES ($1, 'ab12cd34', 'poster-tool', 'sess-1')", taskId);
});

describe("getOpenEntries", () => {
  it("lists open decide and check entries with the item, project and link", async () => {
    const d = entry("decide");
    const c = entry("check", { sub: subId, link: null });
    entry("decide", { status: "answered", decided_by: "user" });
    entry("decide", { status: "dismissed" });
    const rows = await getOpenEntries();
    expect(rows.map((r) => r.id)).toEqual([d, c]);
    expect(rows[0]).toMatchObject({
      kind: "decide", item_title: "Poster tool", project_id: projectId, project_name: "Identity",
      short_id: "ab12cd34", session_id: "sess-1", title: "Which format?",
    });
    expect(rows[1]).toMatchObject({ item_title: "Contact sheet export", project_id: projectId, project_name: "Identity", short_id: null, session_id: null });
  });

  it("counts the open entries", async () => {
    expect(await countOpen()).toBe(0);
    entry("decide");
    entry("check");
    entry("decide", { status: "answered", decided_by: "user" });
    expect(await countOpen()).toBe(2);
  });
});

describe("getAloneEntries", () => {
  it("lists what was decided without Loris in the last 7 days", async () => {
    const a = entry("alone", { status: "answered", decided_by: "app" });
    const l = entry("decide", { status: "answered", decided_by: "lead" });
    entry("decide", { status: "answered", decided_by: "user" });
    entry("alone", { status: "answered", decided_by: "app", created: "2000-01-01 00:00:00" });
    entry("decide");
    const rows = await getAloneEntries(7);
    expect(rows.map((r) => r.id).sort()).toEqual([a, l].sort());
    expect(rows[0].project_name).toBe("Identity");
  });
});

describe("answer, dismiss and reopen", () => {
  it("answers an open entry as Loris", async () => {
    const id = entry("decide");
    await answerEntry(id, "SVG");
    expect(one("SELECT * FROM needs_you WHERE id = $1", id)).toMatchObject({ status: "answered", answer: "SVG", decided_by: "user" });
    expect(one("SELECT answered_at FROM needs_you WHERE id = $1", id)?.answered_at).not.toBeNull();
  });

  it("does not overwrite an entry that is no longer open", async () => {
    const id = entry("decide", { status: "answered", decided_by: "lead" });
    await answerEntry(id, "late");
    expect(one("SELECT answer, decided_by FROM needs_you WHERE id = $1", id)).toMatchObject({ answer: null, decided_by: "lead" });
  });

  it("dismisses an entry", async () => {
    const id = entry("check");
    await dismissEntry(id);
    expect(one("SELECT status FROM needs_you WHERE id = $1", id)?.status).toBe("dismissed");
    expect(await countOpen()).toBe(0);
  });

  it("reopens an entry decided alone", async () => {
    const id = entry("alone", { status: "answered", decided_by: "app" });
    await reopenEntry(id);
    expect(one("SELECT * FROM needs_you WHERE id = $1", id)).toMatchObject({ status: "open", decided_by: null, answer: null, answered_at: null });
    expect(one("SELECT stage FROM tasks WHERE id = $1", taskId)?.stage).toBe("running");
    expect(await countOpen()).toBe(1);
  });

  it("reopens an answered entry", async () => {
    const id = entry("decide", { status: "answered", decided_by: "user" });
    await reopenEntry(id);
    expect(one("SELECT status, decided_by FROM needs_you WHERE id = $1", id)).toMatchObject({ status: "open", decided_by: null });
  });

  it("puts a merged task back to todo, To check", async () => {
    run("UPDATE task_agents SET outcome = 'merged' WHERE id = $1", linkId);
    run("UPDATE tasks SET status = 'done', stage = NULL WHERE id = $1", taskId);
    const id = entry("alone", { status: "answered", decided_by: "lead" });
    await reopenEntry(id);
    expect(one("SELECT status, stage FROM tasks WHERE id = $1", taskId)).toMatchObject({ status: "todo", stage: "to_check" });
  });

  it("puts a merged subtask back to todo, To check", async () => {
    const link = run("INSERT INTO task_agents (subtask_id, short_id, name, outcome) VALUES ($1, 'ef56', 'sheet', 'merged')", subId);
    run("UPDATE subtasks SET status = 'done', stage = NULL WHERE id = $1", subId);
    const id = entry("alone", { sub: subId, link, status: "answered", decided_by: "app" });
    await reopenEntry(id);
    expect(one("SELECT status, stage FROM subtasks WHERE id = $1", subId)).toMatchObject({ status: "todo", stage: "to_check" });
  });
});

describe("setProjectAgentSettings", () => {
  it("trims the check command, empty clears it", async () => {
    await setProjectAgentSettings(projectId, { check_command: "  npm test  " });
    expect((await getProject(projectId))?.check_command).toBe("npm test");
    await setProjectAgentSettings(projectId, { check_command: "   " });
    expect((await getProject(projectId))?.check_command).toBeNull();
  });

  it("refuses a check command over 500 characters", async () => {
    await expect(setProjectAgentSettings(projectId, { check_command: "x".repeat(501) })).rejects.toThrow();
    await setProjectAgentSettings(projectId, { check_command: "x".repeat(500) });
  });

  it("sets merge_alone on a project that is not a hub's", async () => {
    await setProjectAgentSettings(projectId, { merge_alone: 1 });
    expect((await getProject(projectId))?.merge_alone).toBe(1);
  });

  it("refuses merge_alone on a hub project and writes nothing", async () => {
    await setProjectAgentSettings(projectId, { hub_project: 1 });
    await expect(setProjectAgentSettings(projectId, { merge_alone: 1, check_command: "npm test" })).rejects.toThrow();
    expect(one("SELECT merge_alone, check_command, hub_project FROM projects WHERE id = $1", projectId)).toEqual({ merge_alone: 0, check_command: null, hub_project: 1 });
  });

  it("refuses both flags in one call", async () => {
    await expect(setProjectAgentSettings(projectId, { merge_alone: 1, hub_project: 1 })).rejects.toThrow();
    expect(one("SELECT merge_alone, hub_project FROM projects WHERE id = $1", projectId)).toEqual({ merge_alone: 0, hub_project: 0 });
  });

  it("turns merge_alone off when the project becomes a hub's", async () => {
    await setProjectAgentSettings(projectId, { merge_alone: 1 });
    await setProjectAgentSettings(projectId, { hub_project: 1 });
    expect(one("SELECT merge_alone, hub_project FROM projects WHERE id = $1", projectId)).toEqual({ merge_alone: 0, hub_project: 1 });
  });

  it("allows merge_alone once the hub flag is cleared in the same call", async () => {
    await setProjectAgentSettings(projectId, { hub_project: 1 });
    await setProjectAgentSettings(projectId, { hub_project: 0, merge_alone: 1 });
    expect(one("SELECT merge_alone, hub_project FROM projects WHERE id = $1", projectId)).toEqual({ merge_alone: 1, hub_project: 0 });
  });

  it("updateProject refuses the three agent fields: setProjectAgentSettings is their only writer", async () => {
    for (const data of [{ check_command: "npm test" }, { merge_alone: 1 }, { hub_project: 1 }]) {
      await expect(updateProject(projectId, { name: "Poster tool", ...data })).rejects.toThrow(/setProjectAgentSettings/);
    }
    expect(one("SELECT name, check_command, merge_alone, hub_project FROM projects WHERE id = $1", projectId)).toMatchObject({ check_command: null, merge_alone: 0, hub_project: 0 });
    await updateProject(projectId, { name: "Poster tool" });
    expect(one("SELECT name FROM projects WHERE id = $1", projectId)?.name).toBe("Poster tool");
  });
});
