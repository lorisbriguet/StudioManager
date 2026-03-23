import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SortHeader } from "../components/SortHeader";

function renderInTable(ui: React.ReactElement) {
  return render(<table><thead><tr>{ui}</tr></thead></table>);
}

describe("SortHeader", () => {
  it("renders the label", () => {
    const onSort = vi.fn();
    renderInTable(
      <SortHeader label="Name" sortKey="name" current={{ key: "name", dir: "asc" }} onSort={onSort} />
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("shows ascending icon when active asc", () => {
    renderInTable(
      <SortHeader label="Name" sortKey="name" current={{ key: "name", dir: "asc" }} onSort={vi.fn()} />
    );
    // ArrowUp icon should be rendered (lucide renders svg)
    const th = screen.getByText("Name").closest("th")!;
    expect(th.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("toggles from asc to desc on click", () => {
    const onSort = vi.fn();
    renderInTable(
      <SortHeader label="Name" sortKey="name" current={{ key: "name", dir: "asc" }} onSort={onSort} />
    );
    fireEvent.click(screen.getByText("Name").closest("th")!);
    expect(onSort).toHaveBeenCalledWith({ key: "name", dir: "desc" });
  });

  it("sets to asc when clicking inactive column", () => {
    const onSort = vi.fn();
    renderInTable(
      <SortHeader label="Total" sortKey="total" current={{ key: "name", dir: "asc" }} onSort={onSort} />
    );
    fireEvent.click(screen.getByText("Total").closest("th")!);
    expect(onSort).toHaveBeenCalledWith({ key: "total", dir: "asc" });
  });
});
