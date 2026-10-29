import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SectionLabel, SECTION_LABEL } from "../components/ui/SectionLabel";

afterEach(cleanup);

describe("SectionLabel", () => {
  it("renders the spec label and keeps caller spacing", () => {
    render(<SectionLabel className="mb-2">2026</SectionLabel>);
    const el = screen.getByText("2026");
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain(SECTION_LABEL);
    expect(el.className).toContain("mb-2");
  });

  it("can be a heading", () => {
    render(<SectionLabel as="h2">Backlinks</SectionLabel>);
    expect(screen.getByRole("heading", { level: 2, name: "Backlinks" })).toBeInTheDocument();
  });

  it("shows a count after the label, with or without an action", () => {
    const { rerender } = render(<SectionLabel as="h2" count={12}>Projects</SectionLabel>);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toContainElement(screen.getByText("12"));
    expect(heading.textContent).toBe("Projects12");
    rerender(
      <SectionLabel as="h2" count={4} action={<button type="button">Add</button>}>
        Contacts
      </SectionLabel>
    );
    expect(screen.getByRole("heading", { level: 2 })).toContainElement(screen.getByText("4"));
  });

  it("puts an action on the same row", () => {
    render(
      <SectionLabel as="h3" action={<button type="button">Add</button>}>
        Outline
      </SectionLabel>
    );
    const heading = screen.getByRole("heading", { level: 3, name: "Outline" });
    const row = heading.parentElement!;
    expect(row.className).toContain("justify-between");
    expect(row).toContainElement(screen.getByRole("button", { name: "Add" }));
  });
});
