import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AgentsCard } from "../components/settings/AgentsCard";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

let info: { enabled: boolean; claudePath: string | null; menuBar: boolean; limitAlerts: boolean };

beforeEach(() => {
  clearInvokedCommands();
  useAppStore.setState({ language: "EN", agentsEnabled: false });
  setInvokeHandler((cmd, args) => {
    if (cmd === "agents_get_settings") return info;
    if (cmd === "agents_set_enabled") {
      info = { ...info, enabled: args.enabled as boolean };
      return info;
    }
    if (cmd === "agents_set_menu_bar") {
      info = { ...info, menuBar: args.on as boolean };
      return info;
    }
    return null;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  setInvokeHandler(null);
});

describe("AgentsCard", () => {
  it("disables the switch and says claude is missing", async () => {
    info = { enabled: false, claudePath: null, menuBar: false, limitAlerts: true };
    render(<AgentsCard />);
    await screen.findByText(/Claude was not found/i);
    expect(screen.getByRole("switch", { name: "Show the Agents page" })).toBeDisabled();
  });

  it("demo build: the usual off state, not a missing claude", async () => {
    vi.stubEnv("VITE_DEMO_BUILD", "1");
    info = { enabled: false, claudePath: null, menuBar: false, limitAlerts: true };
    render(<AgentsCard />);
    await screen.findByText("Not available in the demo.");
    expect(screen.queryByText(/Claude was not found/i)).toBeNull();
    expect(screen.getByRole("switch", { name: "Show the Agents page" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Show the Agents page" })).not.toBeChecked();
    // Rerun 6: it showed on (pale) while every other Agents switch was off.
    expect(screen.getByRole("switch", { name: "Usage limit alerts" })).not.toBeChecked();
  });

  it("lets the user switch off when enabled but claude is gone", async () => {
    info = { enabled: true, claudePath: null, menuBar: false, limitAlerts: true };
    render(<AgentsCard />);
    await screen.findByText(/Claude was not found/i);
    const sw = screen.getByRole("switch", { name: "Show the Agents page" });
    expect(sw).not.toBeDisabled();
    fireEvent.click(sw);
    await waitFor(() => expect(invokedCommands.find((c) => c.cmd === "agents_set_enabled")?.args).toEqual({ enabled: false }));
  });

  it("shows the path and toggling enables agents", async () => {
    info = { enabled: false, claudePath: "/usr/local/bin/claude", menuBar: false, limitAlerts: true };
    render(<AgentsCard />);
    await screen.findByText("/usr/local/bin/claude");
    const sw = screen.getByRole("switch", { name: "Show the Agents page" });
    await waitFor(() => expect(sw).not.toBeDisabled());
    fireEvent.click(sw);
    await waitFor(() => expect(useAppStore.getState().agentsEnabled).toBe(true));
    expect(invokedCommands.find((c) => c.cmd === "agents_set_enabled")?.args).toEqual({ enabled: true });
    expect(screen.getByText(/once you have opened Claude in it and trusted it/i)).toBeTruthy();
  });

  it("keeps the menu bar toggle disabled while Agents is off", async () => {
    info = { enabled: false, claudePath: "/usr/local/bin/claude", menuBar: false, limitAlerts: true };
    render(<AgentsCard />);
    await screen.findByText("/usr/local/bin/claude");
    expect(screen.getByRole("switch", { name: "Show in menu bar" })).toBeDisabled();
  });

  it("toggling the menu bar calls agents_set_menu_bar", async () => {
    info = { enabled: true, claudePath: "/usr/local/bin/claude", menuBar: false, limitAlerts: true };
    render(<AgentsCard />);
    await screen.findByText("/usr/local/bin/claude");
    const sw = screen.getByRole("switch", { name: "Show in menu bar" });
    expect(sw).not.toBeDisabled();
    fireEvent.click(sw);
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "agents_set_menu_bar")?.args).toEqual({ on: true }),
    );
  });
});
