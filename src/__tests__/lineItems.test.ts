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
