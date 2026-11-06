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

import { orgPaths } from "../lib/orgPaths";
import { syncTaskCalendar } from "../db/hooks/useTasks";
import { useAutoBackup } from "../hooks/useAutoBackup";
import { createCalendarEvent, updateCalendarEvent } from "../lib/appleCalendar";
import { createBackup } from "../lib/backup";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { setSelectHandler } from "../__mocks__/tauri-sql";

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
