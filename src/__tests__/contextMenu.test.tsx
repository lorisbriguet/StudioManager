import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";

// All renders are wrapped in StrictMode on purpose: the focus capture/restore
// logic must survive React 19's double render and double effect invocation.

function Harness({ items }: { items: ContextMenuItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && <ContextMenu x={10} y={10} items={items} onClose={() => setOpen(false)} />}
    </div>
  );
}

function renderHarness() {
  const editSpy = vi.fn();
  const duplicateSpy = vi.fn();
  const disabledSpy = vi.fn();
  const deleteSpy = vi.fn();
  const items: ContextMenuItem[] = [
    { label: "Edit", onClick: editSpy },
    { label: "Duplicate", onClick: duplicateSpy },
    { label: "", divider: true, onClick: () => {} },
    { label: "Locked", onClick: disabledSpy, disabled: true },
    { label: "Delete", onClick: deleteSpy, danger: true },
  ];
  render(
    <StrictMode>
      <Harness items={items} />
    </StrictMode>
  );
  const trigger = screen.getByTestId("trigger");
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, editSpy, duplicateSpy, disabledSpy, deleteSpy };
}

const focused = () => document.activeElement as HTMLElement;

afterEach(cleanup);

describe("ContextMenu keyboard and focus behavior", () => {
  it("opens with role=menu and focus on the first enabled menuitem", () => {
    renderHarness();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // Disabled items keep role=menuitem; the divider is a separator, not an item.
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });

  it("cycles with ArrowDown/ArrowUp, skipping disabled items and wrapping", () => {
    renderHarness();
    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
    // Skips the disabled "Locked" item.
    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    // Wraps from last back to first.
    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    // ArrowUp wraps from first to last enabled item.
    fireEvent.keyDown(focused(), { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    fireEvent.keyDown(focused(), { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
  });

  it("jumps to first/last enabled item with Home and End", () => {
    renderHarness();
    fireEvent.keyDown(focused(), { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    fireEvent.keyDown(focused(), { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });

  it("activates the focused item with Enter, then closes and restores focus", () => {
    const { trigger, duplicateSpy } = renderHarness();
    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    fireEvent.keyDown(focused(), { key: "Enter" });
    expect(duplicateSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape and restores focus to the pre-open element", () => {
    const { trigger, editSpy, deleteSpy } = renderHarness();
    fireEvent.keyDown(focused(), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(editSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("still activates items by mouse click and ignores clicks on disabled items", () => {
    const { disabledSpy, deleteSpy } = renderHarness();
    fireEvent.click(screen.getByRole("menuitem", { name: "Locked" }));
    expect(disabledSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on mousedown outside the menu without activating anything", () => {
    const { editSpy } = renderHarness();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(editSpy).not.toHaveBeenCalled();
  });
});
