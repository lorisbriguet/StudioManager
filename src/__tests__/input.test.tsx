import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { Input, Textarea, fieldClass } from "../components/ui/Input";

afterEach(cleanup);

describe("Input", () => {
  it("is sm by default and forwards ref and events", () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(<Input ref={ref} aria-label="Name" defaultValue="Atelier" onChange={onChange} />);
    const el = screen.getByRole("textbox", { name: "Name" });
    expect(ref.current).toBe(el);
    // sm by default: same height as the thin Select trigger
    expect(el.className).toContain("px-2.5 py-1 text-xs rounded-md");
    expect(el.className).toContain("w-full");
    fireEvent.change(el, { target: { value: "Atelier Noir" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("sm, bare and inline variants", () => {
    render(
      <>
        <Input aria-label="Hours" size="sm" fullWidth={false} />
        <Input aria-label="Cell" variant="bare" size="sm" />
        <Input aria-label="Rename" variant="inline" />
      </>
    );
    const sm = screen.getByRole("textbox", { name: "Hours" }).className;
    expect(sm).toContain("text-xs");
    expect(sm).not.toContain("w-full");
    expect(screen.getByRole("textbox", { name: "Cell" }).className).toContain("border-transparent");
    const inline = screen.getByRole("textbox", { name: "Rename" }).className;
    expect(inline).toContain("border-b border-accent");
    expect(inline).not.toContain("text-sm");
  });

  it("does not leak the size prop onto the element", () => {
    render(<Input aria-label="Qty" size="sm" />);
    expect(screen.getByRole("textbox", { name: "Qty" })).not.toHaveAttribute("size");
  });
});

describe("Textarea", () => {
  it("defaults to 3 rows with the field look", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} aria-label="Notes" />);
    const el = screen.getByRole("textbox", { name: "Notes" });
    expect(ref.current).toBe(el);
    expect(el).toHaveAttribute("rows", "3");
    expect(el.className).toContain(fieldClass());
  });
});
