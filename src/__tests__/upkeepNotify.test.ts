import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/notifyError", async () => {
  const { uiLabels } = await vi.importActual<typeof import("../i18n/ui")>("../i18n/ui");
  return { notifyError: vi.fn(), getLabels: vi.fn(() => uiLabels.EN) };
});

import { planNotifications, type PlanInput } from "../lib/upkeep/notify";
import { getLabels } from "../lib/notifyError";
import { updateMachine } from "../db/queries/machines";
import { executedStatements, clearExecutedStatements } from "../__mocks__/tauri-sql";
import type {
  Connection, Consumable, Machine, MachineDisk, Subscription, UpkeepItem,
} from "../types/upkeep";

const TODAY = "2026-10-28";

function machine(over: Partial<Machine> = {}): Machine {
  return {
    id: 3, name: "Bambu X1", kind: "printer", maker: null, model: null, serial: null,
    location: null, status: "working", lent_to: null, lent_until: null, purchase_date: null,
    supplier: null, price: null, currency: null, expense_id: null, warranty_until: null,
    warranty_notified_for: null, lifespan_years: null, photo_path: null, notes: null,
    template_key: null, connection_id: null, device_id: null, reading_baseline: null, linked_at: null,
    created_at: "", updated_at: "", ...over,
  };
}
function item(over: Partial<UpkeepItem> = {}): UpkeepItem {
  return {
    id: 7, machine_id: 3, title: "Clean nozzle", notes: null, schedule: "interval",
    interval_n: 3, interval_unit: "month", anchor_day: 1, usage_metric: null, usage_every: null,
    last_done_on: null, last_done_reading: null, next_due_on: "2026-10-20", snooze_until: null,
    in_calendar: 0, alert: "default", calendar_event_id: null, calendar_event_date: null,
    overdue_notified_for: null, archived: 0, created_at: "", updated_at: "", ...over,
  };
}
function consumable(over: Partial<Consumable> = {}): Consumable {
  return {
    id: 2, name: "PLA white", machine_id: 3, unit: "kg", stock: 0.5, reorder_level: 1,
    supplier: null, product_url: null, unit_price: null, currency: null, low_notified: 0,
    created_at: "", updated_at: "", ...over,
  };
}
function disk(over: Partial<MachineDisk> = {}): MachineDisk {
  return {
    id: 4, machine_id: 3, slot: "Drive 1", model: null, serial: "S1", size_bytes: null,
    power_on_hours: null, health: "warning", notified_health: null, bad_sectors: null,
    temperature: null, first_seen: "", last_read_at: "", ...over,
  };
}
function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: 5, name: "Figma", plan: null, vendor: null, url: null, renews_on: "2026-11-05",
    anchor_day: 5, period: "month", cost: 15, currency: "CHF", status: "active", in_calendar: 0,
    alert: "default", calendar_event_id: null, coming_notified_for: null, notes: null,
    created_at: "", updated_at: "", ...over,
  };
}
function renewal(over: Record<string, unknown> = {}) {
  return {
    id: 9, subscription_id: 5, renewed_on: "2026-10-27", amount: 15, currency: "CHF",
    decision: "pending" as const, expense_id: null, notified: 0, name: "Figma", ...over,
  };
}
function conn(over: Partial<Connection> = {}): Connection {
  return {
    id: 1, kind: "synology", label: "NAS", host: null, port: null, region: null, account: null,
    cert_fingerprint: null, last_sync_at: null, last_ok_at: null, last_error: "boom",
    failing_since: "2026-10-24", failing_notified: 0, created_at: "", updated_at: "", ...over,
  };
}
function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    items: [], machines: [machine()], consumables: [], subs: [], pendingRenewals: [], disks: [],
    connections: [], todayISO: TODAY, windows: { warrantyDays: 60, renewalDays: 14 }, ...over,
  };
}

describe("planNotifications", () => {
  it("overdue fires once, marker is the effective due date", () => {
    const [n, ...rest] = planNotifications(input({ items: [item()] }));
    expect(rest).toEqual([]);
    expect(n).toMatchObject({ cause: "overdue", refId: 7, marker: "2026-10-20", link: "/upkeep/machines/3" });
    expect(n.title).toBeTruthy();
    expect(n.message).toContain("Clean nozzle");
    expect(n.message).toContain("Bambu X1");
    expect(planNotifications(input({ items: [item({ overdue_notified_for: "2026-10-20" })] }))).toEqual([]);
  });

  it("overdue notifies once after a long gap (due 3 cycles ago)", () => {
    const out = planNotifications(input({ items: [item({ next_due_on: "2026-01-20" })] }));
    expect(out).toHaveLength(1);
    expect(out[0].marker).toBe("2026-01-20");
  });

  it("overdue fires again for a new due date after snooze", () => {
    const it = item({ next_due_on: "2026-10-20", snooze_until: "2026-10-27", overdue_notified_for: "2026-10-20" });
    const out = planNotifications(input({ items: [it] }));
    expect(out).toHaveLength(1);
    expect(out[0].marker).toBe("2026-10-27");
  });

  it("not overdue today or in the future; archived items skipped", () => {
    expect(planNotifications(input({ items: [item({ next_due_on: TODAY })] }))).toEqual([]);
    expect(planNotifications(input({ items: [item({ archived: 1 })] }))).toEqual([]);
  });

  it("retired machine's items never notify", () => {
    expect(planNotifications(input({
      machines: [machine({ status: "retired" })], items: [item()],
    }))).toEqual([]);
  });

  it("low stock fires once", () => {
    const out = planNotifications(input({ consumables: [consumable()] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cause: "low_stock", refId: 2, marker: "1", link: "/upkeep?tab=consumables" });
    expect(planNotifications(input({ consumables: [consumable({ low_notified: 1 })] }))).toEqual([]);
    expect(planNotifications(input({ consumables: [consumable({ stock: 2 })] }))).toEqual([]);
  });

  it("disk worse fires once per step, never when it improves", () => {
    const first = planNotifications(input({ disks: [disk()] }));
    expect(first[0]).toMatchObject({ cause: "disk", refId: 4, marker: "warning", link: "/upkeep/machines/3" });
    expect(planNotifications(input({ disks: [disk({ notified_health: "warning" })] }))).toEqual([]);
    const worse = planNotifications(input({ disks: [disk({ health: "failing", notified_health: "warning" })] }));
    expect(worse[0].marker).toBe("failing");
    expect(planNotifications(input({ disks: [disk({ health: "warning", notified_health: "failing" })] }))).toEqual([]);
    expect(planNotifications(input({ disks: [disk({ health: "healthy" })] }))).toEqual([]);
  });

  it("warranty fires once inside the window, marker is the date", () => {
    const out = planNotifications(input({ machines: [machine({ warranty_until: "2026-12-01" })] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cause: "warranty", refId: 3, marker: "2026-12-01" });
    expect(planNotifications(input({ machines: [machine({ warranty_until: "2026-12-01", warranty_notified_for: "2026-12-01" })] }))).toEqual([]);
    expect(planNotifications(input({ machines: [machine({ warranty_until: "2027-03-01" })] }))).toEqual([]);
    expect(planNotifications(input({ machines: [machine({ warranty_until: "2026-10-01" })] }))).toEqual([]);
    expect(planNotifications(input({ machines: [machine({ warranty_until: "2026-12-01", status: "retired" })] }))).toEqual([]);
  });

  it("renewal coming fires once per renews_on", () => {
    const out = planNotifications(input({ subs: [sub()] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cause: "renewal_coming", refId: 5, marker: "2026-11-05", link: "/upkeep?tab=subscriptions" });
    expect(planNotifications(input({ subs: [sub({ coming_notified_for: "2026-11-05" })] }))).toEqual([]);
    expect(planNotifications(input({ subs: [sub({ renews_on: "2026-12-05" })] }))).toEqual([]);
    expect(planNotifications(input({ subs: [sub({ status: "cancelled" })] }))).toEqual([]);
  });

  it("renewal happened: one notice per un-notified pending renewal", () => {
    const out = planNotifications(input({ pendingRenewals: [renewal(), renewal({ id: 10, notified: 1 })] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cause: "renewal_happened", refId: 9, marker: "1", link: "/upkeep?tab=subscriptions" });
  });

  it("connection failing fires after 3 days, once", () => {
    const out = planNotifications(input({ connections: [conn()] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cause: "connection", refId: 1, marker: "1" });
    expect(planNotifications(input({ connections: [conn({ failing_since: "2026-10-26" })] }))).toEqual([]);
    expect(planNotifications(input({ connections: [conn({ failing_notified: 1 })] }))).toEqual([]);
    expect(planNotifications(input({ connections: [conn({ failing_since: null })] }))).toEqual([]);
  });

  it("titles come from i18n, EN and FR", async () => {
    const { uiLabels } = await vi.importActual<typeof import("../i18n/ui")>("../i18n/ui");
    const [en] = planNotifications(input({ items: [item()] }));
    expect(en.title).toBe(uiLabels.EN.notice_overdue_title);
    vi.mocked(getLabels).mockReturnValue(uiLabels.FR);
    const [fr] = planNotifications(input({ items: [item()] }));
    expect(fr.title).toBe(uiLabels.FR.notice_overdue_title);
    expect(fr.title).not.toBe(en.title);
    vi.mocked(getLabels).mockReturnValue(uiLabels.EN);
  });
});

describe("updateMachine warranty marker", () => {
  it("resets warranty_notified_for when warranty_until changes, keeps it when unchanged", async () => {
    clearExecutedStatements();
    await updateMachine(3, { warranty_until: "2027-01-01" });
    const stmt = executedStatements.find((s) => s.sql.startsWith("UPDATE machines"))!;
    expect(stmt.sql).toMatch(/warranty_notified_for = CASE WHEN warranty_until IS \$1 THEN warranty_notified_for ELSE NULL END/);
    expect(stmt.params).toEqual(["2027-01-01", 3]);
    clearExecutedStatements();
    await updateMachine(3, { name: "X" });
    expect(executedStatements[0].sql).not.toContain("warranty_notified_for");
  });
});
