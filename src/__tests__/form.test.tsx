import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FormLayout, FormGrid, FormSection, FormActions } from "../components/ui/Form";
import { FormField } from "../components/ui/FormField";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";

afterEach(cleanup);

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

  it("replaces the hint with the error", () => {
    render(
      <FormField label="PO number" hint="PO-0000" error="Wrong format">
        <Input value="" onChange={() => {}} />
      </FormField>
    );
    expect(screen.queryByText("PO-0000")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Wrong format");
    expect(screen.getByLabelText("PO number").getAttribute("aria-invalid")).toBe("true");
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
