import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

vi.mock("../lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(), logDebug: vi.fn() }));
vi.mock("../lib/upkeep/calendar", () => ({ syncItemCalendar: vi.fn(async () => {}) }));

import { getDb } from "../db";
import { recordSync, storeReadings, currentReading, deleteConnection } from "../db/queries/connections";
import {
  runConnectionSyncs,
  markDoneWithForecast,
  recordManualReading,
  syncItemWithForecast,
  connectionConfig,
  connectionErrorText,
  connectionStatusText,
  readingForMachine,
} from "../lib/upkeep/connections";
import { uiLabels } from "../i18n/ui";
import { syncItemCalendar } from "../lib/upkeep/calendar";
import { executedStatements, clearExecutedStatements, setSelectHandler } from "../__mocks__/tauri-sql";
import { invokedCommands, clearInvokedCommands, setInvokeHandler, setBatchFailure } from "../__mocks__/tauri-api";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient as RealQueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDeleteConnection } from "../db/hooks/useConnections";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import type { Connection, Machine, UpkeepItem } from "../types/upkeep";

const TODAY = "2026-10-28";

const conn = (over: Partial<Connection> = {}): Connection => ({
  id: 2, kind: "bambu_cloud", label: "Bambu", host: null, port: null, region: "global",
  account: "me@example.com", cert_fingerprint: null, last_sync_at: null, last_ok_at: null,
  last_error: null, failing_since: null, failing_notified: 0, created_at: "", updated_at: "",
  ...over,
});

const machine = (over: Partial<Machine> = {}): Machine => ({
  id: 3, name: "P2S", kind: "printer", maker: null, model: null, serial: null, location: null,
  status: "working", lent_to: null, lent_until: null, purchase_date: null, supplier: null, price: null,
  currency: null, expense_id: null, warranty_until: null, warranty_notified_for: null, lifespan_years: null,
  photo_path: null, notes: null, template_key: null, connection_id: 2, device_id: "SN-P2S",
  reading_baseline: 100, linked_at: null, created_at: "", updated_at: "",
  ...over,
});

const usageItem = (over: Partial<UpkeepItem> = {}): UpkeepItem => ({
  id: 9, machine_id: 3, title: "Lube rods", notes: null, schedule: "usage", interval_n: null,
  interval_unit: null, anchor_day: null, usage_metric: "print_hours", usage_every: 200,
  last_done_on: null, last_done_reading: 100, next_due_on: null, snooze_until: null, in_calendar: 1,
  alert: "default", calendar_event_id: null, calendar_event_date: null, overdue_notified_for: null,
  archived: 0, created_at: "", updated_at: "",
  ...over,
});

const syncResult = {
  devices: [
    {
      device_id: "SN-P2S", model: "P2S", metrics: [["print_hours", 150]],
      disks: [],
    },
    { device_id: "OTHER", model: null, metrics: [["print_hours", 5]], disks: [] },
  ],
};

type Stmt = { sql: string; params: unknown[] };
const batches = () => invokedCommands.filter((c) => c.cmd === "execute_batch");
const batchStmts = (): Stmt[] => batches().flatMap((b) => (b.args as { statements: Stmt[] }).statements);
const qcStub = () => ({ invalidateQueries: vi.fn() }) as unknown as QueryClient;

/** Route selects by table; readings: 140 ten days ago, 150 today (1 h/day). */
function routeSelects(opts: { conns?: Connection[]; machines?: Machine[]; items?: UpkeepItem[] } = {}) {
  setSelectHandler((sql) => {
    if (sql.includes("FROM connections")) return opts.conns ?? [conn()];
    if (sql.includes("FROM machines")) return opts.machines ?? [machine()];
    if (sql.includes("FROM upkeep_items")) return opts.items ?? [usageItem()];
    if (sql.includes("FROM machine_readings") && sql.includes("LIMIT 1")) return [{ value: 150 }];
    if (sql.includes("FROM machine_readings")) {
      return [
        { value: 140, read_at: "2026-10-18 10:00:00" },
        { value: 150, read_at: "2026-10-28 10:00:00" },
      ];
    }
    return [];
  });
}

beforeAll(async () => {
  await getDb();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  clearExecutedStatements();
  clearInvokedCommands();
  setInvokeHandler(null);
  setBatchFailure(null);
  setSelectHandler(null);
  useAppStore.setState({ testMode: false, presentationMode: false });
  useOrgStore.setState({ activeId: "6kun0b", switching: false });
});

describe("connection queries", () => {
  it("failing_since set once and kept", async () => {
    await recordSync(2, false, "timeout", "6kun0b");
    const s = batchStmts()[0];
    expect(batches()[0].args.expectedOrg).toBe("6kun0b");
    // COALESCE keeps the first failure date on later failures.
    expect(s.sql).toMatch(/failing_since\s*=\s*COALESCE\(failing_since,/);
    expect(s.params).toContain("timeout");
    expect(s.sql).not.toMatch(/last_ok_at/);
  });

  it("success clears failing state", async () => {
    await recordSync(2, true);
    const s = batchStmts()[0];
    expect(s.sql).toMatch(/failing_since\s*=\s*NULL/);
    expect(s.sql).toMatch(/failing_notified\s*=\s*0/);
    expect(s.sql).toMatch(/last_error\s*=\s*NULL/);
    expect(s.sql).toMatch(/last_ok_at\s*=/);
  });

  it("storeReadings keeps first_seen on upsert", async () => {
    await storeReadings(
      machine(),
      {
        device_id: "SN-P2S", model: null, metrics: [["print_hours", 150]],
        disks: [{
          slot: "Drive 1", model: "WD Red", serial: "WD-1", size_bytes: 4e12, power_on_hours: 9000,
          health: "healthy", bad_sectors: 0, temperature: 35,
        }],
      },
      "2026-10-28 10:00:00",
      "6kun0b"
    );
    const stmts = batchStmts();
    const reading = stmts.find((s) => s.sql.includes("INSERT INTO machine_readings"));
    expect(reading?.params).toEqual([3, "print_hours", 150, "2026-10-28 10:00:00"]);
    const disk = stmts.find((s) => s.sql.includes("INSERT INTO machine_disks"));
    expect(disk?.sql).toMatch(/ON CONFLICT\s*\(machine_id, serial\)\s*DO UPDATE/);
    const update = disk!.sql.split(/DO UPDATE SET/)[1];
    expect(update).not.toContain("first_seen");
    expect(update).toContain("last_read_at");
    expect(batches()[0].args.expectedOrg).toBe("6kun0b");
  });

  it("currentReading adds the machine's baseline to the latest value", async () => {
    setSelectHandler((sql) => {
      if (sql.includes("FROM machine_readings")) return [{ value: 50 }];
      if (sql.includes("FROM machines")) return [machine({ reading_baseline: 100 })];
      return [];
    });
    expect(await currentReading(3, "print_hours")).toBe(150);
    setSelectHandler(() => []);
    expect(await currentReading(3, "print_hours")).toBeNull();
  });

  it("deleteConnection deletes the Keychain secret first, then the row", async () => {
    await deleteConnection(2);
    const del = invokedCommands.find((c) => c.cmd === "connection_delete_secret");
    expect(del?.args).toEqual({ org: "6kun0b", id: 2 });
    expect(executedStatements.some((s) => s.sql.includes("DELETE FROM connections"))).toBe(true);
  });

  it("a failed Keychain delete keeps the row and still refreshes the list", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "connection_delete_secret") throw "Keychain error: denied";
      return null;
    });
    await expect(deleteConnection(2)).rejects.toBe("Keychain error: denied");
    expect(executedStatements.some((s) => s.sql.includes("DELETE FROM connections"))).toBe(false);

    const qc = new RealQueryClient({ defaultOptions: { mutations: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useDeleteConnection(), { wrapper });
    result.current.mutate(2);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["connections"] });
    expect(executedStatements.some((s) => s.sql.includes("DELETE FROM connections"))).toBe(false);
  });

  it("the config sent to Rust carries no secret", () => {
    const c = connectionConfig(conn({ host: "nas.local", port: 5001 }));
    expect(Object.keys(c).sort()).toEqual(["account", "cert_fingerprint", "created_at", "host", "port", "region"]);
  });

  it("the config carries the connection's creation, so Bambu counts prints from then", () => {
    const c = connectionConfig(conn({ kind: "bambu_cloud", region: "global", created_at: "2026-09-01 08:00:00" }));
    expect(c).toMatchObject({ region: "global", created_at: "2026-09-01 08:00:00" });
  });
});

describe("readingForMachine", () => {
  const device = (print_tasks?: [string, number][]) => ({
    device_id: "SN-P2S", model: "P2S", metrics: [] as [string, number][], disks: [], print_tasks,
  });

  it("sums the prints at or after the machine's link time", () => {
    const d = device([["2026-09-02T10:00:00Z", 2], ["2026-09-04T00:00:00Z", 1], ["2026-09-05T09:00:00Z", 1.5]]);
    expect(readingForMachine(d, machine({ linked_at: "2026-09-04T00:00:00.000Z" })).metrics)
      .toEqual([["print_hours", 2.5]]);
    // Linked before link times were kept: every print Rust sent (since the connection) counts.
    expect(readingForMachine(d, machine({ linked_at: null })).metrics).toEqual([["print_hours", 4.5]]);
    // No prints since the link: zero hours, still a reading.
    expect(readingForMachine(device([]), machine({ linked_at: "2026-09-04T00:00:00Z" })).metrics)
      .toEqual([["print_hours", 0]]);
  });

  it("leaves other connectors' readings as they are", () => {
    const nas = { ...device(undefined), metrics: [["temp", 3]] as [string, number][] };
    expect(readingForMachine(nas, machine({}))).toBe(nas);
  });
});

describe("connection errors shown to the user", () => {
  const FP = "ab".repeat(32);
  for (const lang of ["EN", "FR"] as const) {
    const t = uiLabels[lang];
    it(`turns connector codes into readable ${lang} text`, () => {
      expect(connectionErrorText(`untrusted_cert:${FP}`, t)).toBe(t.upkeep_err_untrusted_cert);
      expect(connectionErrorText("otp_required", t)).toBe(t.upkeep_err_otp);
      expect(connectionErrorText(new Error("otp_invalid"), t)).toBe(t.upkeep_err_otp);
      expect(connectionErrorText("DSM error 117 on SYNO.Core.System", t)).toBe("DSM error 117 on SYNO.Core.System");
      expect(connectionErrorText("code_required", t)).toBe(t.upkeep_err_bambu_code);
      expect(connectionErrorText("code_invalid", t)).toBe(t.upkeep_err_bambu_code);
      expect(connectionErrorText("token_expired", t)).toBe(t.upkeep_err_bambu_signin);
      expect(connectionErrorText("password_invalid", t)).toBe(t.upkeep_err_bambu_password);
      expect(connectionErrorText("tfa_unsupported", t)).toBe(t.upkeep_err_bambu_tfa);
      expect(connectionErrorText("history_too_long", t)).toBe(t.upkeep_err_bambu_history);
      expect(connectionErrorText("reenter_password", t)).toBe(t.upkeep_err_syno_reenter);
    });
    it(`the status line of a failing connection is readable in ${lang}`, () => {
      const text = connectionStatusText(conn({ last_sync_at: null, last_error: `untrusted_cert:${FP}` }), t);
      expect(text).toContain(t.upkeep_err_untrusted_cert);
      expect(text).not.toContain("untrusted_cert");
    });
  }
});

describe("runConnectionSyncs", () => {
  it("stores readings for the linked machine, records success and re-forecasts usage items", async () => {
    routeSelects();
    setInvokeHandler((cmd) => (cmd === "connection_sync" ? syncResult : null));
    await runConnectionSyncs(qcStub(), { todayISO: TODAY });

    const call = invokedCommands.find((c) => c.cmd === "connection_sync");
    expect(call?.args).toMatchObject({ org: "6kun0b", id: 2, kind: "bambu_cloud" });
    const stmts = batchStmts();
    const readings = stmts.filter((s) => s.sql.includes("INSERT INTO machine_readings"));
    expect(readings).toHaveLength(1);
    expect(readings[0].params.slice(0, 3)).toEqual([3, "print_hours", 150]);
    expect(stmts.some((s) => /failing_since\s*=\s*NULL/.test(s.sql))).toBe(true);
    // current = 150 + baseline 100 = 250, last done at 100 → 150 used, 50 left at 1 h/day.
    const due = stmts.find((s) => s.sql.includes("UPDATE upkeep_items SET next_due_on"));
    expect(due?.params).toEqual(["2026-12-17", 9]);
    expect(syncItemCalendar).toHaveBeenCalledWith(9);
    for (const b of batches()) expect(b.args.expectedOrg).toBe("6kun0b");
  });

  it("Bambu prints count from the machine's link time: earlier prints never, later ones once", async () => {
    const linked = machine({ linked_at: "2026-09-04T00:00:00.000Z" });
    routeSelects({ machines: [linked] });
    const bambu = (tasks: [string, number][]) => ({
      devices: [{ device_id: "SN-P2S", model: "P2S", metrics: [], disks: [], print_tasks: tasks }],
    });
    // A 2 h print before the link (already in the counter typed as baseline),
    // a 1.5 h print after it.
    const first: [string, number][] = [["2026-09-05T09:00:00Z", 1.5], ["2026-09-02T10:00:00Z", 2]];
    setInvokeHandler((cmd) => (cmd === "connection_sync" ? bambu(first) : null));
    await runConnectionSyncs(qcStub(), { todayISO: TODAY, force: true });
    let readings = batchStmts().filter((s) => s.sql.includes("INSERT INTO machine_readings"));
    expect(readings.map((r) => r.params.slice(0, 3))).toEqual([[3, "print_hours", 1.5]]);

    // Next sync: one more print after the link. The stored reading is the
    // total since linking, so nothing is counted twice.
    clearExecutedStatements();
    clearInvokedCommands();
    setInvokeHandler((cmd) =>
      cmd === "connection_sync" ? bambu([["2026-09-20T10:00:00Z", 3], ...first]) : null);
    await runConnectionSyncs(qcStub(), { todayISO: TODAY, force: true });
    readings = batchStmts().filter((s) => s.sql.includes("INSERT INTO machine_readings"));
    expect(readings.map((r) => r.params.slice(0, 3))).toEqual([[3, "print_hours", 4.5]]);
  });

  it("records the failure (redacted by Rust) and keeps going", async () => {
    routeSelects();
    setInvokeHandler((cmd) => {
      if (cmd === "connection_sync") throw "unsupported connection kind: bambu_cloud";
      return null;
    });
    await runConnectionSyncs(qcStub(), { todayISO: TODAY });
    const s = batchStmts().find((x) => x.sql.includes("UPDATE connections"));
    expect(s?.params).toContain("unsupported connection kind: bambu_cloud");
    expect(batchStmts().some((x) => x.sql.includes("machine_readings"))).toBe(false);
  });

  it("sync result dropped after org switch", async () => {
    routeSelects();
    setInvokeHandler((cmd) => {
      if (cmd === "connection_sync") {
        useOrgStore.setState({ activeId: "other1" });
        return syncResult;
      }
      return null;
    });
    await runConnectionSyncs(qcStub(), { todayISO: TODAY });
    expect(batches()).toHaveLength(0);
    expect(executedStatements).toHaveLength(0);
    expect(syncItemCalendar).not.toHaveBeenCalled();
  });

  it("skips sync within 6 hours", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    routeSelects({ conns: [conn({ last_sync_at: twoHoursAgo })] });
    setInvokeHandler((cmd) => (cmd === "connection_sync" ? syncResult : null));
    await runConnectionSyncs(qcStub(), { todayISO: TODAY });
    expect(invokedCommands.some((c) => c.cmd === "connection_sync")).toBe(false);

    // Sync now forces it.
    await runConnectionSyncs(qcStub(), { todayISO: TODAY, force: true });
    expect(invokedCommands.some((c) => c.cmd === "connection_sync")).toBe(true);
  });

  it("syncs again after 6 hours", async () => {
    const sevenHoursAgo = new Date(Date.now() - 7 * 3600_000).toISOString();
    routeSelects({ conns: [conn({ last_sync_at: sevenHoursAgo })] });
    setInvokeHandler((cmd) => (cmd === "connection_sync" ? syncResult : null));
    await runConnectionSyncs(qcStub(), { todayISO: TODAY });
    expect(invokedCommands.some((c) => c.cmd === "connection_sync")).toBe(true);
  });

  it("never syncs in test or presentation mode", async () => {
    routeSelects();
    setInvokeHandler((cmd) => (cmd === "connection_sync" ? syncResult : null));
    useAppStore.setState({ testMode: true });
    await runConnectionSyncs(qcStub(), { todayISO: TODAY, force: true });
    useAppStore.setState({ testMode: false, presentationMode: true });
    await runConnectionSyncs(qcStub(), { todayISO: TODAY, force: true });
    expect(invokedCommands).toHaveLength(0);
  });

  it("only syncs the asked connection with connectionId", async () => {
    routeSelects({ conns: [conn(), conn({ id: 5, label: "NAS", kind: "synology" })] });
    setInvokeHandler((cmd) => (cmd === "connection_sync" ? { devices: [] } : null));
    await runConnectionSyncs(qcStub(), { todayISO: TODAY, force: true, connectionId: 5 });
    const ids = invokedCommands.filter((c) => c.cmd === "connection_sync").map((c) => c.args.id);
    expect(ids).toEqual([5]);
  });
});

describe("runConnectionSyncs: one pass at a time", () => {
  it("Sync now during a background pass waits for it, then runs its own forced pass", async () => {
    routeSelects({ conns: [conn()] });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let calls = 0;
    setInvokeHandler(async (cmd) => {
      if (cmd !== "connection_sync") return null;
      calls += 1;
      if (calls === 1) await gate;
      return syncResult;
    });
    const background = runConnectionSyncs(qcStub(), { todayISO: TODAY });
    await new Promise((r) => setTimeout(r, 0));
    const now = runConnectionSyncs(qcStub(), { todayISO: TODAY, force: true, connectionId: 2 });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
    release();
    await Promise.all([background, now]);
    expect(calls).toBe(2);
  });

  it("a background pass during another one is skipped", async () => {
    routeSelects({ conns: [conn()] });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setInvokeHandler(async (cmd) => {
      if (cmd === "connection_sync") { await gate; return syncResult; }
      return null;
    });
    const first = runConnectionSyncs(qcStub(), { todayISO: TODAY });
    await new Promise((r) => setTimeout(r, 0));
    await runConnectionSyncs(qcStub(), { todayISO: TODAY });
    release();
    await first;
    expect(invokedCommands.filter((c) => c.cmd === "connection_sync")).toHaveLength(1);
  });

  it("readings that fail to store are recorded as a sync failure", async () => {
    routeSelects();
    setInvokeHandler((cmd) => (cmd === "connection_sync" ? syncResult : null));
    setBatchFailure((stmts) =>
      stmts.some((x) => x.sql.includes("machine_readings")) ? new Error("database is locked") : null
    );
    await runConnectionSyncs(qcStub(), { todayISO: TODAY });
    const recorded = executedStatements.find((x) => x.sql.includes("UPDATE connections"));
    expect(recorded?.sql).toMatch(/failing_since\s*=\s*COALESCE/);
    expect(recorded?.params).toContain("Error: database is locked");
  });
});

describe("usage forecasts outside a sync", () => {
  it("mark done on a usage item stores the current reading and re-forecasts at once", async () => {
    // After the write the item reads back as done at 250.
    const done = () => executedStatements.some((s) => s.sql.includes("INSERT INTO service_log"));
    setSelectHandler((sql) => {
      if (sql.includes("FROM upkeep_items")) return [usageItem(done() ? { last_done_reading: 250, last_done_on: TODAY } : {})];
      if (sql.includes("FROM machines")) return [machine()];
      if (sql.includes("FROM machine_readings") && sql.includes("LIMIT 1")) return [{ value: 150 }];
      if (sql.includes("FROM machine_readings")) {
        return [{ value: 140, read_at: "2026-10-18 10:00:00" }, { value: 150, read_at: "2026-10-28 10:00:00" }];
      }
      return [];
    });
    await markDoneWithForecast(9, TODAY, null, undefined, TODAY);

    const log = batchStmts().find((s) => s.sql.includes("INSERT INTO service_log"));
    expect(log?.params).toContain(250);
    // 200 left at 1 h/day.
    const due = batchStmts().find((s) => s.sql.includes("UPDATE upkeep_items SET next_due_on"));
    expect(due?.params).toEqual(["2027-05-16", 9]);
    expect(syncItemCalendar).toHaveBeenCalledWith(9);
  });

  it("a typed current reading is stored and re-forecasts the machine's usage items", async () => {
    routeSelects({ machines: [machine({ connection_id: null, device_id: null, reading_baseline: null })] });
    await recordManualReading(machine({ connection_id: null, device_id: null, reading_baseline: null }), 150, TODAY);
    const reading = batchStmts().find((s) => s.sql.includes("INSERT INTO machine_readings"));
    expect(reading?.params.slice(0, 3)).toEqual([3, "print_hours", 150]);
    expect(batchStmts().some((s) => s.sql.includes("UPDATE upkeep_items SET next_due_on"))).toBe(true);
    expect(syncItemCalendar).toHaveBeenCalledWith(9);
  });

  it("a new or edited usage item is forecast before its Calendar sync", async () => {
    routeSelects();
    await syncItemWithForecast(9, {}, TODAY);
    const due = batchStmts().find((s) => s.sql.includes("UPDATE upkeep_items SET next_due_on"));
    expect(due?.params).toEqual(["2026-12-17", 9]);
    expect(syncItemCalendar).toHaveBeenCalledWith(9, {});
  });
});
