import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { Search } from "lucide-react";
import { Input } from "../components/ui/Input";
import { FormField } from "../components/ui/FormField";

afterEach(cleanup);

describe("Input numeric", () => {
  it("is a number field with right-aligned tabular digits and no spinner", () => {
    render(<Input aria-label="Rate" numeric step="0.01" />);
    const el = screen.getByRole("spinbutton", { name: "Rate" });
    expect(el).toHaveAttribute("type", "number");
    expect(el).toHaveAttribute("step", "0.01");
    expect(el.className).toContain("text-right tabular-nums");
    expect(el.className).toContain("[appearance:textfield]");
    expect(el.className).toContain("[&::-webkit-inner-spin-button]:appearance-none");
  });

  it("keeps an explicit type", () => {
    render(<Input aria-label="Code" numeric type="text" />);
    expect(screen.getByRole("textbox", { name: "Code" }).className).toContain("tabular-nums");
  });
});

describe("Input unit", () => {
  it("shows the unit inside the box and reads it with the field", () => {
    render(<Input aria-label="Amount" numeric unit="CHF" width="md" className="mt-2" />);
    const el = screen.getByRole("spinbutton", { name: "Amount" });
    const unit = screen.getByText("CHF");
    expect(el.parentElement).toBe(unit.parentElement);
    expect(unit.className).toContain("text-muted");
    // The typed text stays clear of the unit
    expect(el.style.paddingRight).toContain("3ch");
    expect(el.getAttribute("aria-describedby")).toBe(unit.id);
    // width and className go on the wrapper
    expect(el.parentElement!.className).toContain("w-36");
    expect(el.parentElement!.className).toContain("mt-2");
    expect(el.className).toContain("w-full");
  });

  it("keeps the caller's aria-describedby", () => {
    render(<Input aria-label="Discount" unit="%" aria-describedby="hint" />);
    const el = screen.getByRole("textbox", { name: "Discount" });
    expect(el.getAttribute("aria-describedby")).toBe(`hint ${screen.getByText("%").id}`);
  });
});

describe("Input icon and onClear", () => {
  it("draws a leading icon and a clear button while there is a value", () => {
    const onClear = vi.fn();
    const ref = createRef<HTMLInputElement>();
    const { rerender } = render(
      <Input ref={ref} aria-label="Find" icon={Search} value="logo" onChange={() => {}} onClear={onClear} clearLabel="Clear search" />
    );
    const el = screen.getByRole("textbox", { name: "Find" });
    expect(ref.current).toBe(el);
    expect(el.className).toContain("pl-7");
    expect(el.className).toContain("pr-7");
    expect(el.parentElement!.querySelector("svg")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onClear).toHaveBeenCalledTimes(1);

    rerender(<Input aria-label="Find" icon={Search} value="" onChange={() => {}} onClear={onClear} clearLabel="Clear search" />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("takes a trailing control of its own", () => {
    render(<Input aria-label="Due" trailing={<button type="button">Pick</button>} />);
    expect(screen.getByRole("button", { name: "Pick" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Due" }).className).toContain("pr-7");
  });
});

describe("Input width", () => {
  it("xs / sm / md replace the full width", () => {
    render(
      <>
        <Input aria-label="H" width="xs" />
        <Input aria-label="Pct" width="sm" />
        <Input aria-label="Amt" width="md" />
        <Input aria-label="Name" />
      </>
    );
    const cls = (n: string) => screen.getByRole("textbox", { name: n }).className;
    expect(cls("H")).toContain("w-16");
    expect(cls("H")).not.toContain("w-full");
    expect(cls("Pct")).toContain("w-24");
    expect(cls("Amt")).toContain("w-36");
    expect(cls("Name")).toContain("w-full");
  });
});

describe("Input readOnly and detected", () => {
  it("readOnly: no fill, dashed border, muted text", () => {
    render(<Input aria-label="Linked" readOnly value="Red" />);
    const el = screen.getByRole("textbox", { name: "Linked" });
    expect(el).toHaveAttribute("readonly");
    expect(el.className).toContain("bg-transparent");
    expect(el.className).toContain("border-dashed");
    expect(el.className).toContain("text-muted");
    expect(el.className).not.toContain("bg-[var(--color-input-bg)]");
  });

  it("detected swaps the border colour, and an error border still wins", () => {
    render(
      <FormField label="Amount" error="Required">
        <Input detected />
      </FormField>
    );
    const el = screen.getByRole("textbox", { name: "Amount" });
    expect(el.className).toContain("border-accent");
    expect(el.className).not.toContain("border-[var(--color-input-border)]");
    expect(el.className).not.toContain("!border");
    // The error is a variant class: it applies over the resting colour.
    expect(el.className).toContain("aria-[invalid=true]:border-danger-text");
    expect(el).toHaveAttribute("aria-invalid", "true");
  });
});
