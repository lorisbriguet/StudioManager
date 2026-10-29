import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { InlineRename } from "../components/ui/InlineRename";

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof InlineRename>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<InlineRename value="Logos" label="Rename" onSave={onSave} onCancel={onCancel} className="text-sm font-medium" {...props} />);
  const field = screen.getByRole("textbox", { name: "Rename" }) as HTMLInputElement;
  return { onSave, onCancel, field };
}

describe("InlineRename", () => {
  it("opens focused, named, and keeps the row's text size", () => {
    const { field } = setup();
    expect(field).toHaveFocus();
    expect(field.value).toBe("Logos");
    expect(field.className).toContain("focus-accent");
    expect(field.className).not.toContain("text-xs");
    expect(field.parentElement!.className).toContain("text-sm font-medium");
  });

  it("Enter saves the trimmed name and doesn't submit the form", () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    const onSave = vi.fn();
    render(
      <form onSubmit={(e) => onSubmit(e.nativeEvent)}>
        <InlineRename value="Logos" label="Rename" onSave={onSave} onCancel={() => {}} />
      </form>
    );
    const field = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(field, { target: { value: "  Brand  " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("Brand");
    expect(onSubmit).not.toHaveBeenCalled();
    // The blur that follows doesn't save twice
    fireEvent.blur(field);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("blur saves", () => {
    const { field, onSave } = setup();
    fireEvent.change(field, { target: { value: "Brand" } });
    fireEvent.blur(field);
    expect(onSave).toHaveBeenCalledWith("Brand");
  });

  it("Esc cancels without reaching the dialog", () => {
    const outer = vi.fn();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <div onKeyDown={outer}>
        <InlineRename value="Logos" label="Rename" onSave={onSave} onCancel={onCancel} />
      </div>
    );
    const field = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(field, { target: { value: "Brand" } });
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });

  it("an empty or unchanged name cancels", () => {
    const { field, onSave, onCancel } = setup();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    cleanup();
    const second = setup();
    fireEvent.change(second.field, { target: { value: "   " } });
    fireEvent.blur(second.field);
    expect(second.onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(second.onSave).not.toHaveBeenCalled();
  });

  it("validate shows an error and keeps the field open", () => {
    const { field, onSave } = setup({ validate: (n) => (n === "Taken" ? "Name taken" : undefined) });
    fireEvent.change(field, { target: { value: "Taken" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Name taken");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    // Typing clears it
    fireEvent.change(field, { target: { value: "Fresh" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an outside error and allows another try after a failed save", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValueOnce(undefined);
    render(<InlineRename value="Logos" label="Rename" onSave={onSave} onCancel={() => {}} error="Could not rename" />);
    const field = screen.getByRole("textbox", { name: "Rename" });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not rename");
    fireEvent.change(field, { target: { value: "Brand" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});
