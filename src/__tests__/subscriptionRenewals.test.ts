import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getDb } from "../db";
import { executedStatements, clearExecutedStatements, setSelectHandler } from "../__mocks__/tauri-sql";
import { rollRenewals } from "../lib/upkeep/renewals";
import { applyRenewals, yearlyTotal } from "../db/queries/subscriptions";
import type { Subscription } from "../types/upkeep";

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: 1, name: "Adobe", plan: null, vendor: null, url: null,
    renews_on: "2026-07-31", anchor_day: 31, period: "month", cost: 10, currency: "CHF",
    status: "active", in_calendar: 1, alert: "week_before", calendar_event_id: null,
    coming_notified_for: null, notes: null, created_at: "", updated_at: "",
    ...over,
  };
}

describe("rollRenewals", () => {
  it("none before date", () => {
    const r = rollRenewals(sub({ renews_on: "2026-11-05", anchor_day: 5 }), "2026-10-28");
    expect(r).toEqual({ renewedOn: [], nextRenewsOn: "2026-11-05" });
  });

  it("on the day renews once", () => {
    const r = rollRenewals(sub({ renews_on: "2026-10-28", anchor_day: 28 }), "2026-10-28");
    expect(r).toEqual({ renewedOn: ["2026-10-28"], nextRenewsOn: "2026-11-28" });
  });

  it("catches up three missed months", () => {
    const r = rollRenewals(sub(), "2026-10-28");
    expect(r.renewedOn).toEqual(["2026-07-31", "2026-08-31", "2026-09-30"]);
    expect(r.nextRenewsOn).toBe("2026-10-31");
  });

  it("cancelled never renews", () => {
    const r = rollRenewals(sub({ status: "cancelled" }), "2026-10-28");
    expect(r).toEqual({ renewedOn: [], nextRenewsOn: "2026-07-31" });
  });
});

describe("applyRenewals", () => {
  beforeAll(async () => { await getDb(); });
  beforeEach(() => { clearExecutedStatements(); setSelectHandler(null); });

  it("is idempotent", async () => {
    const s = sub();
    expect(await applyRenewals(s, "2026-10-28")).toBe(3);
    const inserts = executedStatements.filter((x) => x.sql.includes("INSERT OR IGNORE INTO subscription_renewals"));
    expect(inserts).toHaveLength(3);
    expect(inserts[0].params).toEqual([1, "2026-07-31", 10, "CHF"]);
    const upd = executedStatements.find((x) => x.sql.includes("UPDATE subscriptions SET renews_on"));
    expect(upd!.params).toEqual(["2026-10-31", 1]);

    clearExecutedStatements();
    const advanced = sub({ renews_on: "2026-10-31" });
    expect(await applyRenewals(advanced, "2026-10-28")).toBe(0);
    expect(executedStatements).toHaveLength(0);
  });
});

describe("yearlyTotal", () => {
  it("keeps currencies apart", () => {
    const t = yearlyTotal([
      sub({ cost: 10, currency: "CHF", period: "month" }),
      sub({ cost: 100, currency: "CHF", period: "year" }),
      sub({ cost: 5, currency: "EUR", period: "month" }),
      sub({ cost: 99, currency: "EUR", status: "cancelled" }),
      sub({ cost: 3, currency: null, period: "month" }),
    ]);
    expect(t.get("CHF")).toBe(220);
    expect(t.get("EUR")).toBe(60);
    expect(t.get("")).toBe(36);
  });
});
