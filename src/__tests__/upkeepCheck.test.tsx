import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(), logDebug: vi.fn() }));
vi.mock("../lib/notifyError", async () => {
  const { uiLabels } = await vi.importActual<typeof import("../i18n/ui")>("../i18n/ui");
  return { notifyError: vi.fn(), getLabels: () => uiLabels.EN };
});
vi.mock("../db/queries/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("../lib/nativeNotification", () => ({ sendNativeNotification: vi.fn() }));
vi.mock("../db/queries/upkeepItems", () => ({ getActiveUpkeepItems: vi.fn() }));
vi.mock("../db/queries/machines", () => ({ getMachines: vi.fn() }));
vi.mock("../db/queries/consumables", async (orig) => ({
  ...(await orig<typeof import("../db/queries/consumables")>()),
  getConsumables: vi.fn(),
}));
vi.mock("../db/queries/subscriptions", () => ({
  getSubscriptions: vi.fn(),
  getPendingRenewals: vi.fn(),
  applyRenewals: vi.fn(),
}));
vi.mock("../lib/upkeep/calendar", () => ({ syncSubscriptionCalendar: vi.fn() }));
vi.mock("../db/index", async (orig) => ({ ...(await orig<typeof import("../db/index")>()), getDb: vi.fn() }));

import { runUpkeepCheck } from "../lib/upkeep/notify";
import { useUpkeepCheck } from "../hooks/useUpkeepCheck";
import { createNotification } from "../db/queries/notifications";
import { sendNativeNotification } from "../lib/nativeNotification";
import { getActiveUpkeepItems } from "../db/queries/upkeepItems";
import { getMachines } from "../db/queries/machines";
import { getConsumables } from "../db/queries/consumables";
import { getSubscriptions, getPendingRenewals, applyRenewals } from "../db/queries/subscriptions";
import { syncSubscriptionCalendar } from "../lib/upkeep/calendar";
import { getDb } from "../db/index";
import { invokedCommands, clearInvokedCommands, setInvokeHandler } from "../__mocks__/tauri-api";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";

const TODAY = "2026-10-28";
const machine = { id: 3, name: "Bambu X1", status: "working", warranty_until: null, warranty_notified_for: null };
const overdueItem = {
  id: 7, machine_id: 3, title: "Clean nozzle", schedule: "interval", next_due_on: "2026-10-20",
  snooze_until: null, overdue_notified_for: null, archived: 0,
};

function qcStub() {
  return { invalidateQueries: vi.fn() } as unknown as QueryClient;
}

let diskRows: unknown[] = [];
let connRows: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  clearInvokedCommands();
  setInvokeHandler(null);
  useAppStore.setState({ testMode: false, presentationMode: false, warrantyWindowDays: 60, renewalWindowDays: 14 });
  useOrgStore.setState({ activeId: "org-a" });
  diskRows = [];
  connRows = [];
  vi.mocked(getActiveUpkeepItems).mockResolvedValue([overdueItem] as never);
  vi.mocked(getMachines).mockResolvedValue([machine] as never);
  vi.mocked(getConsumables).mockResolvedValue([]);
  vi.mocked(getSubscriptions).mockResolvedValue([]);
  vi.mocked(getPendingRenewals).mockResolvedValue([]);
  vi.mocked(applyRenewals).mockResolvedValue(0);
  vi.mocked(createNotification).mockResolvedValue(1);
  vi.mocked(getDb).mockResolvedValue({
    select: vi.fn(async (sql: string) => (sql.includes("machine_disks") ? diskRows : connRows)),
  } as never);
});

const batchCalls = () => invokedCommands.filter((c) => c.cmd === "execute_batch");
type Stmt = { sql: string; params: unknown[] };
const stmtsOf = (i: number) => (batchCalls()[i].args as { statements: Stmt[] }).statements;

describe("runUpkeepCheck", () => {
  it("creates the notice, sets the marker in one batch and invalidates", async () => {
    const qc = qcStub();
    const n = await runUpkeepCheck(qc, TODAY);
    expect(n).toBe(1);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createNotification).mock.calls[0][0]).toMatchObject({
      type: "warning", read: 0, link: "/upkeep/machines/3",
    });
    expect(sendNativeNotification).toHaveBeenCalledTimes(1);
    expect(batchCalls()).toHaveLength(1);
    expect(stmtsOf(0)).toEqual([
      expect.objectContaining({ sql: expect.stringContaining("overdue_notified_for"), params: ["2026-10-20", 7] }),
    ]);
    const keys = vi.mocked(qc.invalidateQueries).mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(["notifications", "upkeep-items", "subscriptions"]));
  });

  it("second run with the marker set writes nothing", async () => {
    vi.mocked(getActiveUpkeepItems).mockResolvedValue([{ ...overdueItem, overdue_notified_for: "2026-10-20" }] as never);
    expect(await runUpkeepCheck(qcStub(), TODAY)).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    expect(batchCalls()).toHaveLength(0);
  });

  it("applies renewals and syncs the calendar for each rolled subscription", async () => {
    vi.mocked(getSubscriptions).mockResolvedValue([
      { id: 5, status: "active", renews_on: "2026-10-01" },
      { id: 6, status: "cancelled", renews_on: "2026-10-01" },
    ] as never);
    vi.mocked(applyRenewals).mockResolvedValueOnce(1);
    await runUpkeepCheck(qcStub(), TODAY);
    expect(applyRenewals).toHaveBeenCalledTimes(1);
    expect(syncSubscriptionCalendar).toHaveBeenCalledWith(5);
  });

  it("reads disks and connections with local selects and notifies", async () => {
    vi.mocked(getActiveUpkeepItems).mockResolvedValue([]);
    diskRows = [{ id: 4, machine_id: 3, slot: "Drive 1", health: "failing", notified_health: null }];
    connRows = [{ id: 1, label: "NAS", failing_since: "2026-10-20", failing_notified: 0 }];
    expect(await runUpkeepCheck(qcStub(), TODAY)).toBe(2);
    const sql = stmtsOf(0).map((s) => s.sql).join("\n");
    expect(sql).toContain("notified_health");
    expect(sql).toContain("failing_notified");
  });

  it("skips writes when org changed", async () => {
    vi.mocked(getMachines).mockImplementation(async () => {
      useOrgStore.setState({ activeId: "org-b" });
      return [machine] as never;
    });
    expect(await runUpkeepCheck(qcStub(), TODAY)).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    expect(applyRenewals).not.toHaveBeenCalled();
    expect(batchCalls()).toHaveLength(0);
  });

  it("no notices in test mode", async () => {
    useAppStore.setState({ testMode: true });
    expect(await runUpkeepCheck(qcStub(), TODAY)).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    expect(applyRenewals).not.toHaveBeenCalled();
    expect(getActiveUpkeepItems).not.toHaveBeenCalled();
  });

  it("no notices in presentation mode", async () => {
    useAppStore.setState({ presentationMode: true });
    expect(await runUpkeepCheck(qcStub(), TODAY)).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
    expect(applyRenewals).not.toHaveBeenCalled();
  });
});

describe("useUpkeepCheck", () => {
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
  }

  it("runs on mount, not again on focus within the hour, again after it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T09:00:00"));
    try {
      renderHook(() => useUpkeepCheck(), { wrapper });
      await vi.advanceTimersByTimeAsync(10);
      expect(getActiveUpkeepItems).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(10);
      expect(getActiveUpkeepItems).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date("2026-10-28T10:30:00"));
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(10);
      expect(getActiveUpkeepItems).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
