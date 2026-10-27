import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentAccessCard } from "../components/settings/AgentAccessCard";
import { useOrgStore } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

const listeners: Array<() => void> = [];
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_n: string, cb: () => void) => {
    listeners.push(cb);
    return () => {};
  }),
}));

const reg = { version: 1, activeId: "o1", organisations: [
  { id: "o1", name: "Studio", createdAt: "", prefs: null },
  { id: "o2", name: "Label", createdAt: "", prefs: null },
] };

let state: { enabled: boolean; allowMoney: boolean; orgs: Record<string, boolean> };
let desktopInstalled = true;
let installError: string | null = null;
let log: { at: string; org: string; tool: string; summary: string }[] = [];
const clipboard = { writeText: vi.fn(async () => {}) };

beforeEach(() => {
  clearInvokedCommands();
  listeners.length = 0;
  clipboard.writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  state = { enabled: false, allowMoney: false, orgs: {} };
  desktopInstalled = true;
  installError = null;
  log = [];
  useAppStore.setState({ language: "EN" });
  useOrgStore.getState().applyRegistry(reg);
  setInvokeHandler((cmd, args) => {
    if (cmd === "get_agent_access") {
      return { ...state, mcpPath: "/x/studiomanager-mcp", claudeDesktopInstalled: desktopInstalled, claudeCodeCommand: "claude mcp add studiomanager -- /x/studiomanager-mcp", genericConfig: '{"mcpServers":{}}' };
    }
    if (cmd === "set_agent_access") { state = { enabled: args.enabled as boolean, allowMoney: args.allowMoney as boolean, orgs: args.orgs as Record<string, boolean> }; return null; }
    if (cmd === "preview_claude_desktop") return '{"preview":true}';
    if (cmd === "install_claude_desktop") { if (installError) throw installError; return ""; }
    if (cmd === "recent_agent_changes") return log;
    return null;
  });
});
afterEach(() => { setInvokeHandler(null); cleanup(); });

function renderCard() {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><AgentAccessCard /></QueryClientProvider>);
}
const cmds = (n: string) => invokedCommands.filter((c) => c.cmd === n);
const last = <T,>(a: T[]) => a[a.length - 1];

describe("AgentAccessCard", () => {
  it("renders off by default and hides the rest", async () => {
    renderCard();
    const sw = await screen.findByRole("switch", { name: "Allow AI agents to use StudioManager" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("Studio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
  });

  it("turning on saves immediately and shows organisations", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("switch", { name: "Allow AI agents to use StudioManager" }));
    await waitFor(() => expect(last(cmds("set_agent_access"))?.args).toEqual({ enabled: true, allowMoney: false, orgs: {} }));
    expect(await screen.findByLabelText("Studio")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Label"));
    await waitFor(() => expect(last(cmds("set_agent_access"))?.args.orgs).toEqual({ o2: false }));
  });

  it("reverts and shows the error when saving fails", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "get_agent_access") return { enabled: false, allowMoney: false, orgs: {}, mcpPath: "", claudeDesktopInstalled: false, claudeCodeCommand: "", genericConfig: "" };
      if (cmd === "set_agent_access") throw "disk full";
      if (cmd === "recent_agent_changes") return [];
      return null;
    });
    renderCard();
    const sw = await screen.findByRole("switch", { name: "Allow AI agents to use StudioManager" });
    fireEvent.click(sw);
    expect((await screen.findByRole("alert")).textContent).toContain("disk full");
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("a stale failed save does not revert a newer one", async () => {
    let rejectFirst: (e: string) => void = () => {};
    let calls = 0;
    setInvokeHandler((cmd) => {
      if (cmd === "get_agent_access") return { enabled: false, allowMoney: false, orgs: {}, mcpPath: "", claudeDesktopInstalled: false, claudeCodeCommand: "", genericConfig: "" };
      if (cmd === "set_agent_access") {
        calls += 1;
        if (calls === 1) return new Promise((_, rej) => { rejectFirst = rej; });
        return null;
      }
      if (cmd === "recent_agent_changes") return [];
      return null;
    });
    renderCard();
    fireEvent.click(await screen.findByRole("switch", { name: "Allow AI agents to use StudioManager" }));
    fireEvent.click(await screen.findByLabelText("Label"));
    await waitFor(() => expect(calls).toBe(2));
    rejectFirst("late failure");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByLabelText("Label")).toBeTruthy();
    expect((screen.getByLabelText("Label") as HTMLInputElement).checked).toBe(false);
  });

  it("Copied clears after a while and copy errors show beside the row", async () => {
    state.enabled = true;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderCard();
      fireEvent.click(await screen.findByRole("button", { name: "Copy command" }));
      expect(await screen.findByText("Copied")).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(screen.queryByText("Copied")).toBeNull();
      clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
      fireEvent.click(screen.getByRole("button", { name: "Copy config" }));
      const err = await screen.findByText("denied");
      expect(err.closest("li, div")?.textContent).toContain("Copy config");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Claude Desktop: preview first, install only after confirm", async () => {
    state.enabled = true;
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Add…" }));
    expect(await screen.findByText(/"preview":true/)).toBeTruthy();
    expect(cmds("install_claude_desktop")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(cmds("install_claude_desktop")[0].args).toEqual({ expected: '{"preview":true}' }));
    expect(await screen.findByText("Added to Claude Desktop. Restart it to load StudioManager.")).toBeTruthy();
  });

  it("shows an install error inline", async () => {
    state.enabled = true;
    installError = "Claude Desktop's settings changed; review again.";
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Add…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect((await screen.findByRole("alert")).textContent).toContain("settings changed");
    expect(screen.getByRole("button", { name: "Add…" })).toBeTruthy();
  });

  it("hides Claude Desktop row when not installed", async () => {
    state.enabled = true;
    desktopInstalled = false;
    renderCard();
    await screen.findByRole("button", { name: "Copy command" });
    expect(screen.queryByRole("button", { name: "Add…" })).toBeNull();
  });

  it("copy buttons put the exact strings on the clipboard", async () => {
    state.enabled = true;
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Copy command" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("claude mcp add studiomanager -- /x/studiomanager-mcp"));
    fireEvent.click(screen.getByRole("button", { name: "Copy config" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('{"mcpServers":{}}'));
    expect((await screen.findAllByText("Copied")).length).toBeGreaterThan(0);
  });

  it("lists recent changes with org name, empty state, and refreshes on db-changed", async () => {
    state.enabled = true;
    renderCard();
    expect(await screen.findByText("No changes yet.")).toBeTruthy();
    log = [{ at: "2026-10-27T10:00:00Z", org: "o2", tool: "add_task", summary: "Added task Foo" }];
    listeners.forEach((l) => l());
    expect(await screen.findByText("Added task Foo")).toBeTruthy();
    expect(screen.getAllByText("Label").length).toBeGreaterThan(0);
  });
});
