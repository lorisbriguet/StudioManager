import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("../lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(), logDebug: vi.fn() }));
vi.mock("../lib/appleCalendar", () => ({
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(async () => "uid-upd"),
  deleteCalendarEvent: vi.fn(async () => undefined),
}));

import { useCreateTask, useUpdateTask } from "../db/hooks/useTasks";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "../lib/appleCalendar";
import { useUndoStore } from "../stores/undo-store";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { undoableAction } from "../lib/undo";
import { notify } from "../lib/notify";
import { defaultSwitchDeps } from "../lib/switchOrganisation";
import { getDb } from "../db";
import { setSelectHandler, executedStatements, clearExecutedStatements } from "../__mocks__/tauri-sql";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

const newTask = {
  project_id: 1, title: "New", description: "", status: "todo" as const, priority: "medium" as const,
  due_date: "2030-01-01", end_date: null, start_time: null, end_time: null, reminder: null,
  scheduled_start: null, scheduled_end: null, notes: "", sort_order: 0,
};

beforeAll(async () => {
  await getDb();
});

beforeEach(() => {
  useAppStore.setState({ language: "EN", calendarSync: false });
  useOrgStore.setState({ activeId: "org-a" });
  useUndoStore.setState({ stack: [], redoStack: [] });
  clearExecutedStatements();
  vi.mocked(createCalendarEvent).mockReset();
  vi.mocked(updateCalendarEvent).mockClear();
  vi.mocked(deleteCalendarEvent).mockClear();
  setSelectHandler(() => []);
});

describe("undo history and organisations", () => {
  it("switching organisation clears both stacks", () => {
    useUndoStore.setState({
      stack: [{ label: "a", execute: () => {} }],
      redoStack: [{ label: "b", execute: () => {} }],
    });
    defaultSwitchDeps(() => {}, async () => true).clearQueries();
    expect(useUndoStore.getState().stack).toHaveLength(0);
    expect(useUndoStore.getState().redoStack).toHaveLength(0);
  });

  it("an entry pushed in one organisation does nothing in another", async () => {
    const run = vi.fn();
    const redo = vi.fn();
    useUndoStore.getState().push({ label: "x", execute: run, redo });
    expect(useUndoStore.getState().stack[0].orgId).toBe("org-a");
    useOrgStore.setState({ activeId: "org-b" });
    await useUndoStore.getState().stack[0].execute();
    await useUndoStore.getState().stack[0].redo!();
    expect(run).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it("the toast Undo drops a foreign entry without running it", async () => {
    const run = vi.fn();
    const action = { label: "x", execute: run };
    useUndoStore.getState().push(action);
    useOrgStore.setState({ activeId: "org-b" });
    const spy = vi.spyOn(notify, "undo").mockImplementation(() => undefined as never);
    undoableAction("msg", action);
    await (spy.mock.calls[0][1] as () => Promise<void>)();
    spy.mockRestore();
    expect(useUndoStore.getState().stack).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("calendar sync and undo", () => {
  it("undo of a creation waits for an in-flight sync, then deletes the stored event", async () => {
    useAppStore.setState({ calendarSync: true });
    let eventId: string | null = null;
    setSelectHandler((sql) =>
      sql.includes("FROM tasks WHERE id") ? [{ id: 1, ...newTask, calendar_event_id: eventId }] : []
    );
    let release!: (uid: string) => void;
    vi.mocked(createCalendarEvent).mockImplementation(
      () => new Promise<string>((res) => { release = (u) => { eventId = u; res(u); }; })
    );
    const { result } = renderHook(() => useCreateTask(), { wrapper });
    result.current.mutate(newTask);
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    await waitFor(() => expect(createCalendarEvent).toHaveBeenCalled());

    const undo = Promise.resolve(useUndoStore.getState().stack[0].execute());
    await new Promise((r) => setTimeout(r, 20));
    expect(executedStatements.some((s) => s.sql.startsWith("DELETE FROM tasks"))).toBe(false);

    release("evt-late");
    await undo;
    expect(executedStatements.some((s) => s.sql.startsWith("DELETE FROM tasks"))).toBe(true);
    expect(deleteCalendarEvent).toHaveBeenCalledWith("evt-late");
  });

  it("a sync requested while one is in flight is chained, not dropped", async () => {
    useAppStore.setState({ calendarSync: true });
    let eventId: string | null = null;
    const row = () => ({ id: 1, ...newTask, calendar_event_id: eventId });
    setSelectHandler((sql) => (sql.includes("FROM tasks WHERE id") ? [row()] : []));
    let release!: (uid: string) => void;
    vi.mocked(createCalendarEvent).mockImplementation(
      () => new Promise<string>((res) => { release = (u) => { eventId = u; res(u); }; })
    );
    const { result } = renderHook(() => ({ c: useCreateTask(), u: useUpdateTask() }), { wrapper });
    result.current.c.mutate(newTask);
    await waitFor(() => expect(createCalendarEvent).toHaveBeenCalled());
    result.current.u.mutate({ id: 1, data: { title: "Renamed" } });
    await waitFor(() => expect(executedStatements.some((s) => s.sql.includes("UPDATE tasks SET title"))).toBe(true));
    expect(updateCalendarEvent).not.toHaveBeenCalled();
    release("evt-1");
    await waitFor(() => expect(updateCalendarEvent).toHaveBeenCalledWith("evt-1", expect.anything()));
  });
});

describe("redo of a creation keeps the id", () => {
  it("create, status change, undo x2, redo x2: the status change hits the same row", async () => {
    setSelectHandler((sql) => (sql.includes("FROM tasks WHERE id") ? [{ id: 1, ...newTask }] : []));
    const { result } = renderHook(() => ({ c: useCreateTask(), u: useUpdateTask() }), { wrapper });
    result.current.c.mutate(newTask);
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(1));
    result.current.u.mutate({ id: 1, data: { status: "done" } });
    await waitFor(() => expect(useUndoStore.getState().stack).toHaveLength(2));
    const [statusAction, createAction] = useUndoStore.getState().stack;

    await statusAction.execute();
    await createAction.execute();
    clearExecutedStatements();
    await createAction.redo!();
    const ins = executedStatements.find((s) => s.sql.includes("INSERT OR REPLACE INTO tasks"))!;
    expect(ins.params[0]).toBe(1);

    clearExecutedStatements();
    await statusAction.redo!();
    const upd = executedStatements.find((s) => s.sql.includes("UPDATE tasks SET"))!;
    expect(upd.params[0]).toBe(1);
    expect(upd.params).toContain("done");
  });
});
