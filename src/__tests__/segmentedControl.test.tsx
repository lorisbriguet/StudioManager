import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { SegmentedControl } from "../components/ui/SegmentedControl";

afterEach(cleanup);

type Pos = "left" | "center" | "right" | "hide";

function Harness({ onChange = vi.fn() }: { onChange?: (v: Pos) => void }) {
  const [v, setV] = useState<Pos>("left");
  return (
    <SegmentedControl<Pos>
      aria-label="Logo position"
      value={v}
      onChange={(next) => {
        setV(next);
        onChange(next);
      }}
      options={[
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
        { value: "right", label: "Right", disabled: true },
        { value: "hide", label: "Hidden" },
      ]}
    />
  );
}

describe("SegmentedControl", () => {
  it("is a radio group with the current value checked and one tab stop", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Logo position" })).toBeInTheDocument();
    const left = screen.getByRole("radio", { name: "Left" });
    expect(left).toHaveAttribute("aria-checked", "true");
    expect(left).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Center" })).toHaveAttribute("tabindex", "-1");
  });

  it("selects on click, and not again for the current value", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Left" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Center" }));
    expect(onChange).toHaveBeenCalledWith("center");
    expect(screen.getByRole("radio", { name: "Center" })).toHaveAttribute("aria-checked", "true");
  });

  it("arrow keys move and select, skipping disabled options and wrapping", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("center");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("hide");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Hidden" }));
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("left");
    fireEvent.keyDown(group, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("hide");
  });
});
