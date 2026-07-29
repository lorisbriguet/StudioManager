import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "../components/ui/FormField";
import { Input, Select } from "../components/ui";

describe("FormField", () => {
  it("associates the visible label with the child input", () => {
    render(
      <FormField label="Display Name">
        <Input value="" onChange={() => {}} />
      </FormField>
    );
    const input = screen.getByLabelText("Display Name");
    expect(input.tagName).toBe("INPUT");
  });

  it("shows a persistent aria-hidden required mark and sets aria-required", () => {
    render(
      <FormField label="Display Name" required>
        <Input value="" onChange={() => {}} />
      </FormField>
    );
    const mark = screen.getByText("*");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    // label text is "Display Name*" — exact getByLabelText would fail here
    const input = screen.getByRole("textbox", { name: "Display Name" });
    expect(input).toHaveAttribute("aria-required", "true");
  });

  it("respects a child-supplied id instead of generating one", () => {
    render(
      <FormField label="Email">
        <input id="custom-email" />
      </FormField>
    );
    const input = screen.getByLabelText("Email");
    expect(input.id).toBe("custom-email");
  });

  it("omits aria-required when not required", () => {
    render(
      <FormField label="Phone">
        <input />
      </FormField>
    );
    expect(screen.getByLabelText("Phone")).not.toHaveAttribute("aria-required");
  });

  it("renders the error with role=alert and wires aria attributes", () => {
    render(
      <FormField label="Email" error="Enter a valid email address">
        <input />
      </FormField>
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Enter a valid email address");
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("omits error wiring when there is no error", () => {
    render(
      <FormField label="Email">
        <input />
      </FormField>
    );
    expect(screen.queryByRole("alert")).toBeNull();
    const input = screen.getByLabelText("Email");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("works with the shared Select and preserves its className", () => {
    render(
      <FormField label="Language" error="err">
        <Select value="FR" onChange={() => {}}>
          <option value="FR">FR</option>
        </Select>
      </FormField>
    );
    const select = screen.getByLabelText("Language");
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select.className).toContain("aria-[invalid=true]:border-danger-text");
    expect(select.className).toContain("rounded-lg");
  });
});
