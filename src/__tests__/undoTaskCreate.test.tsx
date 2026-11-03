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

import { useCreateTask, useCreateSubtask } from "../db/hooks/useTasks";
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

const sqls = () => executedStatements.map((s) => s.sql.replace(/\s+/g, " "));

const newTask = {
  project_id: 1, title: "New", description: "", status: "todo" as const, priority: "medium" as const,
  due_date: "2030-01-01", end_date: null, start_time: null, end_time: null, reminder: null,
  scheduled_start: null, scheduled_end: null, notes: "", sort_order: 0,
};
const newSub = {
  task_id: 4, title: "Sub", status: "todo" as const, due_date: "2030-01-01", end_date: null,
  start_time: null, end_time: null, reminder: null, sort_order: 0,
};

describe("task creation undo/redo", () => {
  it("undo deletes the created task and its calendar event; redo recreates it with the same fields", async () => {
    useAppStore.setState({ calendarSync: true });
    setSelectHandler((sql) =>
      sql.includes("FROM tasks WHERE id")
        ? [{ id: 1, ...newTask, calendar_event_id: "evt-1" }]
        : []
    );
    const { result } = renderHook(() => useCreateTask(), { wrapper });
    result.current.mutate(newTask);
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    const action = useUndoStore.getState().stack[0];
    expect(action.redo).toBeTypeOf("function");
    vi.mocked(deleteCalendarEvent).mockClear();

    clearExecutedStatements();
    await action.execute();
    expect(sqls().some((s) => s.startsWith("DELETE FROM tasks"))).toBe(true);
    expect(deleteCalendarEvent).toHaveBeenCalledWith("evt-1");

    clearExecutedStatements();
    await action.redo!();
    const ins = executedStatements.find((s) => s.sql.includes("INSERT OR REPLACE INTO tasks"))!;
    expect(ins.sql).toMatch(/\(id,/);
    expect(ins.params[0]).toBe(1);
    expect(ins.params).toContain("New");
    expect(ins.params).toContain(null); // calendar_event_id cleared: the event was deleted
  });

  it("undo does not touch the calendar when sync is off", async () => {
    setSelectHandler((sql) =>
      sql.includes("FROM tasks WHERE id") ? [{ id: 1, ...newTask, calendar_event_id: "evt-1" }] : []
    );
    const { result } = renderHook(() => useCreateTask(), { wrapper });
    result.current.mutate(newTask);
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    await useUndoStore.getState().stack[0].execute();
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
  });
});

describe("subtask creation undo/redo", () => {
  it("undo deletes the subtask and its calendar event; redo recreates it", async () => {
    useAppStore.setState({ calendarSync: true });
    setSelectHandler((sql) =>
      sql.includes("FROM subtasks WHERE id") ? [{ id: 1, ...newSub, calendar_event_id: "evt-2" }] : []
    );
    const { result } = renderHook(() => useCreateSubtask(), { wrapper });
    result.current.mutate(newSub);
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    const action = useUndoStore.getState().stack[0];
    vi.mocked(deleteCalendarEvent).mockClear();

    clearExecutedStatements();
    await action.execute();
    expect(sqls().some((s) => s.startsWith("DELETE FROM subtasks"))).toBe(true);
    expect(deleteCalendarEvent).toHaveBeenCalledWith("evt-2");

    clearExecutedStatements();
    await action.redo!();
    const ins = executedStatements.find((s) => s.sql.includes("INSERT OR REPLACE INTO subtasks"))!;
    expect(ins.params).toContain("Sub");
    expect(ins.params[0]).toBe(1);
  });
});
