import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NamedTable } from "../components/NamedTable";
import { useAppStore } from "../stores/app-store";
import type { ProjectTable, ProjectTableRow, TableColumnDef } from "../types/project-table";

// Characterisation tests for NamedTable, written BEFORE extracting TableCell
// and ColumnEditorPopover out of it (Task 9 of the v2.1.0 quality pass).
// They pin the rendering and interaction of every cell type (text, select,
// date, number, checkbox, tags/linked-list) and of the column editor
// popover (open, rename, commit, outside-click dismissal) against the
// untouched component, so the extraction can be verified by running these
// unchanged afterwards.

// The db hooks are mocked (same pattern as Sidebar.test.tsx and
// trusteeExportFailures.test.tsx) so we control exactly what data NamedTable
// sees and can assert precisely what its mutations are called with, without
// going through the tauri-sql mock and the real query layer.
const updateRowMutate = vi.fn();
const createRowMutate = vi.fn();
const deleteRowMutate = vi.fn();
const updateTableMutate = vi.fn();
const deleteTableMutate = vi.fn();

let rowsData: ProjectTableRow[] = [];

vi.mock("../db/hooks/useProjectTables", () => ({
  useProjectTableRows: () => ({ data: rowsData }),
  useCreateProjectTableRow: () => ({ mutate: createRowMutate }),
  useUpdateProjectTableRow: () => ({ mutate: updateRowMutate }),
  useDeleteProjectTableRow: () => ({ mutate: deleteRowMutate }),
  useUpdateProjectTable: () => ({ mutate: updateTableMutate }),
  useDeleteProjectTable: () => ({ mutate: deleteTableMutate }),
}));

const customListsData = [
  { id: 1, name: "Priorities" },
  { id: 2, name: "Statuses" },
];
const createCustomListMutateAsync = vi.fn();
const setCustomListItemsMutateAsync = vi.fn();

vi.mock("../db/hooks/useCustomLists", () => ({
  useCustomLists: () => ({ data: customListsData }),
  useCustomListItems: () => ({ data: undefined }),
  useCreateCustomList: () => ({ mutateAsync: createCustomListMutateAsync }),
  useSetCustomListItems: () => ({ mutateAsync: setCustomListItemsMutateAsync }),
}));

const COLUMNS: TableColumnDef[] = [
  { id: "col_text", name: "Name", type: "text" },
  { id: "col_number", name: "Qty", type: "number" },
  { id: "col_checkbox", name: "Done", type: "checkbox" },
  { id: "col_select", name: "Status", type: "select", options: ["Todo", "Doing", "Done"] },
  { id: "col_tags", name: "Tags", type: "tags", options: ["Urgent", "Later", "Blocked"] },
  { id: "col_date", name: "Due", type: "date" },
];

function makeTable(overrides: Partial<ProjectTable> = {}): ProjectTable {
  return {
    id: 1,
    project_id: 42,
    name: "My Table",
    column_config: COLUMNS,
    sort_order: 0,
    created_at: "2026-01-01",
    ...overrides,
  };
}

function makeRow(data: Record<string, unknown>, id = 1): ProjectTableRow {
  return { id, table_id: 1, data, sort_order: 0 };
}

function renderTable(table: ProjectTable, rows: ProjectTableRow[]) {
  rowsData = rows;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NamedTable table={table} projectId={42} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  useAppStore.setState({ language: "EN", darkMode: false });
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("NamedTable text cell", () => {
  it("renders the value as static text until double-clicked", () => {
    renderTable(makeTable(), [makeRow({ col_text: "Alpha" })]);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Alpha")).not.toBeInTheDocument();
  });

  it("renders the em-dash placeholder for a null value", () => {
    renderTable(makeTable({ column_config: [COLUMNS[0]] }), [makeRow({ col_text: null })]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("double-click enters edit mode with an input pre-filled with the value", () => {
    renderTable(makeTable(), [makeRow({ col_text: "Alpha" })]);
    fireEvent.doubleClick(screen.getByText("Alpha"));
    const input = screen.getByDisplayValue("Alpha");
    expect(input.tagName).toBe("INPUT");
    expect((input as HTMLInputElement).type).toBe("text");
  });

  it("Enter commits the new value via updateRow.mutate and exits edit mode", () => {
    renderTable(makeTable({ column_config: [COLUMNS[0], COLUMNS[1]] }), [
      makeRow({ col_text: "Alpha", col_number: 3 }),
    ]);
    fireEvent.doubleClick(screen.getByText("Alpha"));
    const input = screen.getByDisplayValue("Alpha");
    fireEvent.change(input, { target: { value: "Beta" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateRowMutate).toHaveBeenCalledWith({
      id: 1,
      data: { col_text: "Beta", col_number: 3 },
    });
    // NamedTable has no local optimistic echo: it relies on the row query
    // refetching after the mutation, so with a static mocked hook the
    // displayed value reverts to the (unchanged) prop data once edit mode
    // exits — only the mutate call reflects the typed value.
    expect(screen.queryByDisplayValue("Beta")).not.toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("blur also commits the value", () => {
    renderTable(makeTable(), [makeRow({ col_text: "Alpha" })]);
    fireEvent.doubleClick(screen.getByText("Alpha"));
    const input = screen.getByDisplayValue("Alpha");
    fireEvent.change(input, { target: { value: "Gamma" } });
    fireEvent.blur(input);
    expect(updateRowMutate).toHaveBeenCalledWith({ id: 1, data: { col_text: "Gamma" } });
  });

  it("Escape cancels editing without committing", () => {
    renderTable(makeTable(), [makeRow({ col_text: "Alpha" })]);
    fireEvent.doubleClick(screen.getByText("Alpha"));
    const input = screen.getByDisplayValue("Alpha");
    fireEvent.change(input, { target: { value: "Zeta" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(updateRowMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});

describe("NamedTable number cell", () => {
  it("edits through the same text-like input, typed as number, and parses to a Number on commit", () => {
    renderTable(makeTable(), [makeRow({ col_number: 5 })]);
    fireEvent.doubleClick(screen.getByText("5"));
    const input = screen.getByDisplayValue("5");
    expect((input as HTMLInputElement).type).toBe("number");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateRowMutate).toHaveBeenCalledWith({ id: 1, data: { col_number: 12 } });
  });

  it("an empty value commits as null, not NaN or an empty string", () => {
    renderTable(makeTable(), [makeRow({ col_number: 5 })]);
    fireEvent.doubleClick(screen.getByText("5"));
    const input = screen.getByDisplayValue("5");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateRowMutate).toHaveBeenCalledWith({ id: 1, data: { col_number: null } });
  });
});

describe("NamedTable checkbox cell", () => {
  it("renders unchecked/checked from the row value and toggles on click", () => {
    renderTable(makeTable(), [makeRow({ col_checkbox: false })]);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(updateRowMutate).toHaveBeenCalledWith({ id: 1, data: { col_checkbox: true } });
  });

  it("toggles from true back to false", () => {
    renderTable(makeTable(), [makeRow({ col_checkbox: true })]);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(updateRowMutate).toHaveBeenCalledWith({ id: 1, data: { col_checkbox: false } });
  });
});

describe("NamedTable select cell", () => {
  it("renders an empty placeholder option plus each column option, selected from the row value", () => {
    renderTable(makeTable(), [makeRow({ col_select: "Doing" })]);
    const select = screen.getByDisplayValue("Doing") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["—", "Todo", "Doing", "Done"]);
  });

  it("changing the selection calls updateRow.mutate with the new value", () => {
    renderTable(makeTable(), [makeRow({ col_select: "Todo" })]);
    const select = screen.getByDisplayValue("Todo") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Done" } });

    expect(updateRowMutate).toHaveBeenCalledWith({ id: 1, data: { col_select: "Done" } });
  });
});

describe("NamedTable date cell", () => {
  it("renders a native date input bound to the row value", () => {
    renderTable(makeTable(), [makeRow({ col_date: "2026-03-15" })]);
    const input = screen.getByDisplayValue("2026-03-15") as HTMLInputElement;
    expect(input.type).toBe("date");
  });

  it("changing it commits immediately via updateRow.mutate (no edit/commit step)", () => {
    renderTable(makeTable(), [makeRow({ col_date: "2026-03-15" })]);
    const input = screen.getByDisplayValue("2026-03-15");
    fireEvent.change(input, { target: { value: "2026-04-01" } });

    expect(updateRowMutate).toHaveBeenCalledWith({ id: 1, data: { col_date: "2026-04-01" } });
  });
});

describe("NamedTable tags (linked-list) cell", () => {
  it("renders selected tags with a remove control, and unselected options as add buttons", () => {
    renderTable(makeTable(), [makeRow({ col_tags: ["Urgent"] })]);
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove tag Urgent")).toBeInTheDocument();
    expect(screen.getByText("+ Later")).toBeInTheDocument();
    expect(screen.getByText("+ Blocked")).toBeInTheDocument();
    // The already-selected tag is not offered again as an add button.
    expect(screen.queryByText("+ Urgent")).not.toBeInTheDocument();
  });

  it("clicking an available option adds it to the row's tag array", () => {
    renderTable(makeTable(), [makeRow({ col_tags: ["Urgent"] })]);
    fireEvent.click(screen.getByText("+ Later"));

    expect(updateRowMutate).toHaveBeenCalledWith({
      id: 1,
      data: { col_tags: ["Urgent", "Later"] },
    });
  });

  it("clicking a selected tag's remove control removes it from the array", () => {
    renderTable(makeTable(), [makeRow({ col_tags: ["Urgent", "Later"] })]);
    fireEvent.click(screen.getByLabelText("Remove tag Urgent"));

    expect(updateRowMutate).toHaveBeenCalledWith({
      id: 1,
      data: { col_tags: ["Later"] },
    });
  });

  it("renders no options with an empty tag array", () => {
    renderTable(makeTable(), [makeRow({ col_tags: [] })]);
    expect(screen.getByText("+ Urgent")).toBeInTheDocument();
    expect(screen.getByText("+ Later")).toBeInTheDocument();
    expect(screen.getByText("+ Blocked")).toBeInTheDocument();
  });
});

describe("NamedTable column editor popover", () => {
  function openEditorFor(colName: string) {
    fireEvent.click(screen.getByText(colName));
  }

  it("opening it shows a rename input pre-filled with the column name", () => {
    renderTable(makeTable(), [makeRow({ col_text: "Alpha" })]);
    openEditorFor("Name");

    const input = screen.getByDisplayValue("Name");
    expect(input.tagName).toBe("INPUT");
  });

  it("does not show an options section for a plain text column", () => {
    renderTable(makeTable(), [makeRow({ col_text: "Alpha" })]);
    openEditorFor("Name");
    expect(screen.queryByText("Options")).not.toBeInTheDocument();
  });

  it("shows an editable options section for a select column, seeded from the column's options", () => {
    // Row value left blank (not one of the options) so the cell's <select>
    // doesn't collide with the popover's option inputs on displayed value.
    renderTable(makeTable(), [makeRow({ col_select: "" })]);
    openEditorFor("Status");

    expect(screen.getByText("Options")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Todo")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Doing")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Done")).toBeInTheDocument();
  });

  it("renaming a column and committing (Enter) calls updateTable.mutate with the new name in column_config", () => {
    renderTable(makeTable(), [makeRow({ col_text: "Alpha" })]);
    openEditorFor("Name");

    const input = screen.getByDisplayValue("Name");
    fireEvent.change(input, { target: { value: "Full Name" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateTableMutate).toHaveBeenCalledTimes(1);
    const call = updateTableMutate.mock.calls[0][0];
    expect(call.id).toBe(1);
    expect(call.data.column_config).toEqual([
      { ...COLUMNS[0], name: "Full Name" },
      ...COLUMNS.slice(1),
    ]);
  });

  it("committing via the Save button also works and closes the popover", () => {
    renderTable(makeTable(), [makeRow({ col_text: "Alpha" })]);
    openEditorFor("Name");
    const input = screen.getByDisplayValue("Name");
    fireEvent.change(input, { target: { value: "Full Name" } });

    fireEvent.click(screen.getByText("Save"));

    expect(updateTableMutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue("Full Name")).not.toBeInTheDocument();
  });

  it("clicking outside the popover commits the pending edit and dismisses it", () => {
    renderTable(makeTable(), [makeRow({ col_text: "Alpha" })]);
    openEditorFor("Name");
    const input = screen.getByDisplayValue("Name");
    fireEvent.change(input, { target: { value: "Renamed Outside" } });

    // mousedown outside the popover — the listener the component installs
    // is a document-level "mousedown" handler.
    fireEvent.mouseDown(document.body);

    expect(updateTableMutate).toHaveBeenCalledTimes(1);
    const call = updateTableMutate.mock.calls[0][0];
    expect(call.data.column_config[0].name).toBe("Renamed Outside");
    expect(screen.queryByDisplayValue("Renamed Outside")).not.toBeInTheDocument();
  });

  it("the delete-column control removes the column from column_config and closes the popover", () => {
    renderTable(makeTable(), [makeRow({ col_text: "Alpha" })]);
    openEditorFor("Name");

    fireEvent.click(screen.getByText("Delete column"));

    expect(updateTableMutate).toHaveBeenCalledWith({
      id: 1,
      data: { column_config: COLUMNS.slice(1) },
    });
    expect(screen.queryByDisplayValue("Name")).not.toBeInTheDocument();
  });

  it("blank options are dropped and empty name falls back to the previous name on commit", () => {
    renderTable(makeTable(), [makeRow({ col_select: "" })]);
    openEditorFor("Status");

    const nameInput = screen.getByDisplayValue("Status");
    fireEvent.change(nameInput, { target: { value: "   " } });
    const optionInputs = [
      screen.getByDisplayValue("Todo"),
      screen.getByDisplayValue("Doing"),
      screen.getByDisplayValue("Done"),
    ];
    fireEvent.change(optionInputs[1], { target: { value: "  " } });
    fireEvent.click(screen.getByText("Save"));

    const call = updateTableMutate.mock.calls[0][0];
    const updatedCol = call.data.column_config.find((c: TableColumnDef) => c.id === "col_select");
    expect(updatedCol.name).toBe("Status");
    expect(updatedCol.options).toEqual(["Todo", "Done"]);
  });
});
