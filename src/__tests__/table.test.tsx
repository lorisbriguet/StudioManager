import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Table } from "../components/ui/Table";
import { SortHeader } from "../components/ui/SortHeader";
import { IconButton } from "../components/ui/IconButton";
import { Trash2 } from "lucide-react";

afterEach(cleanup);

function Harness({ density, onOpen = vi.fn(), onToggle = vi.fn(), onDelete = vi.fn() }: {
  density?: "default" | "compact";
  onOpen?: () => void;
  onToggle?: (shift: boolean) => void;
  onDelete?: () => void;
}) {
  return (
    <Table density={density}>
      <Table.Head>
        <Table.SelectAll all={false} some={true} onToggle={() => {}} label="Select all" />
        <SortHeader label="Reference" sortKey="ref" current={{ key: "ref", dir: "asc" }} onSort={() => {}} />
        <Table.Th numeric>Amount</Table.Th>
        <Table.ActionsTh />
      </Table.Head>
      <Table.Body>
        <Table.Row onOpen={onOpen}>
          <Table.Select checked={false} onToggle={onToggle} label="Select INV-1" />
          <Table.Td>INV-1</Table.Td>
          <Table.Td numeric>4 800.00</Table.Td>
          <Table.Actions>
            <IconButton size="xs" icon={Trash2} label="Delete" onClick={onDelete} />
          </Table.Actions>
        </Table.Row>
      </Table.Body>
      <Table.Foot>
        <Table.Td colSpan={2}>Total</Table.Td>
        <Table.Td numeric>4 800.00</Table.Td>
        <Table.Td />
      </Table.Foot>
    </Table>
  );
}

describe("Table", () => {
  it("opens a row on a single click", () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    fireEvent.click(screen.getByText("INV-1"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText("INV-1").closest("tr")!.className).toContain("cursor-pointer");
  });

  it("does not open the row from its checkbox or action buttons", () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const onDelete = vi.fn();
    render(<Harness onOpen={onOpen} onToggle={onToggle} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText("Select INV-1"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onDelete).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does not open the row from the padding around its checkbox or actions", () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText("Select INV-1").closest("td")!);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }).closest("td")!);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows the select-all checkbox as indeterminate when some rows are selected", () => {
    render(<Harness />);
    expect((screen.getByLabelText("Select all") as HTMLInputElement).indeterminate).toBe(true);
  });

  it("uses 40px rows by default and 32px rows when compact, in cells and sort headers", () => {
    render(<Harness />);
    expect(screen.getByText("INV-1").className).toContain("h-10");
    expect(screen.getByText("INV-1").className).toContain("px-4");
    cleanup();
    render(<Harness density="compact" />);
    expect(screen.getByText("INV-1").className).toContain("h-8");
    expect(screen.getByText("INV-1").className).toContain("px-3");
    expect(screen.getByRole("columnheader", { name: /Reference/ }).className).toContain("px-3");
  });

  it("right-aligns numbers with tabular digits", () => {
    render(<Harness />);
    const cell = screen.getAllByText("4 800.00")[0];
    expect(cell.className).toContain("text-right");
    expect(cell.className).toContain("tabular-nums");
    expect(screen.getByRole("columnheader", { name: "Amount" }).className).toContain("text-right");
  });

  it("hides row actions until the row is hovered or focused", () => {
    render(<Harness />);
    const wrap = screen.getByRole("button", { name: "Delete" }).parentElement!;
    expect(wrap.className).toContain("opacity-0");
    expect(wrap.className).toContain("group-hover/row:opacity-100");
    expect(wrap.className).toContain("group-focus-within/row:opacity-100");
  });

  it("toggles a group row from its button", () => {
    const onToggle = vi.fn();
    render(
      <Table>
        <Table.Body>
          <Table.Group colSpan={3} label="2026" count="3 invoices" total="CHF 18 130.50" open={false} onToggle={onToggle} />
        </Table.Body>
      </Table>
    );
    const btn = screen.getByRole("button", { name: /2026/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalled();
  });
});
