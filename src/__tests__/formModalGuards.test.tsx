import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { useState } from "react";
import { FormModal } from "../components/ui/Form";
import { FormField } from "../components/ui/FormField";
import { Input } from "../components/ui/Input";
import { DatePicker } from "../components/ui/DatePicker";
import { useAppStore } from "../stores/app-store";
import { pressEnter } from "./fixtures/form";

// FormModal guards: an invalid typed date never submits, a held Enter or a
// slow async save never submits twice, and a backdrop click never throws away
// a form the user has changed.

afterEach(cleanup);
beforeEach(() => useAppStore.setState({ language: "EN", dateFormat: "dd.MM.yyyy" }));

function DateForm({ onSubmit }: { onSubmit: () => void }) {
  const [d, setD] = useState<string | null>("2026-10-14");
  return (
    <FormModal open title="Make recurring" submitLabel="Save" onSubmit={onSubmit} onClose={() => {}}>
      <FormField label="Start">
        <DatePicker value={d} onChange={setD} />
      </FormField>
    </FormModal>
  );
}

describe("FormModal with an invalid date", () => {
  it("Enter on unparseable text doesn't submit and flags the field", () => {
    const onSubmit = vi.fn();
    render(<DateForm onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Start");
    fireEvent.change(field, { target: { value: "31.02.2026" } });
    pressEnter(field);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a valid date")).toBeInTheDocument();
  });

  it("the submit button doesn't submit while the date is invalid, and focuses it", () => {
    const onSubmit = vi.fn();
    render(<DateForm onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Start");
    fireEvent.change(field, { target: { value: "31.02.2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(field);
  });

  it("submits once the date is fixed", () => {
    const onSubmit = vi.fn();
    render(<DateForm onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Start");
    fireEvent.change(field, { target: { value: "31.02.2026" } });
    pressEnter(field);
    fireEvent.change(field, { target: { value: "28.02.2026" } });
    pressEnter(field);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("FormModal double submit", () => {
  function NameForm({ onSubmit }: { onSubmit: () => void | Promise<unknown> }) {
    return (
      <FormModal open title="New expense" submitLabel="Save" onSubmit={onSubmit} onClose={() => {}}>
        <FormField label="Name">
          <Input value="x" onChange={() => {}} />
        </FormField>
      </FormModal>
    );
  }

  it("a held Enter (key repeat) submits once", () => {
    const onSubmit = vi.fn();
    render(<NameForm onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Name");
    pressEnter(field);
    for (let i = 0; i < 5; i++) {
      const notCancelled = fireEvent.keyDown(field, { key: "Enter", repeat: true });
      if (notCancelled) fireEvent.submit(field.closest("form")!);
    }
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("rapid Enters while an async onSubmit is in flight submit once", async () => {
    let release!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((r) => { release = r; }));
    render(<NameForm onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Name");
    pressEnter(field);
    pressEnter(field);
    // While it saves the primary shows the spinner (its name gains "Loading").
    const save = screen.getByRole("button", { name: /Save/ });
    expect(save).toHaveAttribute("aria-busy", "true");
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => release());
    pressEnter(field);
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

describe("FormModal backdrop", () => {
  function Closable({ dirty }: { dirty?: boolean }) {
    const [open, setOpen] = useState(true);
    const [v, setV] = useState("");
    return (
      <FormModal open={open} title="Column" submitLabel="Save" onSubmit={() => {}} onClose={() => setOpen(false)} dirty={dirty}>
        <FormField label="Name">
          <Input value={v} onChange={(e) => setV(e.target.value)} />
        </FormField>
      </FormModal>
    );
  }
  const backdrop = () => screen.getByRole("dialog").parentElement!;
  const clickBackdrop = () => {
    fireEvent.mouseDown(backdrop());
    fireEvent.click(backdrop());
  };

  it("closes a clean form", () => {
    render(<Closable />);
    clickBackdrop();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a form the user typed in; Esc and Cancel still close it", () => {
    render(<Closable />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Hours" } });
    clickBackdrop();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a form marked dirty by its caller", () => {
    render(<Closable dirty />);
    clickBackdrop();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a drag that starts inside the dialog and ends on the backdrop doesn't close", () => {
    render(<Closable />);
    fireEvent.mouseDown(screen.getByLabelText("Name"));
    fireEvent.click(backdrop());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
