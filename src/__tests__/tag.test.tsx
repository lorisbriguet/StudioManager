import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Tag } from "../components/ui/Tag";
import { FilterChip } from "../components/ui/FilterChip";
import { CountBadge } from "../components/ui/Badge";
import { getTagColor, getStoredTagColor } from "../lib/tagColors";
import { useAppStore } from "../stores/app-store";

afterEach(cleanup);
beforeEach(() => useAppStore.setState({ language: "EN", darkMode: false }));

describe("Tag", () => {
  it("colours itself from the name with CSS variables (dark mode is the stylesheet's job)", () => {
    render(<Tag name="typography" />);
    const el = screen.getByText("typography").parentElement!;
    expect(el.style.background).toBe(getTagColor("typography").bg);
    expect(el.style.color).toBe(getTagColor("typography").text);
    expect(el.style.background).toMatch(/^var\(--color-tag-[a-z]+-bg\)$/);
  });

  it("uses a stored colour name when given, including legacy names", () => {
    render(<Tag name="Urgent" color="pink" />);
    expect(screen.getByText("Urgent").parentElement!.style.background).toBe(getStoredTagColor("pink").bg);
  });

  it("shows a labelled remove button that does not bubble", () => {
    const onRemove = vi.fn();
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <Tag name="web" onRemove={onRemove} />
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove tag web" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("is a button when clickable, and children replace the visible label", () => {
    const onClick = vi.fn();
    render(<Tag name="side_income" onClick={onClick}>Side income</Tag>);
    fireEvent.click(screen.getByRole("button", { name: "Side income" }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("FilterChip", () => {
  it("toggles aria-pressed and shows a count", () => {
    const { rerender } = render(<FilterChip active={false} count={3}>Overdue</FilterChip>);
    const chip = screen.getByRole("button", { name: /Overdue/ });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveTextContent("3");
    rerender(<FilterChip active count={3}>Overdue</FilterChip>);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip.className).toContain("bg-accent");
  });

  it("a tag filter uses the tag colour when on", () => {
    render(<FilterChip active tag="print" />);
    const chip = screen.getByRole("button", { name: "print" });
    expect(chip.style.background).toBe(getTagColor("print").bg);
    expect(chip.className).not.toContain("bg-accent");
  });

  it("CountBadge caps large numbers", () => {
    render(<CountBadge value={140} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });
});
