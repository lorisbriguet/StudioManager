import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import { emit } from "../__mocks__/tauri-event";
import { useAppStore } from "../stores/app-store";
import {
  hubCounts, hubForFolder, isHubNotConfirmed, listHubs, openInHub, refreshHub, removeHub, saveHub, type HubView,
} from "../lib/hubs";
import { useHubWaiting, useHubs } from "../hooks/useHubs";
import { useNeedsYouCount } from "../db/hooks/useNeedsYou";

vi.mock("../db/queries/needsYou", async (orig) => ({ ...(await orig<object>()), getOpenEntries: async () => [{ id: 1 }, { id: 2 }] }));
vi.mock("../db/hooks/useCaptures", () => ({ useBriefEntries: () => ({ data: [{ capture_id: 1 }] }) }));
vi.mock("../db/hooks/useTasks", () => ({ useUpdateTask: () => ({}), useUpdateSubtask: () => ({}) }));

const hub = (over: Partial<HubView> = {}): HubView => ({
  id: "h1", name: "Demo hub", colour: "purple", folder: "/data/demo-hub", program: "/bin/sh", args: ["connector.sh"],
  approved: true, waiting: 3, fresh: true, checkedAt: 1, problem: null, problemKind: null, nextTryAt: null, paused: false, busy: false, offers: ["counts"], ...over,
});

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  clearInvokedCommands();
  setInvokeHandler(null);
  useAppStore.setState({ agentsEnabled: true });
  vi.unstubAllEnvs();
});

describe("the hub wrappers", () => {
  it("call the right commands with the right arguments", async () => {
    setInvokeHandler(() => []);
    const input = { id: null, name: "Demo hub", colour: "teal", folder: "/data/demo-hub", program: "/bin/sh", args: ["a", "b"] };
    await listHubs();
    await saveHub(input);
    await removeHub("h1");
    await hubCounts();
    await refreshHub("h1");
    await openInHub("h1");
    await openInHub("h1", "item-1");
    expect(invokedCommands).toEqual([
      { cmd: "hubs_list", args: {} },
      { cmd: "hubs_save", args: { hub: input } },
      { cmd: "hubs_remove", args: { id: "h1" } },
      { cmd: "hubs_counts", args: {} },
      { cmd: "hubs_refresh", args: { id: "h1" } },
      { cmd: "hubs_open", args: { id: "h1" } },
      { cmd: "hubs_open", args: { id: "h1", item: "item-1" } },
    ]);
  });

  it("tell a cancelled approval from another failure", () => {
    expect(isHubNotConfirmed("Not saved: the connector was not allowed")).toBe(true);
    expect(isHubNotConfirmed(new Error("Not saved: the connector was not allowed"))).toBe(true);
    expect(isHubNotConfirmed("Another hub has this name.")).toBe(false);
  });
});

describe("hubForFolder", () => {
  const hubs = [hub({ folder: "/Data/Demo-Hub/" })];
  it("matches by path components, without case, ignoring a trailing slash", () => {
    expect(hubForFolder("/data/demo-hub", hubs)?.name).toBe("Demo hub");
    expect(hubForFolder("/data/demo-hub/", hubs)?.name).toBe("Demo hub");
    expect(hubForFolder("/DATA/demo-hub/poster/", hubs)?.name).toBe("Demo hub");
  });
  it("does not match a sibling with the same prefix, a parent or no folder", () => {
    expect(hubForFolder("/data/demo-hub-old", hubs)).toBeNull();
    expect(hubForFolder("/data", hubs)).toBeNull();
    expect(hubForFolder(null, hubs)).toBeNull();
    expect(hubForFolder("", hubs)).toBeNull();
  });
});

describe("useHubWaiting and the Needs you count", () => {
  it("counts only fresh hubs", async () => {
    setInvokeHandler((cmd) => (cmd === "hubs_counts" ? [hub({ waiting: 3 }), hub({ id: "h2", waiting: 9, fresh: false })] : null));
    const { result } = renderHook(() => useHubWaiting(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toBe(3));
  });

  it("adds 3 for a fresh hub with 3 waiting and 0 for a stale one", async () => {
    setInvokeHandler((cmd) => (cmd === "hubs_counts" ? [hub({ waiting: 3 })] : null));
    const fresh = renderHook(() => useNeedsYouCount(), { wrapper: wrapper() });
    await waitFor(() => expect(fresh.result.current).toBe(6));
    setInvokeHandler((cmd) => (cmd === "hubs_counts" ? [hub({ waiting: 3, fresh: false })] : null));
    const stale = renderHook(() => useNeedsYouCount(), { wrapper: wrapper() });
    await waitFor(() => expect(stale.result.current).toBe(3));
    await new Promise((r) => setTimeout(r, 20));
    expect(stale.result.current).toBe(3);
  });

  it("counts no hub after an error, and does not retry", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "hubs_counts") throw "Hubs are paused while an organisation is in test mode.";
      return null;
    });
    const { result } = renderHook(() => ({ n: useHubWaiting(), q: useHubs() }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.q.isError).toBe(true));
    expect(result.current.n).toBe(0);
    await new Promise((r) => setTimeout(r, 30));
    expect(invokedCommands.filter((c) => c.cmd === "hubs_counts")).toHaveLength(1);
  });

  it("reads again when Rust says a run ended", async () => {
    setInvokeHandler((cmd) => (cmd === "hubs_counts" ? [hub()] : null));
    renderHook(() => useHubs(), { wrapper: wrapper() });
    await waitFor(() => expect(invokedCommands.filter((c) => c.cmd === "hubs_counts")).toHaveLength(1));
    await emit("hubs-changed");
    await waitFor(() => expect(invokedCommands.filter((c) => c.cmd === "hubs_counts")).toHaveLength(2));
  });
});

describe("the hubs-changed listener", () => {
  it("is one for the app, however many callers read the hubs", async () => {
    setInvokeHandler((cmd) => (cmd === "hubs_counts" ? [hub()] : null));
    const w = wrapper();
    renderHook(() => ({ a: useHubs(), b: useHubs(), c: useHubWaiting() }), { wrapper: w });
    renderHook(() => useHubs(), { wrapper: w });
    await waitFor(() => expect(invokedCommands.filter((c) => c.cmd === "hubs_counts")).toHaveLength(1));
    await emit("hubs-changed");
    await waitFor(() => expect(invokedCommands.filter((c) => c.cmd === "hubs_counts")).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    // One event, one read: not one restart per caller.
    expect(invokedCommands.filter((c) => c.cmd === "hubs_counts")).toHaveLength(2);
  });

  it("is removed with the last caller and set again by the next", async () => {
    setInvokeHandler((cmd) => (cmd === "hubs_counts" ? [hub()] : null));
    const first = renderHook(() => useHubs(), { wrapper: wrapper() });
    await waitFor(() => expect(invokedCommands.filter((c) => c.cmd === "hubs_counts")).toHaveLength(1));
    first.unmount();
    await emit("hubs-changed");
    await new Promise((r) => setTimeout(r, 20));
    expect(invokedCommands.filter((c) => c.cmd === "hubs_counts")).toHaveLength(1);
    renderHook(() => useHubs(), { wrapper: wrapper() });
    await waitFor(() => expect(invokedCommands.filter((c) => c.cmd === "hubs_counts")).toHaveLength(2));
    await emit("hubs-changed");
    await waitFor(() => expect(invokedCommands.filter((c) => c.cmd === "hubs_counts")).toHaveLength(3));
  });
});

describe("when hubs are off", () => {
  it("never invokes in the demo build", async () => {
    vi.stubEnv("VITE_DEMO_BUILD", "1");
    renderHook(() => useHubs(), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(invokedCommands).toEqual([]);
  });

  it("never invokes while Agents is off", async () => {
    useAppStore.setState({ agentsEnabled: false });
    renderHook(() => useHubs(), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(invokedCommands).toEqual([]);
  });
});

describe("the sources", () => {
  it("hubs_ts_logs_and_stores_nothing", () => {
    for (const file of ["src/lib/hubs.ts", "src/hooks/useHubs.ts"]) {
      const code = readFileSync(join(__dirname, "../..", file), "utf8");
      for (const word of ["logInfo", "logWarn", "logError", "console.", "localStorage", "sessionStorage"]) {
        expect(code, `${file} mentions ${word}`).not.toContain(word);
      }
    }
  });
});
