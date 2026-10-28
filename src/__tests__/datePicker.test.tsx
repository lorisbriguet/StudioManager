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
  it("shows the value in the app format and opens a calendar on that month", () => {
    render(<Harness />);
    const field = screen.getByRole("textbox", { name: "Due date" });
    expect(field).toHaveValue("14.10.2026");
    fireEvent.click(screen.getByRole("button", { name: "Pick a date" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/october 2026/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /14 October 2026/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("picking a day fills the field as yyyy-MM-dd and closes", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick a date" }));
    fireEvent.click(screen.getByRole("button", { name: /20 October 2026/ }));
    expect(onChange).toHaveBeenCalledWith("2026-10-20");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Due date" })).toHaveValue("20.10.2026");
  });

  it("commits as soon as a typed date is complete, in the app format or ISO", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const field = screen.getByRole("textbox", { name: "Due date" });
    fireEvent.change(field, { target: { value: "01.11.202" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "01.11.2026" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-11-01");
    fireEvent.change(field, { target: { value: "3.1.2027" } });
    expect(onChange).toHaveBeenLastCalledWith("2027-01-03");
    fireEvent.change(field, { target: { value: "2026-12-24" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-12-24");
  });

  it("never commits a half-typed year, and accepts a two-digit year on Enter", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const field = screen.getByRole("textbox", { name: "Due date" });
    for (const step of ["1.2.2", "1.2.20", "1.2.202"]) {
      fireEvent.change(field, { target: { value: step } });
    }
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "1.2.26" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("2026-02-01");
    expect(field).toHaveValue("01.02.2026");
  });

  it("a date that does not exist is kept and flagged, not changed", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const field = screen.getByRole("textbox", { name: "Due date" });
    fireEvent.change(field, { target: { value: "31.02.2026" } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
    expect(field).toHaveValue("31.02.2026");
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("Esc undoes the typing without reaching a surrounding dialog", () => {
    const docEscape = vi.fn();
    const onDoc = (e: KeyboardEvent) => e.key === "Escape" && docEscape();
    document.addEventListener("keydown", onDoc);
    render(<Harness />);
    const field = screen.getByRole("textbox", { name: "Due date" });
    fireEvent.change(field, { target: { value: "31.1" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field).toHaveValue("14.10.2026");
    expect(docEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onDoc);
  });

  it("Enter reaches the caller after the value is committed", () => {
    const seen: (string | null)[] = [];
    function Form() {
      const [v, setV] = useState<string | null>("2026-10-14");
      return <DatePicker aria-label="Paid" value={v} onChange={setV} onKeyDown={(e) => e.key === "Enter" && seen.push(v)} />;
    }
    render(<Form />);
    const field = screen.getByRole("textbox", { name: "Paid" });
    fireEvent.change(field, { target: { value: "02.11.2026" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(seen).toEqual(["2026-11-02"]);
  });

  it("emptying the field clears to null", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Due date" }), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("follows the app date format", () => {
    useAppStore.setState({ dateFormat: "MM/dd/yyyy" });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const field = screen.getByRole("textbox", { name: "Due date" });
    expect(field).toHaveValue("10/14/2026");
    fireEvent.change(field, { target: { value: "12/25/2026" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-12-25");
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
