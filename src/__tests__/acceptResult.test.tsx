import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));
vi.mock("../lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(), logDebug: vi.fn() }));
vi.mock("../lib/appleCalendar", () => ({
  createCalendarEvent: vi.fn(async () => "uid-new"),
  updateCalendarEvent: vi.fn(async () => "uid-upd"),
  deleteCalendarEvent: vi.fn(async () => undefined),
}));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";
import { useAcceptResult, useSetStage } from "../db/hooks/useTaskAgents";
import { deleteCalendarEvent } from "../lib/appleCalendar";
import { useUndoStore } from "../stores/undo-store";
import { useAppStore } from "../stores/app-store";

const prep = (sql: string) => rawDb().prepare(sql.replace(/\$(\d+)/g, "?$1"));
const one = (sql: string, ...p: (string | number | null)[]) => prep(sql).get(...p) as Record<string, unknown> | undefined;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

let taskId: number;
let subId: number;

beforeEach(async () => {
  await freshRealDb();
  useAppStore.setState({ language: "EN", calendarSync: true });
  useUndoStore.setState({ stack: [], redoStack: [] });
  vi.mocked(deleteCalendarEvent).mockClear();
  prep("INSERT INTO clients (id, name) VALUES ('c1', 'Studio A')").run();
  const projectId = Number(prep("INSERT INTO projects (client_id, name) VALUES ('c1', 'Identity')").run().lastInsertRowid);
  taskId = Number(
    prep("INSERT INTO tasks (project_id, title, stage, due_date, calendar_event_id) VALUES ($1, 'Poster tool', 'to_check', '2020-01-01', 'evt-1')")
      .run(projectId).lastInsertRowid,
  );
  subId = Number(
    prep("INSERT INTO subtasks (task_id, title, stage, due_date, calendar_event_id) VALUES ($1, 'Sheet export', 'to_check', '2020-01-01', 'evt-2')")
      .run(taskId).lastInsertRowid,
  );
});

describe("useAcceptResult", () => {
  it("marks a To check task done through the normal path", async () => {
    const { result } = renderHook(() => useAcceptResult(), { wrapper });
    result.current.mutate({ kind: "task", id: taskId });
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    await waitFor(() => expect(deleteCalendarEvent).toHaveBeenCalledWith("evt-1"));
    const row = one("SELECT status, stage, due_date FROM tasks WHERE id = $1", taskId)!;
    expect(row.status).toBe("done");
    expect(row.stage).toBeNull();
    expect(row.due_date).not.toBe("2020-01-01");
  });

  it("marks a To check subtask done through the normal path", async () => {
    const { result } = renderHook(() => useAcceptResult(), { wrapper });
    result.current.mutate({ kind: "subtask", id: subId });
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    await waitFor(() => expect(deleteCalendarEvent).toHaveBeenCalledWith("evt-2"));
    expect(one("SELECT status, stage FROM subtasks WHERE id = $1", subId)).toMatchObject({ status: "done", stage: null });
  });

  it("changes nothing when the item is Running", async () => {
    prep("UPDATE tasks SET stage = 'running' WHERE id = $1").run(taskId);
    const { result } = renderHook(() => useAcceptResult(), { wrapper });
    result.current.mutate({ kind: "task", id: taskId });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(one("SELECT status, stage FROM tasks WHERE id = $1", taskId)).toMatchObject({ status: "todo", stage: "running" });
    expect(useUndoStore.getState().stack).toHaveLength(0);
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
  });
});

describe("useSetStage", () => {
  it("setStage briefed on a Running item changes nothing", async () => {
    prep("UPDATE tasks SET stage = 'running' WHERE id = $1").run(taskId);
    const { result } = renderHook(() => useSetStage(), { wrapper });
    result.current.mutate({ kind: "task", id: taskId, stage: "briefed" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(one("SELECT stage FROM tasks WHERE id = $1", taskId)?.stage).toBe("running");
  });

  it("Clear stage on To check works", async () => {
    const { result } = renderHook(() => useSetStage(), { wrapper });
    result.current.mutate({ kind: "task", id: taskId, stage: null });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(one("SELECT stage FROM tasks WHERE id = $1", taskId)?.stage).toBeNull();
  });
});
