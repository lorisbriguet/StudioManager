import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { Dropdown, DropdownSelect, type DropdownOption } from "../components/ui/Dropdown";
import { Select } from "../components/ui/Select";
import { useAppStore } from "../stores/app-store";

afterEach(cleanup);
useAppStore.setState({ language: "EN" });

const STATUSES: DropdownOption[] = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled", disabled: true },
];

function SingleHarness({ onChange = vi.fn(), options = STATUSES, ...rest }: { onChange?: (v: string) => void; options?: DropdownOption[]; onCreate?: (q: string) => void; searchable?: boolean }) {
  const [v, setV] = useState("sent");
  return (
    <StrictMode>
      <DropdownSelect
        aria-label="Status"
        value={v}
        options={options}
        onChange={(next) => {
          setV(next);
          onChange(next);
        }}
        {...rest}
      />
    </StrictMode>
  );
}

describe("DropdownSelect", () => {
  it("shows the selected label and picks a new value by click", () => {
    const onChange = vi.fn();
    render(<SingleHarness onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Status" });
    expect(trigger).toHaveTextContent("Sent");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox");
    expect(within(list).getByRole("option", { name: "Sent" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(within(list).getByRole("option", { name: "Paid" }));
    expect(onChange).toHaveBeenCalledWith("paid");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveTextContent("Paid");
    expect(document.activeElement).toBe(trigger);
  });

  it("ignores disabled options and does not fire onChange for the current value", () => {
    const onChange = vi.fn();
    render(<SingleHarness onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Cancelled" }));
    fireEvent.click(screen.getByRole("option", { name: "Sent" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("works from the keyboard: arrows skip disabled rows, Enter picks, Escape closes", () => {
    const onChange = vi.fn();
    render(<SingleHarness onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    // starts on the selected row (Sent), down once → Paid, down again wraps past Cancelled → Draft
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(list.getAttribute("aria-activedescendant")).toBe(
      within(list).getByRole("option", { name: "Paid" }).id
    );
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("draft");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape does not reach document listeners (a surrounding Modal stays open)", () => {
    const docEscape = vi.fn();
    const handler = (e: KeyboardEvent) => e.key === "Escape" && docEscape();
    document.addEventListener("keydown", handler);
    render(<SingleHarness />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(docEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", handler);
  });

  it("closes on an outside click", () => {
    render(<SingleHarness />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("filters with search and offers to create a missing entry", () => {
    const onCreate = vi.fn();
    render(<SingleHarness searchable onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("combobox"));
    const search = screen.getByRole("textbox", { name: "Search" });
    expect(document.activeElement).toBe(search);

    fireEvent.change(search, { target: { value: "pa" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Paid", "Create “pa”"]);

    fireEvent.change(search, { target: { value: "Atelier" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledWith("Atelier");
  });

  it("turns search on by itself above 10 options", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ value: String(i), label: `Client ${i}` }));
    render(<SingleHarness options={many} />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();
  });

  it("multi-select stays open and toggles values", () => {
    function Multi() {
      const [v, setV] = useState<string[]>(["web"]);
      return (
        <DropdownSelect
          multiple
          aria-label="Tags"
          value={v}
          onChange={setV}
          options={[
            { value: "web", label: "web" },
            { value: "print", label: "print" },
          ]}
        />
      );
    }
    render(<Multi />);
    const trigger = screen.getByRole("combobox", { name: "Tags" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "print" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "web" }));
    expect(trigger).toHaveTextContent("print");
    expect(screen.getByRole("option", { name: "web" })).toHaveAttribute("aria-selected", "false");
  });

  it("a pick does not click the table row around it", () => {
    const rowClick = vi.fn();
    render(
      <table>
        <tbody>
          <tr onClick={rowClick}>
            <td>
              <SingleHarness />
            </td>
          </tr>
        </tbody>
      </table>
    );
    fireEvent.click(screen.getByRole("combobox"));
    rowClick.mockClear();
    fireEvent.click(screen.getByRole("option", { name: "Paid" }));
    expect(rowClick).not.toHaveBeenCalled();
  });
});

describe("Select (native-style API)", () => {
  it("reads <option>/<optgroup> children and calls onChange with e.target.value", () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Currency" value="CHF" name="currency" onChange={(e) => onChange(e.target.value, e.target.name)}>
        <option value="CHF">CHF</option>
        <optgroup label="Other">
          <>
            <option value="EUR">EUR</option>
          </>
          {["USD"].map((c) => (
            <option key={c} value={c}>
              {c} — dollar
            </option>
          ))}
        </optgroup>
      </Select>
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Currency" }));
    expect(screen.getByText("Other")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "USD — dollar" }));
    expect(onChange).toHaveBeenCalledWith("USD", "currency");
  });

  it("shows the first option when the value matches none, like a native select", () => {
    render(
      <Select aria-label="Client" value="" onChange={() => {}}>
        <option value="a">Atelier Noir</option>
        <option value="b">Fondation Artvis</option>
      </Select>
    );
    expect(screen.getByRole("combobox", { name: "Client" })).toHaveTextContent("Atelier Noir");
  });
});

describe("Dropdown (action menu)", () => {
  it("runs the picked command and returns focus to the trigger", () => {
    const edit = vi.fn();
    const remove = vi.fn();
    render(
      <Dropdown
        trigger={<button type="button">Actions</button>}
        items={[
          { label: "Edit", onSelect: edit },
          { divider: true },
          { label: "Delete", onSelect: remove, danger: true },
        ]}
      />
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("separator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
