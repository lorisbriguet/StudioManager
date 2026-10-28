import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StrictMode } from "react";
import { Popover, usePopover } from "../components/ui/Popover";

afterEach(cleanup);

function Harness({ autoFocus, onRowClick = vi.fn() }: { autoFocus?: boolean; onRowClick?: () => void }) {
  const pop = usePopover();
  return (
    <StrictMode>
      <div onClick={onRowClick} onKeyDown={onRowClick}>
        <button type="button" {...pop.triggerProps}>
          Columns
        </button>
        {pop.open && (
          <Popover anchor={pop.anchorRef} onClose={pop.close} padding="content" aria-label="Column editor" role="dialog" autoFocus={autoFocus}>
            <label>
              Name
              <input defaultValue="Hours" />
            </label>
            <button type="button">Save</button>
          </Popover>
        )}
      </div>
    </StrictMode>
  );
}

describe("Popover", () => {
  it("opens from its trigger and focuses the first field", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Columns" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Column editor" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
  });

  it("leaves focus alone when autoFocus is off", () => {
    render(<Harness autoFocus={false} />);
    const trigger = screen.getByRole("button", { name: "Columns" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Esc, returns focus, and Esc never reaches document listeners", () => {
    const docEscape = vi.fn();
    const onDoc = (e: KeyboardEvent) => e.key === "Escape" && docEscape();
    document.addEventListener("keydown", onDoc);
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Columns" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(docEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onDoc);
  });

  it("closes on a click outside but not on a click inside", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.mouseDown(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the trigger toggles it closed (no close-then-reopen)", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Columns" });
    fireEvent.click(trigger);
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicks and keys inside do not reach the anchor's React ancestors", () => {
    const onRowClick = vi.fn();
    render(<Harness onRowClick={onRowClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    onRowClick.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Enter" });
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("can open at a point (right-click)", () => {
    const onClose = vi.fn();
    render(
      <Popover at={{ x: 40, y: 60 }} onClose={onClose} role="menu" aria-label="Row actions">
        <button type="button">Delete</button>
      </Popover>
    );
    expect(screen.getByRole("menu", { name: "Row actions" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledWith(false);
  });
});
