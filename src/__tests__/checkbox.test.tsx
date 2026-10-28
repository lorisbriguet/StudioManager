import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { Checkbox, Radio } from "../components/ui/Checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("is a real checkbox: change events carry shiftKey and the target", () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="Select row" checked={false} onChange={(e) => onChange(e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)} />);
    const box = screen.getByRole("checkbox", { name: "Select row" });
    fireEvent.click(box, { shiftKey: true });
    expect(onChange).toHaveBeenCalledWith(true, true);
  });

  it("toggles from its label and shows a description", () => {
    const onChange = vi.fn();
    render(<Checkbox label="Show income" description="Adds the Income page" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByText("Show income"));
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /Show income/ })).toBeInTheDocument();
    expect(screen.getByText("Adds the Income page")).toBeInTheDocument();
  });

  it("supports indeterminate (select-all with some rows selected) and forwards ref", () => {
    const ref = createRef<HTMLInputElement>();
    const { rerender } = render(<Checkbox ref={ref} aria-label="Select all" checked={false} indeterminate onChange={() => {}} />);
    expect(ref.current?.indeterminate).toBe(true);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
    rerender(<Checkbox ref={ref} aria-label="Select all" checked onChange={() => {}} />);
    expect(ref.current?.indeterminate).toBe(false);
  });
});

describe("Radio", () => {
  it("works as a native radio group", () => {
    const onA = vi.fn();
    const onB = vi.fn();
    render(
      <>
        <Radio name="seed" label="Start empty" checked onChange={onA} />
        <Radio name="seed" label="Copy from current" checked={false} onChange={onB} />
      </>
    );
    fireEvent.click(screen.getByRole("radio", { name: "Copy from current" }));
    expect(onB).toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Start empty" })).toBeChecked();
  });
});
