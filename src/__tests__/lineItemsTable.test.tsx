import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";
import { LineItemsTable } from "../components/shared/LineItemsTable";
import { makeLineItem, useLineItemForm, type LineItem } from "../lib/lineItems";
import { useAppStore } from "../stores/app-store";

/**
 * Renders LineItemsTable wired through the real useLineItemForm hook, the
 * same way InvoiceFormPage/QuoteFormPage do — including the parent pattern of
 * wrapping onDragEnd with dirty tracking (spy stands in for markDirty).
 */
function Harness({
  initial,
  onReorderCommit,
}: {
  initial: LineItem[];
  onReorderCommit?: () => void;
}) {
  const form = useLineItemForm(initial);
  return (
    <LineItemsTable
      items={form.items}
      lineItemIds={form.lineItemIds}
      sensors={form.sensors}
      onDragEnd={(e: DragEndEvent) => {
        form.handleDragEnd(e);
        onReorderCommit?.();
      }}
      onAdd={form.addItem}
      onRemove={form.removeItem}
      onUpdate={form.updateItem}
      subtotal={0}
      discountRate={0}
      discountAmount={0}
      total={0}
    />
  );
}

function makeItems() {
  return [
    makeLineItem({ designation: "Alpha" }),
    makeLineItem({ designation: "Beta" }),
    makeLineItem({ designation: "Gamma" }),
  ];
}

/** Designation inputs are the only textboxes; their values reflect row order. */
function rowOrder(): string[] {
  return screen
    .getAllByRole("textbox")
    .map((el) => (el as HTMLInputElement).value);
}

describe("LineItemsTable move up/down buttons", () => {
  beforeEach(() => {
    useAppStore.setState({ language: "EN" });
  });

  it("move down swaps a row with its next neighbor", () => {
    render(<Harness initial={makeItems()} />);
    expect(rowOrder()).toEqual(["Alpha", "Beta", "Gamma"]);

    fireEvent.click(screen.getAllByLabelText("Move down")[0]);
    expect(rowOrder()).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("move up swaps a row with its previous neighbor", () => {
    render(<Harness initial={makeItems()} />);

    fireEvent.click(screen.getAllByLabelText("Move up")[2]);
    expect(rowOrder()).toEqual(["Alpha", "Gamma", "Beta"]);
  });

  it("disables move up on the first row and move down on the last row, keeping buttons rendered", () => {
    render(<Harness initial={makeItems()} />);

    const ups = screen.getAllByLabelText("Move up");
    const downs = screen.getAllByLabelText("Move down");
    // Buttons render on every row for stable layout
    expect(ups).toHaveLength(3);
    expect(downs).toHaveLength(3);

    expect(ups[0]).toBeDisabled();
    expect(ups[1]).not.toBeDisabled();
    expect(ups[2]).not.toBeDisabled();
    expect(downs[0]).not.toBeDisabled();
    expect(downs[1]).not.toBeDisabled();
    expect(downs[2]).toBeDisabled();
  });

  it("commits button reorders through onDragEnd so parent dirty wrappers fire", () => {
    const commitSpy = vi.fn();
    render(<Harness initial={makeItems()} onReorderCommit={commitSpy} />);

    fireEvent.click(screen.getAllByLabelText("Move down")[0]);
    expect(commitSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByLabelText("Move up")[2]);
    expect(commitSpy).toHaveBeenCalledTimes(2);
  });
});
