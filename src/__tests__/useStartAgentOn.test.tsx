import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, renderHook, act, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { ConfirmHost } from "../components/ui/ConfirmDialog";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import type { AgentItem } from "../lib/agentStart";

vi.mock("../lib/log", () => ({ logError: vi.fn(() => Promise.resolve()) }));
vi.mock("../lib/notify", async (orig) => ({
  ...(await orig<typeof import("../lib/notify")>()),
  ...(await import("../__mocks__/notify")).notifyMockModule(),
}));
const item = vi.hoisted(() => ({ current: null as AgentItem | null }));
vi.mock("../lib/agentStart", async (orig) => ({
  ...(await orig<typeof import("../lib/agentStart")>()),
  loadAgentItem: vi.fn(async () => item.current),
}));
const picked = vi.hoisted(() => ({ dir: null as string | null }));
vi.mock("@tauri-apps/plugin-dialog", async (orig) => ({
  ...(await orig<object>()),
  open: vi.fn(async () => picked.dir),
}));
const mutateAsync = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../db/hooks/useProjects", () => ({ useUpdateProject: () => ({ mutateAsync }) }));
// The Agents page counts captures on its tabs; this test is about ?started=.
vi.mock("../db/hooks/useCaptures", () => ({
  useCaptures: () => ({ data: [] }),
  useBriefEntries: () => ({ data: [] }),
}));

vi.mock("../db/hooks/useNeedsYou", () => ({ useNeedsYouCount: () => 0, useOpenEntries: () => ({ data: [] }) }));

const linkAgent = vi.hoisted(() => vi.fn(async (_: unknown) => 1));
vi.mock("../db/queries/taskAgents", async (orig) => ({
  ...(await orig<typeof import("../db/queries/taskAgents")>()),
  linkAgent,
}));

import { useStartAgentOn } from "../hooks/useStartAgentOn";
import { notify } from "../lib/notify";
import { AgentsPage } from "../pages/AgentsPage";

let where = "";
function Probe() {
  const loc = useLocation();
  useEffect(() => {
    where = loc.pathname + loc.search;
  }, [loc]);
  return null;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/tasks"]}>
      {children}
      <Routes>
        <Route path="*" element={<Probe />} />
      </Routes>
      <ConfirmHost />
    </MemoryRouter>
  );
}

const task = (folder: string | null): AgentItem => ({
  kind: "task",
  id: 44,
  title: "New Features",
  project: { id: 4, name: "Studio Manager App", folder },
  orgId: "6kun0b",
});

let trusted = true;
let startFails = false;
function handler(cmd: string) {
  if (cmd === "agents_start_folders") return [{ path: "/work", label: null, trusted, home: false }];
  if (cmd === "agents_trust_folder") return "/work/proj";
  if (cmd === "agents_start") {
    if (startFails) throw new Error("boom");
    return "abcd1234";
  }
  return null;
}
const starts = () => invokedCommands.filter((c) => c.cmd === "agents_start");

describe("useStartAgentOn", () => {
  beforeEach(() => {
    clearInvokedCommands();
    vi.clearAllMocks();
    trusted = true;
    startFails = false;
    picked.dir = null;
    item.current = task("/work/proj");
    where = "";
    useAppStore.setState({ agentsEnabled: true, language: "EN" });
    useAppStore.setState({ testMode: false, presentationMode: false });
    useOrgStore.setState({ activeId: "6kun0b" });
    setInvokeHandler((cmd) => handler(cmd));
  });

  const startOn = async (target: { kind: "task" | "subtask" | "project"; id: number }) => {
    const { result } = renderHook(() => useStartAgentOn(), { wrapper });
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.start(target);
    });
    return started;
  };

  it("links the agent to the task it was started from, with its own server asked for", async () => {
    expect(await startOn({ kind: "task", id: 44 })).toBe(true);
    expect(starts()[0].args).toMatchObject({ ownServer: true });
    expect(linkAgent).toHaveBeenCalledTimes(1);
    expect(linkAgent).toHaveBeenCalledWith({
      kind: "task",
      id: 44,
      shortId: "abcd1234",
      name: "task-44-new-features",
      model: "opus",
    });
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("writes no link for a project start", async () => {
    item.current = { kind: "project", id: 4, title: "Studio Manager App", project: task("/work/proj").project, orgId: "6kun0b" };
    expect(await startOn({ kind: "project", id: 4 })).toBe(true);
    expect(linkAgent).not.toHaveBeenCalled();
  });

  it("starts but writes no link in test mode or presentation mode", async () => {
    useAppStore.setState({ testMode: true });
    expect(await startOn({ kind: "task", id: 44 })).toBe(true);
    useAppStore.setState({ testMode: false, presentationMode: true });
    expect(await startOn({ kind: "task", id: 44 })).toBe(true);
    expect(starts()).toHaveLength(2);
    expect(linkAgent).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("says so, and writes no link, when the organisation changed while starting", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "agents_start") useOrgStore.setState({ activeId: "other1" });
      return handler(cmd);
    });
    expect(await startOn({ kind: "task", id: 44 })).toBe(true);
    expect(linkAgent).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith("The agent started, but the task does not show it");
    expect(where).toBe("/agents?started=abcd1234");
  });

  it("still opens the agent when the link can't be written", async () => {
    const boom = new Error("locked");
    linkAgent.mockRejectedValueOnce(boom);
    expect(await startOn({ kind: "task", id: 44 })).toBe(true);
    expect(notify.error).toHaveBeenCalledWith("The agent started, but the task does not show it", boom);
    expect(where).toBe("/agents?started=abcd1234");
  });

  it("is disabled while agents are off", () => {
    useAppStore.setState({ agentsEnabled: false });
    const { result } = renderHook(() => useStartAgentOn(), { wrapper });
    expect(result.current.enabled).toBe(false);
  });

  it("starts on Opus in the linked folder and opens the agent", async () => {
    const { result } = renderHook(() => useStartAgentOn(), { wrapper });
    let started: boolean | undefined;
    await act(async () => {
      started = await result.current.start({ kind: "task", id: 44 });
    });
    expect(started).toBe(true);
    expect(starts()).toHaveLength(1);
    expect(starts()[0].args).toMatchObject({
      folder: "/work/proj",
      model: "opus",
      name: "task-44-new-features",
    });
    expect(String(starts()[0].args.task)).toMatch(/^Work on StudioManager task 44 "New Features"/);
    expect(where).toBe("/agents?started=abcd1234");
  });

  it("asks for a folder when none is linked and saves it on the project", async () => {
    item.current = task(null);
    picked.dir = "/work/new";
    const { result } = renderHook(() => useStartAgentOn(), { wrapper });
    await act(() => result.current.start({ kind: "task", id: 44 }));
    expect(mutateAsync).toHaveBeenCalledWith({ id: 4, data: { folder_path: "/work/new" } });
    expect(starts()[0].args.folder).toBe("/work/new");
  });

  it("stops quietly when the folder picker is cancelled", async () => {
    item.current = task(null);
    const { result } = renderHook(() => useStartAgentOn(), { wrapper });
    await act(() => expect(result.current.start({ kind: "task", id: 44 })).resolves.toBe(false));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(starts()).toHaveLength(0);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("asks before trusting an untrusted folder; declining starts nothing", async () => {
    trusted = false;
    const { result } = renderHook(() => useStartAgentOn(), { wrapper });
    let done: Promise<boolean> = Promise.resolve(false);
    act(() => {
      done = result.current.start({ kind: "task", id: 44 });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await act(async () => {
      expect(await done).toBe(false);
    });
    expect(invokedCommands.some((c) => c.cmd === "agents_trust_folder")).toBe(false);
    expect(starts()).toHaveLength(0);
  });

  it("trusts then starts when the folder is confirmed", async () => {
    trusted = false;
    const { result } = renderHook(() => useStartAgentOn(), { wrapper });
    let done: Promise<boolean> = Promise.resolve(false);
    act(() => {
      done = result.current.start({ kind: "task", id: 44 });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Trust and start" }));
    await act(async () => {
      expect(await done).toBe(true);
    });
    expect(invokedCommands.some((c) => c.cmd === "agents_trust_folder")).toBe(true);
    expect(starts()).toHaveLength(1);
  });

  it("shows the start error and stays on the page when the start fails", async () => {
    startFails = true;
    const { result } = renderHook(() => useStartAgentOn(), { wrapper });
    await act(() => expect(result.current.start({ kind: "task", id: 44 })).resolves.toBe(false));
    expect(notify.error).toHaveBeenCalledWith("Couldn't start the agent", expect.anything());
    expect(where).toBe("/tasks");
  });

  it("shows the start error when the item can't be read, and never rejects", async () => {
    const { loadAgentItem } = await import("../lib/agentStart");
    vi.mocked(loadAgentItem).mockRejectedValueOnce(new Error("database is locked"));
    const { result } = renderHook(() => useStartAgentOn(), { wrapper });
    await act(() => expect(result.current.start({ kind: "task", id: 44 })).resolves.toBe(false));
    expect(notify.error).toHaveBeenCalledWith("Couldn't start the agent", expect.anything());
    expect(starts()).toHaveLength(0);
  });

  it("stops without rejecting when saving the picked folder fails", async () => {
    item.current = task(null);
    picked.dir = "/work/new";
    mutateAsync.mockRejectedValueOnce(new Error("save failed"));
    const { result } = renderHook(() => useStartAgentOn(), { wrapper });
    await act(() => expect(result.current.start({ kind: "task", id: 44 })).resolves.toBe(false));
    expect(starts()).toHaveLength(0);
  });

  it("starts once when clicked twice while starting", async () => {
    const { result } = renderHook(() => useStartAgentOn(), { wrapper });
    let results: boolean[] = [];
    await act(async () => {
      results = await Promise.all([
        result.current.start({ kind: "task", id: 44 }),
        result.current.start({ kind: "task", id: 44 }),
      ]);
    });
    expect(results).toEqual([true, false]);
    expect(starts()).toHaveLength(1);
  });
});

describe("AgentsPage ?started=", () => {
  it("selects the started agent once it is listed", async () => {
    setInvokeHandler((cmd) =>
      cmd === "agents_list"
        ? [
            {
              sessionId: "sess-1", shortId: "abcd1234", pid: null, name: "task-44-new-features", cwd: "/work/proj",
              kind: "background", status: "idle", state: null, waitingFor: null, startedAt: 0, group: "idle",
              quiet: null, project: null, model: null, modelLabel: null,
            },
          ]
        : [],
    );
    render(
      <MemoryRouter initialEntries={["/agents?started=abcd1234"]}>
        <Routes>
          <Route path="/agents" element={<><AgentsPage /><Probe /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(where).toBe("/agents?agent=sess-1"));
  });
});
