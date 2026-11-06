import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { useState } from "react";
import { SidePeek } from "../components/layout/SidePeek";

// U4 — the side peek works from the keyboard: Escape, focus in and back, a resizable divider.

function Harness({ resizable = false, late = false }: { resizable?: boolean; late?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(!late);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open peek</button>
      <button type="button" onClick={() => setLoaded(true)}>Load</button>
      {open && (
        <SidePeek resizable={resizable} onClose={() => setOpen(false)} onOpenFull={vi.fn()}>
          {loaded ? <h2>Website Revamp</h2> : <p>Loading</p>}
          <input aria-label="Notes" />
        </SidePeek>
      )}
    </div>
  );
}

/** jsdom runs no CSS animations: end the exit animation by hand. */
function endExit() {
  const panel = screen.getByRole("region", { name: "Side Peek" });
  fireEvent.animationEnd(panel);
}

beforeEach(() => { try { localStorage.removeItem("peekWidth"); } catch { /* none */ } });
afterEach(cleanup);

describe("SidePeek", () => {
  it("focuses the heading on open and gives focus back on Escape", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open peek" });
    opener.focus();
    fireEvent.click(opener);

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Website Revamp" }));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    endExit();
    expect(screen.queryByRole("region", { name: "Side Peek" })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("waits for a heading that loads after the panel opens", async () => {
    render(<Harness late />);
    fireEvent.click(screen.getByRole("button", { name: "Open peek" }));
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Side Peek" }));

    // jsdom's click doesn't move focus, so the panel still holds it when the content arrives.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Load" })); });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Website Revamp" }))
    );
  });

  it("stops waiting for the heading once focus has moved elsewhere", async () => {
    render(<Harness late />);
    fireEvent.click(screen.getByRole("button", { name: "Open peek" }));
    const load = screen.getByRole("button", { name: "Load" });
    load.focus();
    act(() => { fireEvent.click(load); });
    await screen.findByRole("heading", { name: "Website Revamp" });
    expect(document.activeElement).toBe(load);
  });

  it("leaves Escape to a field being edited", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open peek" }));
    const field = screen.getByRole("textbox", { name: "Notes" });
    field.focus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.getByRole("region", { name: "Side Peek" }).className).not.toContain("peek-exit");
  });

  it("closes from the close button too", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open peek" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    endExit();
    expect(screen.queryByRole("region", { name: "Side Peek" })).toBeNull();
  });

  it("resizes with the arrow keys on the divider and remembers the width", () => {
    render(<Harness resizable />);
    fireEvent.click(screen.getByRole("button", { name: "Open peek" }));
    const divider = screen.getByRole("separator", { name: "Resize panel" });
    const panel = screen.getByRole("region", { name: "Side Peek" });
    expect(divider).toHaveAttribute("tabindex", "0");
    expect(divider).toHaveAttribute("aria-valuenow", "50");

    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "55");
    expect(panel.style.width).toBe("55%");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "45");

    fireEvent.keyDown(divider, { key: "End" });
    expect(divider).toHaveAttribute("aria-valuenow", "70");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "70");
    fireEvent.keyDown(divider, { key: "Home" });
    expect(divider).toHaveAttribute("aria-valuenow", "20");
    expect(localStorage.getItem("peekWidth")).toBe("20");
  });

  it("has no divider unless resizable", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open peek" }));
    expect(screen.queryByRole("separator")).toBeNull();
  });
});
