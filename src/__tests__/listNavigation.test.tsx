import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useListNavigation } from "../hooks/useListNavigation";
import { GlobalShortcuts } from "../components/GlobalShortcuts";

// 343 — arrow-key row navigation + context-sensitive Cmd+N.

type Row = { id: number; name: string };
const rows: Row[] = [
  { id: 1, name: "Alpha" },
  { id: 2, name: "Beta" },
  { id: 3, name: "Gamma" },
];

function Harness({ onOpen, onMenu }: { onOpen: (r: Row) => void; onMenu: (r: Row, pos: { x: number; y: number }) => void }) {
  const { focusIdx } = useListNavigation({ items: rows, onOpen, onMenu });
  return (
    <div>
      <input aria-label="search" />
      <table>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} data-list-row data-testid={`row-${r.id}`} className={focusIdx === i ? "focused" : ""}>
              <td>{r.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

afterEach(cleanup);

describe("useListNavigation", () => {
  it("moves focus with arrows and opens with Enter", () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} onMenu={vi.fn()} />);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getByTestId("row-1").className).toBe("focused");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getByTestId("row-2").className).toBe("focused");
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(screen.getByTestId("row-1").className).toBe("focused");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(rows[0]);
  });

  it("opens the row menu with Space", () => {
    const onMenu = vi.fn();
    render(<Harness onOpen={vi.fn()} onMenu={onMenu} />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: " " });
    expect(onMenu).toHaveBeenCalledWith(rows[0], expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  });

  it("stays inert while typing in an input", () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} onMenu={vi.fn()} />);
    const input = screen.getByLabelText("search");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId("row-1").className).toBe("");
  });
});

describe("GlobalShortcuts Cmd+N", () => {
  it("routes to the new-invoice form from the invoices page", () => {
    render(
      <MemoryRouter initialEntries={["/invoices"]}>
        <GlobalShortcuts />
        <Routes>
          <Route path="/invoices" element={<div data-testid="list" />} />
          <Route path="/invoices/new" element={<div data-testid="new-invoice" />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(screen.getByTestId("new-invoice")).toBeInTheDocument();
  });

  it("dispatches sm:new-item on inline-form pages", () => {
    const spy = vi.fn();
    window.addEventListener("sm:new-item", spy);
    render(
      <MemoryRouter initialEntries={["/expenses"]}>
        <GlobalShortcuts />
        <Routes>
          <Route path="/expenses" element={<div />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(spy).toHaveBeenCalled();
    window.removeEventListener("sm:new-item", spy);
  });

  it("Cmd+B toggles the sidebar", async () => {
    const { useAppStore } = await import("../stores/app-store");
    useAppStore.setState({ sidebarCollapsed: false });
    render(
      <MemoryRouter initialEntries={["/clients"]}>
        <GlobalShortcuts />
        <Routes>
          <Route path="/clients" element={<div />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });

  it("does nothing on unrelated pages", () => {
    const spy = vi.fn();
    window.addEventListener("sm:new-item", spy);
    render(
      <MemoryRouter initialEntries={["/clients"]}>
        <GlobalShortcuts />
        <Routes>
          <Route path="/clients" element={<div data-testid="clients" />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId("clients")).toBeInTheDocument();
    window.removeEventListener("sm:new-item", spy);
  });
});
