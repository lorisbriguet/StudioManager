import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { MenuBarApp, MENUBAR_TAB_KEY } from "../menubar/MenuBarApp";
import { useMenuBarNavigate } from "../hooks/useMenuBarNavigate";
import { emit } from "../__mocks__/tauri-event";
import { invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import { useAppStore } from "../stores/app-store";

describe("MenuBarApp", () => {
  beforeEach(() => {
    clearInvokedCommands();
    localStorage.clear();
    useAppStore.setState({ language: "EN" });
  });

  it("shows the three tabs with Agents active by default", () => {
    render(<MenuBarApp />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Agents", "Usage", "Day"]);
    expect(screen.getByRole("tab", { name: "Agents" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Agents");
  });

  it("switches the body on click and remembers the tab", () => {
    const { unmount } = render(<MenuBarApp />);
    fireEvent.click(screen.getByRole("tab", { name: "Usage" }));
    expect(screen.getByRole("tab", { name: "Usage" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Usage");
    expect(localStorage.getItem(MENUBAR_TAB_KEY)).toBe("usage");
    unmount();
    render(<MenuBarApp />);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Usage");
  });

  it("ignores an unknown remembered tab", () => {
    localStorage.setItem(MENUBAR_TAB_KEY, "nonsense");
    render(<MenuBarApp />);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Agents");
  });

  it("lets the main window follow menubar:navigate", async () => {
    function Where() {
      useMenuBarNavigate();
      const loc = useLocation();
      return <p>{loc.pathname + loc.search}</p>;
    }
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Where />
      </MemoryRouter>,
    );
    await waitFor(async () => {
      await emit("menubar:navigate", { path: "/agents?agent=sess-1" });
      expect(screen.getByText("/agents?agent=sess-1")).toBeInTheDocument();
    });
  });

  it("opens StudioManager from the bottom bar", () => {
    render(<MenuBarApp />);
    fireEvent.click(screen.getByRole("button", { name: "Open StudioManager" }));
    expect(invokedCommands).toContainEqual({
      cmd: "menubar_open_main",
      args: { agent: null, newAgent: false },
    });
  });
});
