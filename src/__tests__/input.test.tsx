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
    expect(el.className).toContain("px-2.5 py-1 text-xs leading-4 border rounded-md");
    expect(el.className).toContain("w-full");
    fireEvent.change(el, { target: { value: "Atelier Noir" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("default, bare and inline variants", () => {
    render(
      <>
        <Input aria-label="Hours" fullWidth={false} />
        <Input aria-label="Cell" variant="bare" />
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

  it("does not leak the width prop onto the element", () => {
    render(<Input aria-label="Qty" width="sm" />);
    expect(screen.getByRole("textbox", { name: "Qty" })).not.toHaveAttribute("width");
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

  it("starts at 3 rows, grows to 12, then scrolls", () => {
    render(<Textarea aria-label="Notes" />);
    const el = screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement;
    // 3 and 12 lines of leading-relaxed (1.625em) + padding and border
    expect(el.style.minHeight).toBe("calc(4.875em + 10px)");
    expect(el.style.maxHeight).toBe("calc(19.5em + 10px)");
    expect(el.className).toContain("[field-sizing:content]");
    expect(el.className).toContain("overflow-y-auto");
  });

  it("follows its content where field-sizing is missing (JS fallback)", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    const { rerender } = render(<Textarea aria-label="Notes" value="a" onChange={() => {}} />);
    const el = screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement;
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 120 });
    rerender(<Textarea aria-label="Notes" value={"a\nb\nc\nd\ne"} onChange={() => {}} />);
    expect(el.style.height).toBe("122px");
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 60 });
    fireEvent.input(el);
    expect(el.style.height).toBe("62px");
    vi.unstubAllGlobals();
  });

  it("fill takes the parent's height and doesn't grow or resize", () => {
    render(<Textarea aria-label="Note" fill />);
    const el = screen.getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement;
    expect(el.className).toContain("h-full");
    expect(el.className).toContain("resize-none");
    expect(el.className).not.toContain("field-sizing");
    expect(el.style.minHeight).toBe("");
  });
});
