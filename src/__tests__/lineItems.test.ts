import { describe, it, expect } from "vitest";
import { makeLineItem, toPersistedLineItems } from "../lib/lineItems";

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
