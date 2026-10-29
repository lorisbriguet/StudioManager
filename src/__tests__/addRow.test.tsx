import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { AddRow } from "../components/ui/AddRow";

afterEach(cleanup);

describe("AddRow", () => {
  it("Enter adds the trimmed text, clears, and doesn't submit the form", () => {
    const onAdd = vi.fn();
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <AddRow placeholder="New task" onAdd={onAdd} />
      </form>
    );
    const field = screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "  Draft logo  " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("Draft logo");
    expect(field.value).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("the + button adds; empty text adds nothing", () => {
    const onAdd = vi.fn();
    render(<AddRow placeholder="New option" onAdd={onAdd} size="xs" />);
    const button = screen.getByRole("button", { name: "New option" });
    fireEvent.click(button);
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "New option" }), { target: { value: "Red" } });
    fireEvent.click(button);
    expect(onAdd).toHaveBeenCalledWith("Red");
    // xs button: 20px
    expect(button.className).toContain("w-5 h-5");
  });

  it("returning false keeps the text (a duplicate)", () => {
    render(<AddRow placeholder="New option" onAdd={() => false} />);
    const field = screen.getByRole("textbox", { name: "New option" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Red" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("Red");
  });

  it("clears once a returned promise resolves, keeps the text if it rejects", async () => {
    let resolve!: () => void;
    const { rerender } = render(<AddRow placeholder="New subtask" onAdd={() => new Promise<void>((r) => (resolve = r))} />);
    const field = screen.getByRole("textbox", { name: "New subtask" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Sketch" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("Sketch");
    await act(async () => resolve());
    expect(field.value).toBe("");

    rerender(<AddRow placeholder="New subtask" onAdd={() => Promise.reject(new Error("db"))} />);
    fireEvent.change(field, { target: { value: "Ink" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(field.value).toBe("Ink");
  });

  it("puts extra controls before the + and passes other keys on", () => {
    const onKeyDown = vi.fn();
    render(
      <AddRow placeholder="New list" onAdd={() => {}} onKeyDown={onKeyDown}>
        <button type="button">Colour</button>
      </AddRow>
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("Colour");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New list" }), { key: "Escape" });
    expect(onKeyDown).toHaveBeenCalled();
  });
});
