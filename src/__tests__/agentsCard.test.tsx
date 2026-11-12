import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AgentsCard } from "../components/settings/AgentsCard";
import { ConfirmHost } from "../components/ui/ConfirmDialog";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

let hotkeyError: string | null = null;
let info: { enabled: boolean; claudePath: string | null; menuBar: boolean; limitAlerts: boolean; briefing?: boolean };
let folderTrusted = false;
const BRIEFING = "/data/briefing";
let status: unknown = null;

beforeEach(() => {
  hotkeyError = null;
  folderTrusted = false;
  status = null;
  clearInvokedCommands();
  useAppStore.setState({ language: "EN", agentsEnabled: false });
  setInvokeHandler((cmd, args) => {
    if (cmd === "agents_get_settings") return info;
    if (cmd === "agents_set_enabled") {
      info = { ...info, enabled: args.enabled as boolean };
      return info;
    }
    if (cmd === "capture_hotkey_status") return hotkeyError;
    if (cmd === "briefing_status") return status;
    if (cmd === "agents_briefing_folder") return BRIEFING;
    if (cmd === "agents_start_folders") return folderTrusted ? [{ path: "/data", label: null, trusted: true, home: false }] : [];
    if (cmd === "agents_trust_folder") return args.folder;
    if (cmd === "agents_set_briefing") {
      info = { ...info, briefing: args.on as boolean };
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

  it("shows the capture shortcut while Agents is on", async () => {
    info = { enabled: true, claudePath: "/bin/claude", menuBar: false, limitAlerts: true };
    render(<AgentsCard />);
    await screen.findByText("Capture shortcut: Control-Option-Space");
    expect(screen.queryByText(/is used by another app/)).toBeNull();
  });

  it("says the shortcut is taken when registration failed", async () => {
    hotkeyError = "already registered";
    info = { enabled: true, claudePath: "/bin/claude", menuBar: false, limitAlerts: true };
    render(<AgentsCard />);
    const alert = await screen.findByText(/Control-Option-Space is used by another app or by macOS/);
    expect(alert).toHaveTextContent("already registered");
    expect(screen.queryByText("Capture shortcut: Control-Option-Space")).toBeNull();
  });

  it("says nothing about the shortcut while Agents is off", async () => {
    info = { enabled: false, claudePath: "/bin/claude", menuBar: false, limitAlerts: true };
    render(<AgentsCard />);
    await screen.findByText("/bin/claude");
    expect(screen.queryByText(/Capture shortcut/)).toBeNull();
  });

  describe("brief session switch", () => {
    const SWITCH = "Brief new captures with an agent";
    const cmds = () => invokedCommands.map((c) => c.cmd);
    const renderCard = () =>
      render(
        <>
          <AgentsCard />
          <ConfirmHost />
        </>,
      );

    it("is off by default and disabled while Agents is off", async () => {
      info = { enabled: false, claudePath: "/bin/claude", menuBar: false, limitAlerts: true, briefing: false };
      renderCard();
      await screen.findByText("/bin/claude");
      const sw = screen.getByRole("switch", { name: SWITCH });
      expect(sw).not.toBeChecked();
      expect(sw).toBeDisabled();
    });

    it("asks to trust an untrusted folder; declining changes nothing", async () => {
      info = { enabled: true, claudePath: "/bin/claude", menuBar: false, limitAlerts: true, briefing: false };
      renderCard();
      await screen.findByText("/bin/claude");
      const sw = screen.getByRole("switch", { name: SWITCH });
      await waitFor(() => expect(sw).not.toBeDisabled());
      fireEvent.click(sw);
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(cmds()).toContain("agents_start_folders"));
      expect(cmds()).not.toContain("agents_trust_folder");
      expect(cmds()).not.toContain("agents_set_briefing");
      expect(sw).not.toBeChecked();
    });

    it("trusts the folder, then switches on", async () => {
      info = { enabled: true, claudePath: "/bin/claude", menuBar: false, limitAlerts: true, briefing: false };
      renderCard();
      await screen.findByText("/bin/claude");
      const sw = screen.getByRole("switch", { name: SWITCH });
      await waitFor(() => expect(sw).not.toBeDisabled());
      fireEvent.click(sw);
      fireEvent.click(await screen.findByRole("button", { name: "Trust and start" }));
      await waitFor(() => expect(cmds()).toContain("agents_set_briefing"));
      expect(invokedCommands.find((c) => c.cmd === "agents_trust_folder")?.args).toEqual({ folder: BRIEFING });
      expect(cmds().indexOf("agents_trust_folder")).toBeLessThan(cmds().indexOf("agents_set_briefing"));
      expect(invokedCommands.find((c) => c.cmd === "agents_set_briefing")?.args).toEqual({ on: true });
    });

    it("does not ask again when the folder is already trusted", async () => {
      folderTrusted = true;
      info = { enabled: true, claudePath: "/bin/claude", menuBar: false, limitAlerts: true, briefing: false };
      renderCard();
      await screen.findByText("/bin/claude");
      const sw = screen.getByRole("switch", { name: SWITCH });
      await waitFor(() => expect(sw).not.toBeDisabled());
      fireEvent.click(sw);
      await waitFor(() => expect(cmds()).toContain("agents_set_briefing"));
      expect(cmds()).not.toContain("agents_trust_folder");
    });

    it("shows the next slot, the pause reason and the last failure", async () => {
      status = {
        paused: "too_soon",
        percent: null,
        nextAt: Date.now() + 9 * 60_000 - 1000,
        running: false,
        last: { finished_at: 1, ok: false, message: "1 capture was not filed" },
      };
      info = { enabled: true, claudePath: "/bin/claude", menuBar: false, limitAlerts: true, briefing: true };
      renderCard();
      await screen.findByText("Next brief session in 9 min");
      expect(screen.getByText("Last brief session failed: 1 capture was not filed")).toBeInTheDocument();
    });

    it("says the 5-hour limit pauses the briefs", async () => {
      status = { paused: "budget", percent: 84.4, nextAt: null, running: false, last: null };
      info = { enabled: true, claudePath: "/bin/claude", menuBar: false, limitAlerts: true, briefing: true };
      renderCard();
      await screen.findByText("Briefs paused: the 5-hour limit is at 84%");
    });

    it("asks for no status while the switch is off", async () => {
      info = { enabled: true, claudePath: "/bin/claude", menuBar: false, limitAlerts: true, briefing: false };
      renderCard();
      await screen.findByText("/bin/claude");
      expect(invokedCommands.map((c) => c.cmd)).not.toContain("briefing_status");
    });

    it("switching off needs no question", async () => {
      info = { enabled: true, claudePath: "/bin/claude", menuBar: false, limitAlerts: true, briefing: true };
      renderCard();
      await screen.findByText("/bin/claude");
      const sw = screen.getByRole("switch", { name: SWITCH });
      await waitFor(() => expect(sw).toBeChecked());
      fireEvent.click(sw);
      await waitFor(() => expect(invokedCommands.find((c) => c.cmd === "agents_set_briefing")?.args).toEqual({ on: false }));
      expect(cmds()).not.toContain("agents_briefing_folder");
    });
  });
});
