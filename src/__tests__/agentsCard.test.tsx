import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AgentsCard } from "../components/settings/AgentsCard";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

let info: { enabled: boolean; claudePath: string | null };

beforeEach(() => {
  clearInvokedCommands();
  useAppStore.setState({ language: "EN", agentsEnabled: false });
  setInvokeHandler((cmd, args) => {
    if (cmd === "agents_get_settings") return info;
    if (cmd === "agents_set_enabled") {
      info = { ...info, enabled: args.enabled as boolean };
      return info;
    }
    return null;
  });
});
afterEach(() => {
  cleanup();
  setInvokeHandler(null);
});

describe("AgentsCard", () => {
  it("disables the switch and says claude is missing", async () => {
    info = { enabled: false, claudePath: null };
    render(<AgentsCard />);
    await screen.findByText(/Claude was not found/i);
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("lets the user switch off when enabled but claude is gone", async () => {
    info = { enabled: true, claudePath: null };
    render(<AgentsCard />);
    await screen.findByText(/Claude was not found/i);
    const sw = screen.getByRole("switch");
    expect(sw).not.toBeDisabled();
    fireEvent.click(sw);
    await waitFor(() => expect(invokedCommands.find((c) => c.cmd === "agents_set_enabled")?.args).toEqual({ enabled: false }));
  });

  it("shows the path and toggling enables agents", async () => {
    info = { enabled: false, claudePath: "/usr/local/bin/claude" };
    render(<AgentsCard />);
    await screen.findByText("/usr/local/bin/claude");
    const sw = screen.getByRole("switch");
    await waitFor(() => expect(sw).not.toBeDisabled());
    fireEvent.click(sw);
    await waitFor(() => expect(useAppStore.getState().agentsEnabled).toBe(true));
    expect(invokedCommands.find((c) => c.cmd === "agents_set_enabled")?.args).toEqual({ enabled: true });
    expect(screen.getByText(/once you have opened Claude in it and trusted it/i)).toBeTruthy();
  });
});
