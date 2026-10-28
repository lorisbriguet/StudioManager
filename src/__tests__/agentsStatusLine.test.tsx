import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AgentsCard } from "../components/settings/AgentsCard";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

const ask = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => false);
// Same aliased mock file as invoke: spread the original so only `ask` changes.
vi.mock("@tauri-apps/plugin-dialog", async (importOriginal) => ({ ...(await importOriginal<object>()), ask: (...a: unknown[]) => ask(...a) }));

const NEXT = '{\n  "model": "opus",\n  "statusLine": {\n    "type": "command",\n    "command": "\'/x/studiomanager-mcp\' --statusline"\n  }\n}\n';
const REMOVE_NEXT = '{\n  "model": "opus"\n}\n';

let info: { enabled: boolean; claudePath: string | null; menuBar: boolean; limitAlerts: boolean };
let preview: { current: string | null; next: string; replacesOther: boolean; installed: boolean; removeNext: string | null };

beforeEach(() => {
  clearInvokedCommands();
  ask.mockReset().mockResolvedValue(false);
  useAppStore.setState({ language: "EN", agentsEnabled: true });
  info = { enabled: true, claudePath: "/usr/local/bin/claude", menuBar: true, limitAlerts: true };
  preview = { current: null, next: NEXT, replacesOther: false, installed: false, removeNext: null };
  setInvokeHandler((cmd, args) => {
    if (cmd === "agents_get_settings") return info;
    if (cmd === "agents_set_menu_bar") {
      info = { ...info, menuBar: args.on as boolean };
      return info;
    }
    if (cmd === "agents_status_line_preview") return preview;
    if (cmd === "agents_status_line_install") {
      preview = { ...preview, installed: true, replacesOther: false, removeNext: REMOVE_NEXT };
      return "";
    }
    if (cmd === "agents_status_line_remove") {
      preview = { ...preview, installed: false, removeNext: null };
      return "";
    }
    return null;
  });
});
afterEach(() => {
  cleanup();
  setInvokeHandler(null);
});

describe("AgentsCard plan-limits status line", () => {
  it("shows the change, then confirm sends the exact preview text", async () => {
    render(<AgentsCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up plan limits" }));
    await screen.findByText(/will be written to Claude Code's settings/i);
    expect(screen.getByTestId("status-line-preview").textContent).toBe(NEXT);
    expect(screen.queryByText(/replaces your current status line/i)).toBeNull();
    expect(invokedCommands.some((c) => c.cmd === "agents_status_line_install")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "agents_status_line_install")?.args).toEqual({ expected: NEXT }),
    );
    await screen.findByRole("button", { name: "Remove" });
  });

  it("warns before replacing another status line", async () => {
    preview = { ...preview, current: "~/bin/mine.sh", replacesOther: true };
    render(<AgentsCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up plan limits" }));
    const warning = await screen.findByText(/replaces your current status line/i);
    expect(warning.textContent).toContain("~/bin/mine.sh");
  });

  it("remove previews the restored settings and sends them", async () => {
    preview = { ...preview, installed: true, removeNext: REMOVE_NEXT };
    render(<AgentsCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByTestId("status-line-preview").textContent).toBe(REMOVE_NEXT));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "agents_status_line_remove")?.args).toEqual({ expected: REMOVE_NEXT }),
    );
  });

  it("turning the menu bar off offers to remove the status line", async () => {
    preview = { ...preview, installed: true, removeNext: REMOVE_NEXT };
    ask.mockResolvedValue(true);
    render(<AgentsCard />);
    await screen.findByRole("button", { name: "Remove" });
    fireEvent.click(screen.getByRole("switch", { name: "Show in menu bar" }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(String(ask.mock.calls[0][0])).toBe("Also remove the plan-limits status line?");
    await waitFor(() =>
      expect(invokedCommands.find((c) => c.cmd === "agents_status_line_remove")?.args).toEqual({ expected: REMOVE_NEXT }),
    );
  });

  it("keeps the status line when the user says no", async () => {
    preview = { ...preview, installed: true, removeNext: REMOVE_NEXT };
    render(<AgentsCard />);
    await screen.findByRole("button", { name: "Remove" });
    fireEvent.click(screen.getByRole("switch", { name: "Show in menu bar" }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(info.menuBar).toBe(false));
    expect(invokedCommands.some((c) => c.cmd === "agents_status_line_remove")).toBe(false);
  });

  it("does not ask when the status line is not installed", async () => {
    render(<AgentsCard />);
    await screen.findByRole("button", { name: "Set up plan limits" });
    fireEvent.click(screen.getByRole("switch", { name: "Show in menu bar" }));
    await waitFor(() => expect(info.menuBar).toBe(false));
    expect(ask).not.toHaveBeenCalled();
  });
});
