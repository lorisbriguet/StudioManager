import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useRef, useState } from "react";
import { useListNavigation } from "../hooks/useListNavigation";
import { Table } from "../components/ui/Table";
import { SortHeader } from "../components/ui/SortHeader";
import { SettingRow } from "../components/ui/Settings";
import { Select } from "../components/ui/Select";
import { Toggle } from "../components/ui/Toggle";
import { Button } from "../components/ui/Button";
import { Calendar, parseLocalDate } from "../components/ui/DatePicker";
import { Modal } from "../components/ui/Modal";
import { Popover } from "../components/ui/Popover";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { ProgressBar } from "../components/ui/Feedback";
import { useAppStore } from "../stores/app-store";

// Accessibility review: the behaviours behind each fix.

afterEach(cleanup);
beforeEach(() => useAppStore.setState({ language: "EN" }));

type Row = { id: number; name: string };
const rows: Row[] = [
  { id: 1, name: "Alpha" },
  { id: 2, name: "Beta" },
];

function ListHarness({ onOpen, onMenu, onButton }: { onOpen: (r: Row) => void; onMenu: () => void; onButton: () => void }) {
  const { focusIdx } = useListNavigation({ items: rows, onOpen, onMenu });
  return (
    <table>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} data-list-row data-testid={`row-${r.id}`} className={focusIdx === i ? "focused" : ""}>
            <td>
              {r.name}
              <button type="button" onClick={onButton}>
                Edit {r.name}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

describe("useListNavigation", () => {
  it("leaves Enter and Space to a focused button", () => {
    const onOpen = vi.fn();
    const onMenu = vi.fn();
    render(<ListHarness onOpen={onOpen} onMenu={onMenu} onButton={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    const btn = screen.getByRole("button", { name: "Edit Alpha" });
    btn.focus();
    const enter = fireEvent.keyDown(btn, { key: "Enter" });
    const space = fireEvent.keyDown(btn, { key: " " });
    expect(onOpen).not.toHaveBeenCalled();
    expect(onMenu).not.toHaveBeenCalled();
    // not prevented: the browser still presses the button
    expect(enter).toBe(true);
    expect(space).toBe(true);
  });

  it("ignores a key another handler already took", () => {
    const onOpen = vi.fn();
    render(<ListHarness onOpen={onOpen} onMenu={vi.fn()} onButton={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    e.preventDefault();
    window.dispatchEvent(e);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("moves DOM focus to the highlighted row so a screen reader reads it", () => {
    const onOpen = vi.fn();
    render(<ListHarness onOpen={onOpen} onMenu={vi.fn()} onButton={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    const row = screen.getByTestId("row-2");
    expect(row.className).toBe("focused");
    expect(document.activeElement).toBe(row);
    expect(row).toHaveAttribute("tabindex", "-1");
    // Enter from the focused row still opens it
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(rows[1]);
  });
});

describe("Table", () => {
  it("names the selection checkboxes and scopes header cells to their column", () => {
    render(
      <Table>
        <Table.Head>
          <Table.SelectAll all={false} some={false} onToggle={() => {}} label="Select all" />
          <SortHeader label="Name" sortKey="name" current={{ key: "name", dir: "asc" }} onSort={() => {}} />
          <Table.Th>Amount</Table.Th>
          <Table.ActionsTh />
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Select checked={false} onToggle={() => {}} label="Select INV-001" />
            <Table.Td>INV-001</Table.Td>
          </Table.Row>
        </Table.Body>
      </Table>
    );
    expect(screen.getByRole("checkbox", { name: "Select all" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select INV-001" })).toBeInTheDocument();
    for (const th of screen.getAllByRole("columnheader")) expect(th).toHaveAttribute("scope", "col");
  });

  it("requires a label on Select and SelectAll (type-level)", () => {
    // @ts-expect-error label is required
    const a = <Table.Select checked={false} onToggle={() => {}} />;
    // @ts-expect-error label is required
    const b = <Table.SelectAll all={false} some={false} onToggle={() => {}} />;
    expect(a && b).toBeTruthy();
  });
});

describe("SettingRow", () => {
  it("links its label to a single Select or Toggle child", () => {
    render(
      <>
        <SettingRow label="Language">
          <Select value="EN" onChange={() => {}}>
            <option value="EN">English</option>
            <option value="FR">French</option>
          </Select>
        </SettingRow>
        <SettingRow label="Show income">
          <Toggle checked={false} onChange={() => {}} />
        </SettingRow>
      </>
    );
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
    const sw = screen.getByRole("switch", { name: "Show income" });
    fireEvent.click(screen.getByText("Show income"));
    expect(sw).toBeInTheDocument();
  });

  it("keeps the control's own id, and leaves a wrapper unlinked", () => {
    const { container } = render(
      <>
        <SettingRow label="Persona">
          <Select id="persona" value="a" onChange={() => {}}>
            <option value="a">A</option>
          </Select>
        </SettingRow>
        <SettingRow label="Backup folder">
          <div>
            <Button>Browse</Button>
          </div>
        </SettingRow>
      </>
    );
    expect(screen.getByRole("combobox", { name: "Persona" })).toHaveAttribute("id", "persona");
    expect(container.querySelectorAll("label")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Browse" })).toBeInTheDocument();
  });
});

describe("Button loading", () => {
  it("keeps focus, is aria-disabled and ignores clicks", () => {
    const onClick = vi.fn();
    function Harness() {
      const [loading, setLoading] = useState(false);
      return (
        <Button
          loading={loading}
          onClick={() => {
            onClick();
            setLoading(true);
          }}
        >
          Save
        </Button>
      );
    }
    render(<Harness />);
    const btn = screen.getByRole("button", { name: "Save" });
    btn.focus();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a loading submit button does not submit its form", () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Save
        </Button>
      </form>
    );
    // the spinner's "Loading" is part of the name while busy
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disabled still disables", () => {
    render(
      <Button disabled loading>
        Save
      </Button>
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });
});

describe("Calendar keyboard", () => {
  const day = (iso: string) => document.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`)!;

  it("has one tab stop, on the selected day", () => {
    render(<Calendar selected={parseLocalDate("2026-10-14")} onSelect={() => {}} />);
    const stops = Array.from(document.querySelectorAll("[data-day]")).filter((el) => el.getAttribute("tabindex") === "0");
    expect(stops).toEqual([day("2026-10-14")]);
  });

  it("moves with arrows, Home/End (week) and PageUp/PageDown (month)", () => {
    render(<Calendar selected={parseLocalDate("2026-10-14")} onSelect={() => {}} />);
    day("2026-10-14").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(day("2026-10-15"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(day("2026-10-22"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" }); // Monday
    expect(document.activeElement).toBe(day("2026-10-19"));
    fireEvent.keyDown(document.activeElement!, { key: "End" }); // Sunday
    expect(document.activeElement).toBe(day("2026-10-25"));
    fireEvent.keyDown(document.activeElement!, { key: "PageDown" });
    expect(document.activeElement).toBe(day("2026-11-25"));
    expect(day("2026-11-25")).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "PageUp" });
    expect(document.activeElement).toBe(day("2026-10-18"));
  });

  it("crosses into the next month with the arrows", () => {
    render(<Calendar selected={parseLocalDate("2026-10-31")} onSelect={() => {}} />);
    day("2026-10-31").focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(day("2026-11-01"));
  });
});

describe("Modal focus trap", () => {
  it("skips tabindex=-1 elements and hidden ones", () => {
    render(
      <Modal open onClose={() => {}} title="Edit">
        <button type="button">First</button>
        <button type="button" tabIndex={-1}>
          Roving
        </button>
        <button type="button">Last</button>
        <div style={{ display: "none" }}>
          <button type="button">Hidden</button>
        </div>
      </Modal>
    );
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    // wraps to the first tab stop: the header's close button
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /close/i }));
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

describe("Popover", () => {
  function Harness({ padding, label }: { padding: "content" | "menu"; label?: string }) {
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={ref}>Anchor</button>
        <Popover anchor={ref} onClose={() => {}} padding={padding} aria-label={label}>
          <button type="button">Inside</button>
        </Popover>
      </>
    );
  }

  it("is a named dialog by default when it holds content", () => {
    render(<Harness padding="content" label="Pick a date" />);
    expect(screen.getByRole("dialog", { name: "Pick a date" })).toBeInTheDocument();
  });

  it("has no role of its own as a menu panel", () => {
    render(<Harness padding="menu" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("SegmentedControl", () => {
  it("puts the tab stop on the first enabled segment when the value matches none", () => {
    render(
      <SegmentedControl
        aria-label="View"
        value={"none" as "a" | "b" | "none"}
        onChange={() => {}}
        options={[
          { value: "a", label: "A", disabled: true },
          { value: "b", label: "B" },
        ]}
      />
    );
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("tabindex", "-1");
  });
});

describe("ProgressBar", () => {
  it("is labelled by its visible text label", () => {
    render(<ProgressBar value={40} label="Progress" showValue />);
    expect(screen.getByRole("progressbar", { name: "Progress" })).toHaveAttribute("aria-labelledby");
  });

  it("takes an aria-label when there is no text label", () => {
    render(<ProgressBar value={40} aria-label="Progress: Website" />);
    expect(screen.getByRole("progressbar", { name: "Progress: Website" })).toBeInTheDocument();
  });
});
