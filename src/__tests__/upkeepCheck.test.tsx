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
vi.mock("../lib/upkeep/connections", () => ({
  runConnectionSyncs: vi.fn(async () => {}),
}));
vi.mock("../db/index", async (orig) => ({ ...(await orig<typeof import("../db/index")>()), getDb: vi.fn() }));

import { runUpkeepCheck } from "../lib/upkeep/notify";
import { useUpkeepCheck } from "../hooks/useUpkeepCheck";
import { runConnectionSyncs } from "../lib/upkeep/connections";
import { createNotification } from "../db/queries/notifications";
import { sendNativeNotification } from "../lib/nativeNotification";
import { getActiveUpkeepItems } from "../db/queries/upkeepItems";
import { getMachines } from "../db/queries/machines";
import { getConsumables } from "../db/queries/consumables";
import { getSubscriptions, getPendingRenewals, applyRenewals } from "../db/queries/subscriptions";
import { syncSubscriptionCalendar } from "../lib/upkeep/calendar";
import { getDb, TransactionBatch } from "../db/index";
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
  useOrgStore.setState({ activeId: "org-a", switching: false });
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
    expect(sendNativeNotification).toHaveBeenCalledTimes(1);
    expect(batchCalls()).toHaveLength(1);
    // Notice and marker in the same atomic batch, bound to the expected org.
    expect(batchCalls()[0].args.expectedOrg).toBe("org-a");
    expect(stmtsOf(0)).toEqual([
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO notifications"),
        params: ["warning", expect.any(String), expect.any(String), "/upkeep/machines/3"],
      }),
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
    expect(syncSubscriptionCalendar).toHaveBeenCalledWith(5, { force: true });
  });

  it("reads disks and connections with local selects and notifies", async () => {
    vi.mocked(getActiveUpkeepItems).mockResolvedValue([]);
    diskRows = [{ id: 4, machine_id: 3, slot: "Drive 1", health: "failing", notified_health: null }];
    connRows = [{ id: 1, label: "NAS", failing_since: "2026-10-20", failing_notified: 0 }];
    expect(await runUpkeepCheck(qcStub(), TODAY)).toBe(2);
    expect(batchCalls()).toHaveLength(2);
    const sql = [...stmtsOf(0), ...stmtsOf(1)].map((s) => s.sql).join("\n");
    expect(sql).toContain("notified_health");
    expect(sql).toContain("failing_notified");
  });

  it("skips writes when org changed and reports the run as skipped", async () => {
    vi.mocked(getMachines).mockImplementation(async () => {
      useOrgStore.setState({ activeId: "org-b" });
      return [machine] as never;
    });
    expect(await runUpkeepCheck(qcStub(), TODAY)).toBeNull();
    expect(createNotification).not.toHaveBeenCalled();
    expect(applyRenewals).not.toHaveBeenCalled();
    expect(batchCalls()).toHaveLength(0);
  });

  it("stops while an organisation switch is in progress, before any DB call", async () => {
    useOrgStore.setState({ switching: true });
    expect(await runUpkeepCheck(qcStub(), TODAY)).toBeNull();
    useOrgStore.setState({ switching: false });
    expect(getSubscriptions).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    expect(batchCalls()).toHaveLength(0);
  });

  it("no further writes once the switch flag flips during the notice loop", async () => {
    vi.mocked(getActiveUpkeepItems).mockResolvedValue([
      overdueItem, { ...overdueItem, id: 8, title: "Oil rails" },
    ] as never);
    const real = TransactionBatch.prototype.commit;
    const spy = vi.spyOn(TransactionBatch.prototype, "commit").mockImplementation(async function (this: TransactionBatch) {
      const r = await real.call(this);
      useOrgStore.setState({ switching: true });
      return r;
    });
    try {
      expect(await runUpkeepCheck(qcStub(), TODAY)).toBe(1);
    } finally {
      spy.mockRestore();
      useOrgStore.setState({ switching: false });
    }
    expect(batchCalls()).toHaveLength(1);
  });

  it("a failing batch writes neither notice nor marker; the next run plans it exactly once", async () => {
    const spy = vi.spyOn(TransactionBatch.prototype, "commit").mockRejectedValueOnce(new Error("disk full"));
    try {
      expect(await runUpkeepCheck(qcStub(), TODAY)).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(batchCalls()).toHaveLength(0);
    expect(sendNativeNotification).not.toHaveBeenCalled();
    expect(await runUpkeepCheck(qcStub(), TODAY)).toBe(1);
    expect(batchCalls()).toHaveLength(1);
    expect(stmtsOf(0)).toHaveLength(2);
  });

  it("a failing subscription does not block the other reminders", async () => {
    vi.mocked(getSubscriptions).mockResolvedValue([
      { id: 5, status: "active", renews_on: "2026-10-01" },
      { id: 6, status: "active", renews_on: "2026-10-01" },
    ] as never);
    vi.mocked(applyRenewals).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(1);
    expect(await runUpkeepCheck(qcStub(), TODAY)).toBe(1);
    expect(applyRenewals).toHaveBeenCalledTimes(2);
    expect(vi.mocked(applyRenewals).mock.calls[0][2]).toBe("org-a");
    expect(syncSubscriptionCalendar).toHaveBeenCalledWith(6, { force: true });
    expect(batchCalls()).toHaveLength(1);
  });

  it("sends one summary native notification when more than 3 notices are created", async () => {
    vi.mocked(getActiveUpkeepItems).mockResolvedValue(
      [1, 2, 3, 4].map((i) => ({ ...overdueItem, id: i })) as never
    );
    expect(await runUpkeepCheck(qcStub(), TODAY)).toBe(4);
    expect(batchCalls()).toHaveLength(4);
    expect(sendNativeNotification).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendNativeNotification).mock.calls[0][1]).toContain("4");
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

  it("a check skipped by an organisation switch runs as soon as the switch ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T09:00:00"));
    useOrgStore.setState({ activeId: "org-b", switching: true });
    try {
      renderHook(() => useUpkeepCheck(), { wrapper });
      await vi.advanceTimersByTimeAsync(10);
      expect(getActiveUpkeepItems).not.toHaveBeenCalled();
      useOrgStore.setState({ switching: false });
      await vi.advanceTimersByTimeAsync(10);
      expect(getActiveUpkeepItems).toHaveBeenCalledTimes(1);
      // Ran for real this time: a focus within the hour does not run it again.
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(10);
      expect(getActiveUpkeepItems).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a check that ran for the previous organisation does not hold back the next one's", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T09:00:00"));
    try {
      renderHook(() => useUpkeepCheck(), { wrapper });
      await vi.advanceTimersByTimeAsync(10);
      expect(getActiveUpkeepItems).toHaveBeenCalledTimes(1);
      useOrgStore.setState({ switching: true });
      useOrgStore.setState({ activeId: "org-b", switching: false });
      await vi.advanceTimersByTimeAsync(10);
      expect(getActiveUpkeepItems).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a switch that ends while a check is running gets its own check after it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T09:00:00"));
    let release!: () => void;
    vi.mocked(getSubscriptions).mockImplementationOnce(
      () => new Promise((r) => { release = () => r([]); })
    );
    try {
      renderHook(() => useUpkeepCheck(), { wrapper });
      await vi.advanceTimersByTimeAsync(10);
      useOrgStore.setState({ switching: true });
      useOrgStore.setState({ activeId: "org-b", switching: false });
      release(); // the org-a run now sees the switch and stops
      await vi.advanceTimersByTimeAsync(10);
      expect(getActiveUpkeepItems).toHaveBeenCalledTimes(1); // org-b's run
    } finally {
      vi.useRealTimers();
    }
  });

  it("a skipped check is not stamped: the next focus retries it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T09:00:00"));
    useOrgStore.setState({ switching: true });
    try {
      const { unmount } = renderHook(() => useUpkeepCheck(), { wrapper });
      await vi.advanceTimersByTimeAsync(10);
      unmount(); // the switch remounts the app: this instance never sees it end
      useOrgStore.setState({ switching: false });
      renderHook(() => useUpkeepCheck(), { wrapper });
      await vi.advanceTimersByTimeAsync(10);
      expect(getActiveUpkeepItems).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ticks connection syncs on start and hourly while open (the runner skips < 6 h)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T09:00:00"));
    try {
      const { unmount } = renderHook(() => useUpkeepCheck(), { wrapper });
      await vi.advanceTimersByTimeAsync(10);
      expect(runConnectionSyncs).toHaveBeenCalledTimes(1);
      expect(vi.mocked(runConnectionSyncs).mock.calls[0][1]).toBeUndefined();
      await vi.advanceTimersByTimeAsync(59 * 60_000);
      expect(runConnectionSyncs).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runConnectionSyncs).toHaveBeenCalledTimes(2);
      unmount();
      await vi.advanceTimersByTimeAsync(6 * 3600_000);
      expect(runConnectionSyncs).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
