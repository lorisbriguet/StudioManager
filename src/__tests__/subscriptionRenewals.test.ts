import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getDb } from "../db";
import { executedStatements, clearExecutedStatements, setSelectHandler } from "../__mocks__/tauri-sql";
import { nextRenewalFrom, rollRenewals } from "../lib/upkeep/renewals";
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

  it("three missed months: one renewal, the latest, and the date moves past today", () => {
    const r = rollRenewals(sub(), "2026-10-28");
    expect(r.renewedOn).toEqual(["2026-09-30"]);
    expect(r.nextRenewsOn).toBe("2026-10-31");
  });

  it("a date years back asks once, not once per month since", () => {
    // The original subscription date typed as "renews on" (monthly, 2024).
    const r = rollRenewals(sub({ renews_on: "2024-01-15", anchor_day: 15 }), "2026-10-28");
    expect(r.renewedOn).toEqual(["2026-10-15"]);
    expect(r.nextRenewsOn).toBe("2026-11-15");
    const y = rollRenewals(sub({ renews_on: "2020-03-01", anchor_day: 1, period: "year" }), "2026-10-28");
    expect(y).toEqual({ renewedOn: ["2026-03-01"], nextRenewsOn: "2027-03-01" });
  });

  it("cancelled never renews", () => {
    const r = rollRenewals(sub({ status: "cancelled" }), "2026-10-28");
    expect(r).toEqual({ renewedOn: [], nextRenewsOn: "2026-07-31" });
  });
});

describe("nextRenewalFrom (the form's roll-forward)", () => {
  it("keeps today and future dates", () => {
    expect(nextRenewalFrom("2026-10-28", "month", "2026-10-28")).toBe("2026-10-28");
    expect(nextRenewalFrom("2027-01-05", "year", "2026-10-28")).toBe("2027-01-05");
  });

  it("moves a past date to the next renewal on or after today, by the cycle", () => {
    expect(nextRenewalFrom("2024-01-15", "month", "2026-10-28")).toBe("2026-11-15");
    expect(nextRenewalFrom("2024-01-15", "month", "2026-10-15")).toBe("2026-10-15");
    expect(nextRenewalFrom("2020-03-01", "year", "2026-10-28")).toBe("2027-03-01");
  });

  it("keeps a month-end day across short months", () => {
    expect(nextRenewalFrom("2026-01-31", "month", "2026-02-10")).toBe("2026-02-28");
    expect(nextRenewalFrom("2026-01-31", "month", "2026-03-01")).toBe("2026-03-31");
    expect(nextRenewalFrom("2024-02-29", "year", "2025-01-01")).toBe("2025-02-28");
  });
});

describe("applyRenewals", () => {
  beforeAll(async () => { await getDb(); });
  beforeEach(() => { clearExecutedStatements(); setSelectHandler(null); });

  it("is idempotent", async () => {
    const s = sub();
    expect(await applyRenewals(s, "2026-10-28")).toBe(1);
    const inserts = executedStatements.filter((x) => x.sql.includes("INSERT OR IGNORE INTO subscription_renewals"));
    // One question per subscription per check, however far back the date was.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toEqual([1, "2026-09-30", 10, "CHF"]);
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
