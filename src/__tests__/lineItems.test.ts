import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { makeLineItem, toPersistedLineItems, round2, useLineItemForm } from "../lib/lineItems";

describe("makeLineItem", () => {
  it("creates a line item with defaults", () => {
    const item = makeLineItem();
    expect(item.designation).toBe("");
    expect(item.rate).toBeNull();
    expect(item.unit).toBeNull();
    expect(item.quantity).toBe(1);
    expect(item.amount).toBe(0);
    expect(item._id).toBeGreaterThan(0);
  });

  it("accepts partial overrides", () => {
    const item = makeLineItem({ designation: "Design", rate: 150, quantity: 2 });
    expect(item.designation).toBe("Design");
    expect(item.rate).toBe(150);
    expect(item.quantity).toBe(2);
  });

  it("generates unique IDs", () => {
    const a = makeLineItem();
    const b = makeLineItem();
    expect(a._id).not.toBe(b._id);
  });
});

describe("round2", () => {
  it("rounds binary float dust to exact 2 decimals: 3 × 21.90 = 65.7", () => {
    expect(3 * 21.9).not.toBe(65.7); // the raw float problem being fixed
    expect(round2(3 * 21.9)).toBe(65.7);
  });

  it("rounds a 10% discount exactly: 100.10 × 0.9 = 90.09", () => {
    expect(round2(100.1 * 0.9)).toBe(90.09);
  });

  it("rounds classic float addition: 0.1 + 0.2 = 0.3", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it("rounds the halfway case 1.005 (stored as 1.00499…) up to 1.01", () => {
    expect(round2(1.005)).toBe(1.01);
  });

  it("is idempotent: rounding an already-rounded value is a no-op", () => {
    expect(round2(round2(3 * 21.9))).toBe(65.7);
    expect(round2(65.7)).toBe(65.7);
  });

  it("handles negatives and zero", () => {
    expect(round2(0)).toBe(0);
    expect(round2(-(3 * 21.9))).toBe(-65.7);
  });

  // Review finding D20: negative halves used to round toward +∞.
  it("rounds negative halves away from zero, mirroring positives", () => {
    expect(round2(0.01 * -38.5)).toBe(-0.39);
    expect(round2(-1.15 * 3.5)).toBe(-4.03);
    expect(round2(-1.005)).toBe(-1.01);
    let wrong = 0;
    for (let c = 0; c < 200_000; c += 7) {
      const n = (c * 10 + 5) / 1000;
      if (round2(-n) !== -round2(n)) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it("never returns a negative zero", () => {
    expect(Object.is(round2(-0.004), 0)).toBe(true);
    expect(Object.is(round2(-0), 0)).toBe(true);
  });

  // Review finding D19: half-centimes above ~CHF 2 used to round down.
  it("rounds half-centime line amounts up: 57.30 × 42.35 = 2426.655 → 2426.66", () => {
    expect(round2(57.3 * 42.35)).toBe(2426.66);
  });

  it("rounds half-centime line amounts up: 1.15 × 3.5 = 4.025 → 4.03", () => {
    expect(round2(1.15 * 3.5)).toBe(4.03);
  });

  it("rounds a half-centime discount up: 10 % of 40.15 = 4.015 → 4.02", () => {
    expect(round2(40.15 * 0.1)).toBe(4.02);
  });

  it("does not double-round: 1.138 × 0.25 = 0.2845 → 0.28", () => {
    expect(round2(1.138 * 0.25)).toBe(0.28);
  });

  it("rounds half-centimes from 0.005 to 20'000 up (every 7th)", () => {
    let wrong = 0;
    for (let c = 0; c < 2_000_000; c += 7) {
      if (round2((c * 10 + 5) / 1000) !== (c + 1) / 100) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it("rounds products of 2-decimal rates and quarter-hour quantities like integer centimes", () => {
    let wrong = 0;
    for (let rate = 1; rate <= 50_000; rate += 7) {
      for (let q = 1; q <= 40; q++) {
        // exact result in 1/10'000 CHF, rounded half up to centimes
        const tenThousandths = rate * q * 25;
        const expected = Math.floor((tenThousandths + 50) / 100) / 100;
        if (round2((rate / 100) * (q / 4)) !== expected) wrong++;
      }
    }
    expect(wrong).toBe(0);
  });
});

describe("useLineItemForm amount computation", () => {
  it("stores round2(rate × quantity) as the line-item amount", () => {
    const { result } = renderHook(() => useLineItemForm());
    act(() => result.current.updateItem(0, "rate", 21.9));
    act(() => result.current.updateItem(0, "quantity", 3));
    expect(result.current.items[0].amount).toBe(65.7);
  });

  it("recomputes a rounded amount when rate changes", () => {
    const { result } = renderHook(() => useLineItemForm());
    act(() => result.current.updateItem(0, "quantity", 0.9));
    act(() => result.current.updateItem(0, "rate", 100.1));
    expect(result.current.items[0].amount).toBe(90.09);
  });
});

describe("toPersistedLineItems", () => {
  it("strips _id and adds sort_order", () => {
    const items = [
      makeLineItem({ designation: "A" }),
      makeLineItem({ designation: "B" }),
    ];
    const persisted = toPersistedLineItems(items);
    expect(persisted[0]).not.toHaveProperty("_id");
    expect(persisted[0].sort_order).toBe(0);
    expect(persisted[1].sort_order).toBe(1);
    expect(persisted[0].designation).toBe("A");
  });
});
