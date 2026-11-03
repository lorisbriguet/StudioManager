import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("../lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(), logDebug: vi.fn() }));
vi.mock("../lib/appleCalendar", () => ({
  createCalendarEvent: vi.fn(async () => "uid-new"),
  updateCalendarEvent: vi.fn(async () => "uid-upd"),
  deleteCalendarEvent: vi.fn(async () => undefined),
}));

import { useUpdateTask, useUpdateSubtask } from "../db/hooks/useTasks";
import { deleteCalendarEvent } from "../lib/appleCalendar";
import { useUndoStore } from "../stores/undo-store";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler, executedStatements, clearExecutedStatements } from "../__mocks__/tauri-sql";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeAll(async () => {
  await getDb();
});

beforeEach(() => {
  useAppStore.setState({ language: "EN", calendarSync: false });
  useUndoStore.setState({ stack: [], redoStack: [] });
  clearExecutedStatements();
  vi.mocked(deleteCalendarEvent).mockClear();
  setSelectHandler(() => []);
});


const task = { id: 4, project_id: 1, title: "Write", status: "todo", due_date: "2020-01-01", calendar_event_id: null };
const sub = { id: 9, task_id: 4, title: "Part", status: "todo", due_date: "2020-01-01", calendar_event_id: null };

describe("task status change undo/redo", () => {
  it("undo restores status AND the due date moved to today; redo reapplies both", async () => {
    setSelectHandler((sql) => (sql.includes("FROM tasks WHERE id") ? [task] : []));
    const { result } = renderHook(() => useUpdateTask(), { wrapper });
    result.current.mutate({ id: 4, data: { status: "done" } });
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    const action = useUndoStore.getState().stack[0];
    expect(action.redo).toBeTypeOf("function");

    clearExecutedStatements();
    await action.execute();
    let upd = executedStatements.find((s) => s.sql.includes("UPDATE tasks SET"))!;
    expect(upd.sql).toMatch(/status = /);
    expect(upd.sql).toMatch(/due_date = /);
    expect(upd.params).toContain("todo");
    expect(upd.params).toContain("2020-01-01");

    clearExecutedStatements();
    await action.redo!();
    upd = executedStatements.find((s) => s.sql.includes("UPDATE tasks SET"))!;
    expect(upd.params).toContain("done");
    expect(upd.params).not.toContain("2020-01-01");
  });
});

describe("subtask status change undo/redo", () => {
  it("undo restores status and due date; redo reapplies", async () => {
    setSelectHandler((sql) => (sql.includes("FROM subtasks WHERE id") ? [sub] : []));
    const { result } = renderHook(() => useUpdateSubtask(), { wrapper });
    result.current.mutate({ id: 9, data: { status: "done" } });
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    const action = useUndoStore.getState().stack[0];
    expect(action.redo).toBeTypeOf("function");

    clearExecutedStatements();
    await action.execute();
    let upd = executedStatements.find((s) => s.sql.includes("UPDATE subtasks SET"))!;
    expect(upd.params).toContain("todo");
    expect(upd.params).toContain("2020-01-01");

    clearExecutedStatements();
    await action.redo!();
    upd = executedStatements.find((s) => s.sql.includes("UPDATE subtasks SET"))!;
    expect(upd.params).toContain("done");
  });
});
