import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { useState } from "react";
import { Calendar, DatePicker, parseLocalDate } from "../components/ui/DatePicker";
import { useAppStore } from "../stores/app-store";

afterEach(cleanup);
beforeEach(() => useAppStore.setState({ language: "EN", dateFormat: "dd.MM.yyyy" }));

function Harness({ initial = "2026-10-14", onChange = vi.fn() }: { initial?: string | null; onChange?: (v: string | null) => void }) {
  const [v, setV] = useState<string | null>(initial);
  return (
    <DatePicker
      aria-label="Due date"
      value={v}
      onChange={(next) => {
        setV(next);
        onChange(next);
      }}
    />
  );
}

describe("DatePicker", () => {
  it("shows the formatted date and opens a calendar on that month", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Due date" });
    expect(trigger).toHaveTextContent("14.10.2026");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/october 2026/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /14 October 2026/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("picks a day as yyyy-MM-dd and closes", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    fireEvent.click(screen.getByRole("button", { name: /20 October 2026/ }));
    expect(onChange).toHaveBeenCalledWith("2026-10-20");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clears to null", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));
    fireEvent.click(screen.getByRole("button", { name: /clear date/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows the placeholder when empty", () => {
    render(<Harness initial={null} />);
    expect(screen.getByRole("button", { name: "Due date" })).toHaveTextContent("No date");
  });
});

describe("Calendar", () => {
  it("starts weeks on Monday and follows the app language", () => {
    useAppStore.setState({ language: "FR" });
    render(<Calendar selected={parseLocalDate("2026-10-01")} onSelect={() => {}} />);
    expect(screen.getByText(/octobre 2026/i)).toBeInTheDocument();
    expect(screen.getByText("Lu")).toBeInTheDocument();
    // 1 Oct 2026 is a Thursday: three empty cells before it
    const firstDay = screen.getByRole("button", { name: /\b1 octobre 2026/ });
    expect(firstDay).toHaveAttribute("aria-pressed", "true");
  });

  it("tints the days between a range start and end", () => {
    render(
      <Calendar selected={parseLocalDate("2026-10-05")} selectedEnd={parseLocalDate("2026-10-08")} onSelect={() => {}} />
    );
    expect(screen.getByRole("button", { name: /\b6 October 2026/ }).className).toContain("bg-accent-tint-strong");
    expect(screen.getByRole("button", { name: /\b8 October 2026/ })).toHaveAttribute("aria-pressed", "true");
  });
});
