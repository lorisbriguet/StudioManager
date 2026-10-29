import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { createRef } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { IconButton } from "../components/ui/IconButton";
import { usePopover } from "../components/ui/Popover";

afterEach(cleanup);

describe("IconButton", () => {
  it("is a labelled button, type=button by default, with a tooltip instead of a native title", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<IconButton icon={Pencil} label="Edit" onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Edit" });
    expect(btn).not.toHaveAttribute("title");
    expect(btn).toHaveAttribute("type", "button");
    fireEvent.mouseEnter(btn);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Edit");
    // The tooltip repeats the name: not linked as a description (said once, not twice).
    expect(btn).not.toHaveAttribute("aria-describedby");
    fireEvent.mouseLeave(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
    vi.useRealTimers();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("has two fixed sizes: sm 26px box + 14px icon, xs 20px box + 12px icon", () => {
    const { rerender } = render(<IconButton icon={Pencil} label="Edit" />);
    let btn = screen.getByRole("button");
    expect(btn.className).toContain("w-6.5 h-6.5");
    expect(btn.querySelector("svg")).toHaveAttribute("width", "14");
    rerender(<IconButton icon={Pencil} label="Edit" size="xs" />);
    btn = screen.getByRole("button");
    expect(btn.className).toContain("w-5 h-5");
    expect(btn.querySelector("svg")).toHaveAttribute("width", "12");
  });

  it("reveal can target a named group", () => {
    render(<IconButton icon={Pencil} label="Edit" reveal="task" />);
    expect(screen.getByRole("button").className).toContain("group-hover/task:opacity-100");
  });

  it("applies tone, reveal and active classes", () => {
    render(<IconButton icon={Trash2} label="Delete" tone="danger" reveal active />);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("hover:text-[var(--color-danger-text)]");
    expect(cls).toContain("group-hover:opacity-100");
    expect(cls).toContain("bg-[var(--color-hover-row)]");
  });

  it("does not fire when disabled", () => {
    const onClick = vi.fn();
    render(<IconButton icon={Trash2} label="Delete" disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards ref (works as a usePopover trigger)", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton ref={ref} icon={Pencil} label="Edit" />);
    expect(ref.current).toBe(screen.getByRole("button"));

    function Trigger() {
      const pop = usePopover();
      return (
        <>
          <IconButton icon={Pencil} label="Columns" {...pop.triggerProps} />
          <span data-testid="state">{String(pop.open)}</span>
        </>
      );
    }
    cleanup();
    render(<Trigger />);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByTestId("state")).toHaveTextContent("true");
    expect(screen.getByRole("button", { name: "Columns" })).toHaveAttribute("aria-expanded", "true");
  });

  it("links a tooltip that adds to the name (a shortcut hint) as a description", () => {
    vi.useFakeTimers();
    render(<IconButton icon={Pencil} label="Edit" title="Edit (⌘E)" />);
    const btn = screen.getByRole("button", { name: "Edit" });
    fireEvent.mouseEnter(btn);
    act(() => vi.advanceTimersByTime(500));
    expect(btn).toHaveAttribute("aria-describedby", screen.getByRole("tooltip").id);
    vi.useRealTimers();
  });

  it("pressed: a toggle with aria-pressed and the active look; active alone stays visual", () => {
    const { rerender } = render(<IconButton icon={Pencil} label="Edit mode" pressed={false} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(<IconButton icon={Pencil} label="Edit mode" pressed />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(btn.className).toContain("bg-[var(--color-hover-row)]");
    rerender(<IconButton icon={Pencil} label="Menu" active />);
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-pressed");
  });
});
