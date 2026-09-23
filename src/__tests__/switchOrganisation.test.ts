import { describe, it, expect, vi } from "vitest";
import { switchOrganisation, type SwitchDeps } from "../lib/switchOrganisation";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
// Importing tab-store installs its useOrgStore subscription, which is what
// reloads the tabs when applyRegistry changes the active organisation.
import { useTabStore } from "../stores/tab-store";

function deps(overrides: Partial<SwitchDeps> = {}) {
  const calls: string[] = [];
  const mk = <T,>(name: string, ret: T) => vi.fn(async () => { calls.push(name); return ret; });
  const d: SwitchDeps = {
    confirmIfDirty: mk("confirm", true),
    stopTimer: mk("stopTimer", true),
    exitTestMode: mk("exitTest", undefined),
    exitPresentationMode: mk("exitPres", undefined),
    closeDb: mk("closeDb", undefined),
    openDb: mk("openDb", undefined),
    switchCmd: vi.fn(async (id: string) => { calls.push("switch:" + id); return { version: 1, activeId: id, organisations: [] }; }),
    applyRegistry: vi.fn(() => { calls.push("apply"); }),
    clearQueries: vi.fn(() => { calls.push("clear"); }),
    navigate: vi.fn((p: string) => { calls.push("nav:" + p); }),
    ...overrides,
  };
  return { d, calls };
}

describe("switchOrganisation", () => {
  it("runs the steps in order with no mode and no timer", async () => {
    useAppStore.setState({ testMode: false, presentationMode: false, activeTimer: null });
    const { d, calls } = deps();
    expect(await switchOrganisation("o2", d)).toBe(true);
    // Spec §4: close the connection before Rust swaps the organisation, and
    // reopen only after applyRegistry (the new URL is built from activeId).
    // No closeAllTabs — applyRegistry already loaded the destination
    // organisation's own saved tabs, and closing them would persist a lone
    // Dashboard tab over them.
    expect(calls).toEqual(["confirm", "closeDb", "switch:o2", "apply", "openDb", "clear", "nav:/"]);
  });

  it("stops early when the dirty guard declines", async () => {
    const { d, calls } = deps({ confirmIfDirty: vi.fn(async () => false) });
    expect(await switchOrganisation("o2", d)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("exits an active mode and stops a running timer before switching", async () => {
    useAppStore.setState({ testMode: true, presentationMode: false, activeTimer: { taskId: 1, projectId: 1, startedAt: Date.now() } as never });
    const { d, calls } = deps();
    await switchOrganisation("o2", d);
    expect(calls.slice(0, 4)).toEqual(["confirm", "exitTest", "stopTimer", "closeDb"]);
  });

  it("aborts if the timer could not be saved", async () => {
    useAppStore.setState({ testMode: false, presentationMode: false, activeTimer: { taskId: 1, projectId: 1, startedAt: Date.now() } as never });
    const { d, calls } = deps({ stopTimer: vi.fn(async () => false) });
    expect(await switchOrganisation("o2", d)).toBe(false);
    expect(calls).not.toContain("switch:o2");
    expect(calls).not.toContain("closeDb");
  });

  it("restores the destination organisation's saved tabs", async () => {
    localStorage.clear();
    useAppStore.setState({ testMode: false, presentationMode: false, activeTimer: null });
    useOrgStore.setState({ organisations: [], activeId: "o1" });
    useTabStore.getState().reloadForOrg();
    useTabStore.getState().openTab("/clients", "Clients");
    localStorage.setItem(
      "open-tabs:o2",
      JSON.stringify({ tabs: [{ id: "t-inv", path: "/invoices", label: "Invoices", pinned: false }], activeTabId: "t-inv" })
    );

    const { d } = deps({ applyRegistry: (r) => useOrgStore.getState().applyRegistry(r) });
    expect(await switchOrganisation("o2", d)).toBe(true);

    // o2's own tabs come back, and o1's tabs are still on disk for its return.
    expect(useTabStore.getState().tabs.map((t) => t.path)).toEqual(["/invoices"]);
    expect(localStorage.getItem("open-tabs:o2")).toContain("/invoices");
    expect(localStorage.getItem("open-tabs:o1")).toContain("/clients");
  });

  it("still clears queries and navigates home if reopening rejects, but the rejection propagates", async () => {
    useAppStore.setState({ testMode: false, presentationMode: false, activeTimer: null });
    const { d, calls } = deps({
      openDb: vi.fn(async () => { calls.push("openDb"); throw new Error("db reopen failed"); }),
    });
    await expect(switchOrganisation("o2", d)).rejects.toThrow("db reopen failed");
    expect(calls).toEqual(["confirm", "closeDb", "switch:o2", "apply", "openDb", "clear", "nav:/"]);
  });
});
