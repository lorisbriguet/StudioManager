import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { IconButton } from "../components/ui/IconButton";
import { usePopover } from "../components/ui/Popover";

afterEach(cleanup);

describe("IconButton", () => {
  it("is a labelled button with a matching title, type=button by default", () => {
    const onClick = vi.fn();
    render(<IconButton icon={Pencil} label="Edit" onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Edit" });
    expect(btn).toHaveAttribute("title", "Edit");
    expect(btn).toHaveAttribute("type", "button");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("sizes the icon from size", () => {
    const { rerender } = render(<IconButton icon={Pencil} label="Edit" size="xs" />);
    expect(screen.getByRole("button").querySelector("svg")).toHaveAttribute("width", "12");
    rerender(<IconButton icon={Pencil} label="Edit" size="md" />);
    expect(screen.getByRole("button").querySelector("svg")).toHaveAttribute("width", "16");
    rerender(<IconButton icon={Pencil} label="Edit" iconSize={18} />);
    expect(screen.getByRole("button").querySelector("svg")).toHaveAttribute("width", "18");
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
});
