import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { DropdownSelect } from "../components/ui/Dropdown";
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

  it("a pick in a Select inside the popover keeps the popover open", () => {
    function DatePickerLike() {
      const pop = usePopover();
      const [reminder, setReminder] = useState("none");
      return (
        <>
          <button type="button" {...pop.triggerProps}>Due date</button>
          {pop.open && (
            <Popover anchor={pop.anchorRef} onClose={pop.close} role="dialog" aria-label="Date picker">
              <DropdownSelect
                aria-label="Reminder"
                value={reminder}
                onChange={setReminder}
                options={[
                  { value: "none", label: "No reminder" },
                  { value: "1d", label: "1 day before" },
                ]}
              />
            </Popover>
          )}
        </>
      );
    }
    render(<DatePickerLike />);
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Reminder" }));
    const option = screen.getByRole("option", { name: "1 day before" });
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(screen.getByRole("dialog", { name: "Date picker" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Reminder" })).toHaveTextContent("1 day before");
    // a click outside both still closes everything
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fades in only once placed, never from the top-left corner", () => {
    // No anchor and no point: the panel cannot be placed yet.
    const { unmount } = render(
      <Popover onClose={vi.fn()} padding="content" aria-label="Unplaced">
        x
      </Popover>
    );
    const unplaced = screen.getByRole("dialog", { name: "Unplaced" });
    expect(unplaced.className).not.toContain("animate-in");
    expect(unplaced.style.opacity).toBe("0");
    unmount();
    render(
      <Popover at={{ x: 120, y: 80 }} onClose={vi.fn()} padding="content" aria-label="Placed">
        x
      </Popover>
    );
    const placed = screen.getByRole("dialog", { name: "Placed" });
    expect(placed.className).toContain("animate-in");
    expect(placed.style.opacity).toBe("");
  });

  it("is placed on the element itself, parked off screen (not at 0,0) until then", () => {
    const { unmount } = render(
      <Popover onClose={vi.fn()} padding="content" aria-label="Unplaced">
        x
      </Popover>
    );
    const unplaced = screen.getByRole("dialog", { name: "Unplaced" });
    expect(unplaced.style.top).toBe("-9999px");
    expect(unplaced.style.left).toBe("-9999px");
    unmount();
    render(
      <Popover at={{ x: 120, y: 80 }} onClose={vi.fn()} padding="content" aria-label="Placed">
        x
      </Popover>
    );
    const placed = screen.getByRole("dialog", { name: "Placed" });
    // Right-click gap is 2 px; the window is 1024 wide in jsdom, so nothing is clamped.
    expect(placed.style.left).toBe("120px");
    expect(placed.style.top).toBe("82px");
    expect(placed.style.pointerEvents).toBe("");
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
