import { describe, it, expect, vi } from "vitest";
import { switchOrganisation, type SwitchDeps } from "../lib/switchOrganisation";
import { useAppStore } from "../stores/app-store";

function deps(overrides: Partial<SwitchDeps> = {}) {
  const calls: string[] = [];
  const mk = <T,>(name: string, ret: T) => vi.fn(async () => { calls.push(name); return ret; });
  const d: SwitchDeps = {
    confirmIfDirty: mk("confirm", true),
    stopTimer: mk("stopTimer", true),
    exitTestMode: mk("exitTest", undefined),
    exitPresentationMode: mk("exitPres", undefined),
    resetDb: mk("resetDb", undefined),
    switchCmd: vi.fn(async (id: string) => { calls.push("switch:" + id); return { version: 1, activeId: id, organisations: [] }; }),
    applyRegistry: vi.fn(() => { calls.push("apply"); }),
    clearQueries: vi.fn(() => { calls.push("clear"); }),
    closeAllTabs: vi.fn(() => { calls.push("closeTabs"); }),
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
    // applyRegistry runs before resetDb: resetDb reopens the connection, and
    // the URL it opens is built from the org store's activeId.
    expect(calls).toEqual(["confirm", "switch:o2", "apply", "resetDb", "clear", "closeTabs", "nav:/"]);
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
    expect(calls.slice(0, 3)).toEqual(["confirm", "exitTest", "stopTimer"]);
  });

  it("aborts if the timer could not be saved", async () => {
    useAppStore.setState({ testMode: false, presentationMode: false, activeTimer: { taskId: 1, projectId: 1, startedAt: Date.now() } as never });
    const { d, calls } = deps({ stopTimer: vi.fn(async () => false) });
    expect(await switchOrganisation("o2", d)).toBe(false);
    expect(calls).not.toContain("switch:o2");
  });

  it("still clears queries, closes tabs and navigates home if resetDb rejects, but the rejection propagates", async () => {
    useAppStore.setState({ testMode: false, presentationMode: false, activeTimer: null });
    const { d, calls } = deps({
      resetDb: vi.fn(async () => { calls.push("resetDb"); throw new Error("db reopen failed"); }),
    });
    await expect(switchOrganisation("o2", d)).rejects.toThrow("db reopen failed");
    expect(calls).toEqual(["confirm", "switch:o2", "apply", "resetDb", "clear", "closeTabs", "nav:/"]);
  });
});
