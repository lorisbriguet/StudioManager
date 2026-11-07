import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Test and presentation mode run on a copy of the real database: nothing done
// in them may reach real document folders, Apple Calendar or the backups.

vi.mock("../lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../lib/appleCalendar", () => ({
  createCalendarEvent: vi.fn(async () => "new-uid"),
  updateCalendarEvent: vi.fn(async () => "new-uid"),
  deleteCalendarEvent: vi.fn(async () => {}),
}));

vi.mock("../lib/backup", () => ({
  createBackup: vi.fn(async (dir: string) => `${dir}/backup-x`),
  isBackupRunning: () => false,
  setBackupRunning: vi.fn(),
  isScopeDenied: () => false,
}));

vi.mock("../lib/nativeNotification", () => ({ sendNativeNotification: vi.fn() }));

import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { orgPaths } from "../lib/orgPaths";
import { syncTaskCalendar, useCreateTask, useDeleteTask, useDeleteSubtask } from "../db/hooks/useTasks";
import { useAutoBackup } from "../hooks/useAutoBackup";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "../lib/appleCalendar";
import { createBackup } from "../lib/backup";
import { removeMachineFile } from "../db/queries/machines";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { useUndoStore } from "../stores/undo-store";
import { setSelectHandler } from "../__mocks__/tauri-sql";
import { invokedCommands, clearInvokedCommands, removedPaths, clearFsWrites } from "../__mocks__/tauri-api";

const modesOff = { testMode: false, presentationMode: false };

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState(modesOff);
});

afterEach(() => {
  useAppStore.setState(modesOff);
  setSelectHandler(null);
});

describe("orgPaths in a mode", () => {
  beforeEach(() => useOrgStore.setState({ activeId: "k3f9a2" }));
  afterEach(() => useOrgStore.setState({ activeId: "" }));

  it("uses a test sub-folder in test mode", async () => {
    useAppStore.setState({ testMode: true });
    expect(await orgPaths()).toEqual({
      root: "/tmp/test-app-data/orgs/k3f9a2/test",
      invoicesDir: "/tmp/test-app-data/orgs/k3f9a2/test/invoices",
      receiptsDir: "/tmp/test-app-data/orgs/k3f9a2/test/receipts",
    });
  });

  it("uses a presentation sub-folder in presentation mode", async () => {
    useAppStore.setState({ presentationMode: true });
    expect((await orgPaths()).invoicesDir).toBe("/tmp/test-app-data/orgs/k3f9a2/presentation/invoices");
  });
});

describe("task calendar sync in a mode", () => {
  beforeEach(() => {
    useAppStore.setState({ calendarSync: true });
    setSelectHandler((sql) => {
      if (sql.includes("FROM tasks WHERE id")) {
        return [{ id: 1, title: "T", status: "todo", due_date: "2026-11-10", start_time: null, end_time: null, project_id: 7, calendar_event_id: "real-uid" }];
      }
      if (sql.includes("FROM projects")) return [{ name: "Proj" }];
      return [];
    });
  });

  it("leaves the real calendar alone in test mode", async () => {
    useAppStore.setState({ testMode: true });
    await syncTaskCalendar(1);
    expect(updateCalendarEvent).not.toHaveBeenCalled();
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it("still syncs outside a mode", async () => {
    await syncTaskCalendar(1);
    expect(updateCalendarEvent).toHaveBeenCalledWith("real-uid", expect.objectContaining({ date: "2026-11-10" }));
  });
});

describe("auto-backup in a mode", () => {
  beforeEach(() => {
    useAppStore.setState({ autoBackupInterval: 60, backupPath: "/tmp/backups", backupPath2: "", lastAutoBackup: 0 });
  });

  it("skips the backup in test mode", () => {
    useAppStore.setState({ testMode: true });
    renderHook(() => useAutoBackup()).unmount();
    expect(createBackup).not.toHaveBeenCalled();
  });

  it("skips the backup in presentation mode", () => {
    useAppStore.setState({ presentationMode: true });
    renderHook(() => useAutoBackup()).unmount();
    expect(createBackup).not.toHaveBeenCalled();
  });

  it("backs up outside a mode", () => {
    renderHook(() => useAutoBackup()).unmount();
    expect(createBackup).toHaveBeenCalledWith("/tmp/backups", expect.anything());
  });
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe("deleting tasks and subtasks in a mode", () => {
  // The mode database is a copy: its rows carry the real event ids.
  const task = { id: 1, title: "T", status: "todo", due_date: "2026-11-10", project_id: 7, calendar_event_id: "real-uid" };
  const subtask = { id: 2, task_id: 1, title: "S", status: "todo", due_date: "2026-11-10", calendar_event_id: "real-sub-uid" };

  beforeEach(() => {
    useAppStore.setState({ calendarSync: true });
    useUndoStore.setState({ stack: [], redoStack: [] });
    setSelectHandler((sql) => {
      // Fresh copies: an undo clears calendar_event_id on the rows it snapshots.
      if (sql.includes("FROM tasks WHERE id")) return [{ ...task }];
      if (sql.includes("FROM subtasks WHERE id")) return [{ ...subtask }];
      if (sql.includes("FROM subtasks WHERE task_id")) return [{ ...subtask }];
      return [];
    });
  });

  it("leaves the real events alone in test mode", async () => {
    useAppStore.setState({ testMode: true });
    await renderHook(() => useDeleteTask(), { wrapper }).result.current.mutateAsync(1);
    await renderHook(() => useDeleteSubtask(), { wrapper }).result.current.mutateAsync(2);
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it("leaves the real event alone when undoing a create in presentation mode", async () => {
    useAppStore.setState({ presentationMode: true });
    const create = renderHook(() => useCreateTask(), { wrapper }).result.current;
    await create.mutateAsync({ title: "T", project_id: 7 } as Parameters<typeof create.mutateAsync>[0]);
    await useUndoStore.getState().stack[0].execute();
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it("still deletes the events outside a mode", async () => {
    await renderHook(() => useDeleteTask(), { wrapper }).result.current.mutateAsync(1);
    await renderHook(() => useDeleteSubtask(), { wrapper }).result.current.mutateAsync(2);
    expect(deleteCalendarEvent).toHaveBeenCalledWith("real-uid");
    expect(deleteCalendarEvent).toHaveBeenCalledWith("real-sub-uid");
  });
});

describe("Apple Calendar in a mode", () => {
  // The real module: the mock above stands in for it everywhere else.
  const real = () => vi.importActual<typeof import("../lib/appleCalendar")>("../lib/appleCalendar");
  const calendarCalls = () => invokedCommands.filter((c) => c.cmd.startsWith("calendar_"));

  beforeEach(() => {
    clearInvokedCommands();
    setSelectHandler((sql) => (sql.includes("calendar_event_id FROM tasks") ? [{ calendar_event_id: "real-uid" }] : []));
  });

  it("writes nothing in test mode, whatever is called", async () => {
    useAppStore.setState({ testMode: true, calendarSync: true });
    const cal = await real();
    await cal.deleteCalendarEvent("real-uid");
    await cal.purgeAllCalendarEvents();
    expect(await cal.syncAllExisting()).toBe(0);
    await expect(cal.createCalendarEvent({ title: "T", date: "2026-11-10" })).rejects.toThrow();
    expect(calendarCalls()).toEqual([]);
  });

  it("deletes for real outside a mode", async () => {
    const cal = await real();
    await cal.deleteCalendarEvent("real-uid");
    expect(calendarCalls()).toEqual([
      expect.objectContaining({ cmd: "calendar_delete_event", args: expect.objectContaining({ uid: "real-uid" }) }),
    ]);
  });
});

describe("removing a machine file in a mode", () => {
  const realFile = "/tmp/test-app-data/orgs/k3f9a2/machines/3/1700000000000_manual.pdf";
  const modeFile = "/tmp/test-app-data/orgs/k3f9a2/test/machines/3/1700000000001_manual.pdf";
  let path = realFile;

  beforeEach(() => {
    useOrgStore.setState({ activeId: "k3f9a2" });
    clearFsWrites();
    path = realFile;
    setSelectHandler((sql) =>
      sql.includes("FROM machine_files WHERE id")
        ? [{ id: 1, machine_id: 3, label: "Manual", kind: "file", path_or_url: path }]
        : []
    );
  });
  afterEach(() => useOrgStore.setState({ activeId: "" }));

  it("keeps the real file in test mode", async () => {
    useAppStore.setState({ testMode: true });
    await removeMachineFile(1);
    expect(removedPaths).toEqual([]);
  });

  it("deletes a file attached during the mode, which lives in the mode folder", async () => {
    useAppStore.setState({ testMode: true });
    path = modeFile;
    await removeMachineFile(1);
    expect(removedPaths).toEqual([modeFile]);
  });

  it("never deletes a path outside the data folder", async () => {
    path = "/Users/someone/Documents/manual.pdf";
    await removeMachineFile(1);
    path = "/tmp/test-app-data/orgs/k3f9a2/../../elsewhere.pdf";
    await removeMachineFile(1);
    expect(removedPaths).toEqual([]);
  });

  it("deletes the copied file outside a mode", async () => {
    await removeMachineFile(1);
    expect(removedPaths).toEqual([realFile]);
  });
});
