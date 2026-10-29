import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FormLayout, FormGrid, FormGridItem, FormSection, FormActions, FormModal } from "../components/ui/Form";
import { FormField } from "../components/ui/FormField";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";

afterEach(cleanup);

describe("FormModal", () => {
  it("submits from the primary button and on Enter, with Cancel before it", () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(
      <FormModal open title="New client" submitLabel="Save" onSubmit={onSubmit} onClose={onClose}>
        <FormGrid cols={2}>
          <FormField label="Name"><Input value="" onChange={() => {}} /></FormField>
          <FormGridItem><span>note</span></FormGridItem>
        </FormGrid>
      </FormModal>
    );
    const save = screen.getByRole("button", { name: "Save" });
    const footer = save.parentElement!;
    const names = Array.from(footer.querySelectorAll("button")).map((b) => b.textContent);
    expect(names.slice(-2)).toEqual(["Cancel", "Save"]);
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByText("note").parentElement!.className).toContain("col-span-full");
  });

  it("does not submit while disabled", () => {
    const onSubmit = vi.fn();
    render(
      <FormModal open title="New client" submitLabel="Save" submitDisabled onSubmit={onSubmit} onClose={() => {}}>
        <FormField label="Name"><Input value="" onChange={() => {}} /></FormField>
      </FormModal>
    );
    fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Form layout", () => {
  it("links the label to its field and shows a hint under it", () => {
    render(
      <FormField label="Billing address" hint="Taken from the client">
        <Input value="" onChange={() => {}} />
      </FormField>
    );
    const field = screen.getByLabelText("Billing address");
    const hint = screen.getByText("Taken from the client");
    expect(field.getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("shows the error in place of the hint, and keeps the hint linked for screen readers", () => {
    render(
      <FormField label="PO number" hint="PO-0000" error="Wrong format">
        <Input value="" onChange={() => {}} />
      </FormField>
    );
    const hint = screen.getByText("PO-0000");
    expect(hint).toHaveClass("sr-only");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Wrong format");
    const field = screen.getByLabelText("PO number");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(`${hint.id} ${alert.id}`);
  });

  it("merges the child's own aria-describedby with the hint and the error", () => {
    render(
      <FormField label="Amount" hint="In CHF" error="Required">
        <Input value="" onChange={() => {}} aria-describedby="own-note" />
      </FormField>
    );
    const ids = screen.getByLabelText("Amount").getAttribute("aria-describedby")!.split(" ");
    expect(ids[0]).toBe("own-note");
    expect(ids).toHaveLength(3);
  });

  it("lays fields in a grid with one gap, and a field can span the row", () => {
    render(
      <FormGrid cols={3}>
        <FormField label="A"><Input value="" onChange={() => {}} /></FormField>
        <FormField label="B" span="full"><Input value="" onChange={() => {}} /></FormField>
      </FormGrid>
    );
    const grid = screen.getByLabelText("A").closest(".grid")!;
    expect(grid.className).toContain("grid-cols-3");
    expect(grid.className).toContain("gap-3");
    expect(screen.getByLabelText("B").parentElement!.className).toContain("col-span-full");
  });

  it("titles a section and right-aligns actions with the destructive one on the left", () => {
    render(
      <FormLayout as="form">
        <FormSection title="Client"><span /></FormSection>
        <FormActions destructive={<Button variant="danger">Delete</Button>}>
          <Button variant="secondary">Cancel</Button>
          <Button>Create</Button>
        </FormActions>
      </FormLayout>
    );
    expect(screen.getByRole("heading", { name: "Client" })).toBeTruthy();
    const row = screen.getByRole("button", { name: "Create" }).parentElement!;
    expect(row.className).toContain("justify-end");
    const names = Array.from(row.querySelectorAll("button")).map((b) => b.textContent);
    expect(names).toEqual(["Delete", "Cancel", "Create"]);
    expect(screen.getByRole("button", { name: "Delete" }).parentElement!.className).toContain("mr-auto");
    expect(row.closest("form")!.className).toContain("max-w-3xl");
  });
});
