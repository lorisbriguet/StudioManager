import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { useState } from "react";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";
import { notify } from "../lib/notify";

// UI review fixes A6, A10, A11, A13, B11 (settings managers, column editor,
// options editor).

vi.mock("../lib/notify", async (orig) => ({
  ...(await orig<typeof import("../lib/notify")>()),
  ...(await import("../__mocks__/notify")).notifyMockModule(),
}));

// ── ExpenseCategoryManager (A10, B11) ───────────────────────────────────
const deleteMutate = vi.fn();
const CATEGORIES = [{ code: "ZZ", name_fr: "Divers", name_en: "Misc", pl_section: "operating", color: null }];
vi.mock("../db/hooks/useExpenses", async (orig) => ({
  ...(await orig<typeof import("../db/hooks/useExpenses")>()),
  useExpenseCategories: () => ({ data: CATEGORIES }),
  useCreateExpenseCategory: () => ({ mutateAsync: vi.fn() }),
  useUpdateExpenseCategory: () => ({ mutateAsync: vi.fn() }),
  useDeleteExpenseCategory: () => ({ mutateAsync: deleteMutate }),
}));
// The usage check on mount says "not in use" (so the delete shows); the one
// in handleDelete finds expenses (another window added one meanwhile).
let usageCalls = 0;
vi.mock("../db/queries/expenses", async (orig) => ({
  ...(await orig<typeof import("../db/queries/expenses")>()),
  isCategoryInUse: vi.fn(async () => usageCalls++ > 0),
}));

// ── CustomListsManager (A11) ─────────────────────────────────────────────
const createListMutate = vi.fn();
const NO_ROWS: never[] = []; // stable: the manager re-syncs its local items on every new array
vi.mock("../db/hooks/useCustomLists", () => ({
  useCustomLists: () => ({ data: NO_ROWS }),
  useCustomListItems: () => ({ data: NO_ROWS }),
  useCreateCustomList: () => ({ mutateAsync: createListMutate }),
  useUpdateCustomList: () => ({ mutateAsync: vi.fn() }),
  useDeleteCustomList: () => ({ mutateAsync: vi.fn() }),
  useSetCustomListItems: () => ({ mutateAsync: vi.fn() }),
}));

import { ExpenseCategoryManager } from "../components/settings/ExpenseCategoryManager";
import { CustomListsManager } from "../components/settings/CustomListsManager";
import { OptionsEditor } from "../components/shared/OptionsEditor";
import { ColumnEditorPopover } from "../components/named-table/ColumnEditorPopover";

const t = uiLabels.EN;

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
  vi.mocked(notify.error).mockClear();
  vi.mocked(notify.warning).mockClear();
  usageCalls = 0;
});
afterEach(cleanup);

describe("ExpenseCategoryManager", () => {
  it("A10: a refused delete is a warning (never swallowed by the error dedupe)", async () => {
    render(<ExpenseCategoryManager />);
    await waitFor(() => expect(usageCalls).toBe(1));
    const del = screen.getByRole("button", { name: t.delete });
    await act(async () => { fireEvent.click(del); });
    await act(async () => { fireEvent.click(del); });
    expect(notify.warning).toHaveBeenCalledTimes(2);
    expect(notify.warning).toHaveBeenCalledWith(t.toast_category_in_use);
    expect(notify.error).not.toHaveBeenCalled();
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("B11: 'Add category' is the outline Button with the add icon, no raw '+'", async () => {
    render(<ExpenseCategoryManager />);
    const add = screen.getByRole("button", { name: t.add_category });
    expect(add.textContent).not.toContain("+");
    expect(add.querySelector("svg")).not.toBeNull();
  });
});

describe("CustomListsManager", () => {
  it("A11: a failed create keeps the typed name", async () => {
    createListMutate.mockRejectedValueOnce(new Error("UNIQUE constraint failed"));
    render(<CustomListsManager />);
    fireEvent.click(screen.getByRole("button", { name: t.new_list }));
    const field = screen.getByRole("textbox", { name: t.list_name }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Materials" } });
    await act(async () => { fireEvent.keyDown(field, { key: "Enter" }); });
    expect(createListMutate).toHaveBeenCalledWith("Materials");
    expect((screen.getByRole("textbox", { name: t.list_name }) as HTMLInputElement).value).toBe("Materials");
  });
});

describe("OptionsEditor", () => {
  function Harness() {
    const [options, setOptions] = useState([{ value: "a" }, { value: "b" }, { value: "c" }]);
    return <OptionsEditor colors={false} options={options} onChange={setOptions} />;
  }

  it("A13: deleting an earlier option keeps focus and value in the one being edited", () => {
    render(<Harness />);
    const third = screen.getByRole("textbox", { name: `${t.options} 3` }) as HTMLInputElement;
    third.focus();
    fireEvent.change(third, { target: { value: "c-edited" } });
    fireEvent.click(screen.getAllByRole("button", { name: t.delete })[0]);
    // The same DOM input (now option 2) still has focus and its value.
    expect(document.activeElement).toBe(third);
    expect(third.value).toBe("c-edited");
    expect((screen.getByRole("textbox", { name: `${t.options} 2` }) as HTMLInputElement).value).toBe("c-edited");
  });
});

describe("ColumnEditorPopover", () => {
  function renderEditor() {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <ColumnEditorPopover
          col={{ id: "c1", name: "Status", type: "text" } as never}
          pos={{ top: 0, left: 0 }}
          t={t as unknown as Record<string, string>}
          colName="Statsu"
          setColName={() => {}}
          colOptions={[]}
          setColOptions={() => {}}
          colLinkedListId={undefined}
          customLists={[]}
          onImportFromList={() => {}}
          onUnlinkList={() => {}}
          onSaveAsList={() => {}}
          onDelete={() => {}}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      </div>
    );
    return { onCommit, onCancel };
  }

  it("A6: Esc discards the edit", () => {
    const { onCommit, onCancel } = renderEditor();
    fireEvent.keyDown(screen.getByRole("textbox", { name: t.rename }), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("A6: an outside click commits the edit", () => {
    const { onCommit, onCancel } = renderEditor();
    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
