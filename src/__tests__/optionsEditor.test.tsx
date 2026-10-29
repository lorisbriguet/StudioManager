import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OptionsEditor, type EditableOption } from "../components/shared/OptionsEditor";
import { useAppStore } from "../stores/app-store";

const LISTS = [
  { id: 1, name: "Priorities" },
  { id: 2, name: "Statuses" },
];

const OPTIONS: EditableOption[] = [
  { value: "Todo", color: "blue" },
  { value: "Done", color: "green" },
];

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
});

afterEach(() => {
  cleanup();
});

describe("OptionsEditor", () => {
  it("adds an option with the picked colour from the + button", () => {
    const onChange = vi.fn();
    render(<OptionsEditor label="Options" options={OPTIONS} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("New option..."), { target: { value: "  Doing " } });
    fireEvent.click(screen.getByRole("button", { name: "New option..." }));
    expect(onChange).toHaveBeenCalledWith([...OPTIONS, { value: "Doing", color: "gray" }]);
  });

  it("ignores an empty or duplicate option", () => {
    const onChange = vi.fn();
    render(<OptionsEditor options={OPTIONS} onChange={onChange} />);
    const field = screen.getByPlaceholderText("New option...");
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.change(field, { target: { value: "Todo" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes an option", () => {
    const onChange = vi.fn();
    render(<OptionsEditor options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(onChange).toHaveBeenCalledWith([OPTIONS[1]]);
  });

  it("Enter in the add field adds the option without submitting the surrounding form", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <OptionsEditor options={[]} onChange={onChange} />
        <button type="submit">Submit</button>
      </form>
    );
    const field = screen.getByPlaceholderText("New option...");
    fireEvent.change(field, { target: { value: "Urgent" } });
    const notCancelled = fireEvent.keyDown(field, { key: "Enter" });
    expect(notCancelled).toBe(false); // preventDefault: no implicit submission
    expect(onChange).toHaveBeenCalledWith([{ value: "Urgent", color: "gray" }]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses addLabel for the add field and its button", () => {
    render(<OptionsEditor options={[]} onChange={vi.fn()} addLabel="New item..." />);
    expect(screen.getByPlaceholderText("New item...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New item..." })).toBeInTheDocument();
  });

  it("imports from a custom list through onLink", () => {
    const onLink = vi.fn();
    render(<OptionsEditor label="Options" options={OPTIONS} onChange={vi.fn()} lists={LISTS} onLink={onLink} />);
    fireEvent.click(screen.getByRole("button", { name: "Import from list" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Statuses" }));
    expect(onLink).toHaveBeenCalledWith(2);
  });

  it("shows a disabled 'no lists' row when there are no custom lists", () => {
    const onLink = vi.fn();
    render(<OptionsEditor label="Options" options={[]} onChange={vi.fn()} lists={[]} onLink={onLink} />);
    fireEvent.click(screen.getByRole("button", { name: "Import from list" }));
    const row = screen.getByRole("menuitem", { name: "No custom lists yet" });
    expect(row).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(row);
    expect(onLink).not.toHaveBeenCalled();
  });

  it("while linked: shows the list, read-only rows, and unlinks through onUnlink", () => {
    const onChange = vi.fn();
    const onUnlink = vi.fn();
    render(
      <OptionsEditor
        label="Options"
        options={OPTIONS}
        onChange={onChange}
        lists={LISTS}
        linkedListId={1}
        onLink={vi.fn()}
        onUnlink={onUnlink}
        onSaveAsList={vi.fn()}
      />
    );
    expect(screen.getByText("Priorities")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import from list" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("New option...")).not.toBeInTheDocument();
    expect(screen.queryByText("Save as list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(onUnlink).toHaveBeenCalled();
  });

  it("saves the options as a list on Enter, without submitting the surrounding form", async () => {
    const onSaveAsList = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <OptionsEditor options={OPTIONS} onChange={vi.fn()} onSaveAsList={onSaveAsList} />
      </form>
    );
    fireEvent.click(screen.getByRole("button", { name: "Save as list" }));
    const name = screen.getByRole("textbox", { name: "List name" });
    fireEvent.change(name, { target: { value: " Phases " } });
    expect(fireEvent.keyDown(name, { key: "Enter" })).toBe(false);
    expect(onSaveAsList).toHaveBeenCalledWith("Phases");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Save as list" })).toBeInTheDocument();
  });

  it("Esc in the list name closes only that field", () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <OptionsEditor options={OPTIONS} onChange={vi.fn()} onSaveAsList={vi.fn()} />
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: "Save as list" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "List name" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "List name" })).not.toBeInTheDocument();
    expect(outer).not.toHaveBeenCalled();
  });

  it("without colours, options are names renamed in place", () => {
    const onChange = vi.fn();
    render(<OptionsEditor options={[{ value: "Todo" }, { value: "Done" }]} onChange={onChange} colors={false} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Done"), { target: { value: "Finished" } });
    expect(onChange).toHaveBeenCalledWith([{ value: "Todo" }, { value: "Finished" }]);
    fireEvent.change(screen.getByPlaceholderText("New option..."), { target: { value: "Doing" } });
    fireEvent.keyDown(screen.getByPlaceholderText("New option..."), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith([{ value: "Todo" }, { value: "Done" }, { value: "Doing" }]);
  });
});
