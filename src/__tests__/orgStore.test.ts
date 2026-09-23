import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// plugin-log needs the real Tauri bridge — unmocked it surfaces unhandled
// rejections ("Cannot read properties of undefined (reading 'invoke')").
vi.mock("../lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("../lib/notifyError", () => ({
  notifyError: vi.fn(),
  getLabels: () => new Proxy({}, { get: (_t, k) => String(k) }),
}));

import { useOrgStore, prefsFromLocalStorage } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { notifyError } from "../lib/notifyError";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import type { Registry } from "../lib/orgs";

const reg = (prefs: Registry["organisations"][0]["prefs"]): Registry => ({
  version: 1,
  activeId: "aaa111",
  organisations: [{ id: "aaa111", name: "Studio", createdAt: "2026-09-22T00:00:00Z", prefs }],
});

beforeEach(() => {
  localStorage.clear();
  clearInvokedCommands();
  useOrgStore.setState({ organisations: [], activeId: "", loaded: false });
  vi.mocked(notifyError).mockClear();
});
afterEach(() => setInvokeHandler(null));

describe("org store", () => {
  it("loads the registry and applies prefs to the app store", async () => {
    setInvokeHandler((cmd) => (cmd === "list_organisations" ? reg({ showIncome: false, showTasksPage: true, showTimeOverview: false, calendarSync: true, calendarName: "Label", backupPath: "/b", exportLanguage: "EN" }) : null));
    await useOrgStore.getState().load();
    expect(useOrgStore.getState().activeId).toBe("aaa111");
    expect(useOrgStore.getState().loaded).toBe(true);
    const s = useAppStore.getState();
    expect(s.showIncome).toBe(false);
    expect(s.calendarName).toBe("Label");
    expect(s.exportLanguage).toBe("EN");
  });

  it("seeds null prefs from localStorage once and clears the keys", async () => {
    localStorage.setItem("showIncome", "true");
    localStorage.setItem("calendarName", "Old");
    localStorage.setItem("backupPath", "/old");
    setInvokeHandler((cmd, args) => (cmd === "list_organisations" ? reg(null) : cmd === "set_organisation_prefs" ? reg(args.prefs as never) : null));
    await useOrgStore.getState().load();
    const set = invokedCommands.find((c) => c.cmd === "set_organisation_prefs");
    expect(set?.args).toMatchObject({ id: "aaa111", prefs: { showIncome: true, calendarName: "Old", backupPath: "/old" } });
    expect(localStorage.getItem("showIncome")).toBeNull();
    expect(localStorage.getItem("calendarName")).toBeNull();
  });

  it("keeps the app usable and finishes loading when seeding fails", async () => {
    localStorage.setItem("showIncome", "true");
    localStorage.setItem("calendarName", "Old");
    localStorage.setItem("backupPath", "/old");
    setInvokeHandler((cmd) => {
      if (cmd === "list_organisations") return reg(null);
      if (cmd === "set_organisation_prefs") throw new Error("db unavailable");
      return null;
    });
    await expect(useOrgStore.getState().load()).resolves.toBeUndefined();
    expect(useOrgStore.getState().loaded).toBe(true);
    const s = useAppStore.getState();
    expect(s.showIncome).toBe(true);
    expect(s.calendarName).toBe("Old");
    expect(s.backupPath).toBe("/old");
    expect(localStorage.getItem("showIncome")).toBe("true");
    expect(localStorage.getItem("calendarName")).toBe("Old");
    expect(localStorage.getItem("backupPath")).toBe("/old");
  });

  it("renames the pre-organisation localStorage keys onto the upgraded organisation", async () => {
    const timer = JSON.stringify({ taskId: 7, projectId: 2, startedAt: 1700000000000 });
    localStorage.setItem("activeTimer", timer);
    localStorage.setItem("open-tabs", '{"tabs":[{"id":"t1","path":"/clients","label":"Clients","pinned":false}],"activeTabId":"t1"}');
    localStorage.setItem("lastAutoBackup", "1700000000000");
    setInvokeHandler((cmd, args) => (cmd === "list_organisations" ? reg(null) : cmd === "set_organisation_prefs" ? reg(args.prefs as never) : null));

    await useOrgStore.getState().load();

    expect(localStorage.getItem("activeTimer:aaa111")).toBe(timer);
    expect(localStorage.getItem("activeTimer")).toBeNull();
    expect(localStorage.getItem("open-tabs:aaa111")).toContain("/clients");
    expect(localStorage.getItem("open-tabs")).toBeNull();
    expect(localStorage.getItem("lastAutoBackup:aaa111")).toBe("1700000000000");
    // The rename lands before applyRegistry, so the timer is picked up on
    // this very launch rather than silently lost.
    expect(useAppStore.getState().activeTimer).toMatchObject({ taskId: 7, projectId: 2 });
    expect(useAppStore.getState().lastAutoBackup).toBe(1700000000000);
  });

  it("savePrefs still writes through while prefs are null", async () => {
    localStorage.setItem("calendarName", "Old");
    setInvokeHandler((cmd, args) => (cmd === "set_organisation_prefs" ? reg(args.prefs as never) : null));
    useOrgStore.getState().applyRegistry(reg(null));
    await useOrgStore.getState().savePrefs({ showIncome: true });
    const set = invokedCommands.find((c) => c.cmd === "set_organisation_prefs");
    // Merged over the legacy localStorage values, not dropped.
    expect(set?.args).toMatchObject({ id: "aaa111", prefs: { showIncome: true, calendarName: "Old" } });
    expect(useAppStore.getState().showIncome).toBe(true);
  });

  it("orgKey namespaces localStorage keys by active id", async () => {
    useOrgStore.setState({ activeId: "aaa111" });
    expect(useOrgStore.getState().orgKey("open-tabs")).toBe("open-tabs:aaa111");
  });

  it("savePrefs merges and writes through", async () => {
    setInvokeHandler((cmd, args) => (cmd === "set_organisation_prefs" ? reg(args.prefs as never) : null));
    useOrgStore.getState().applyRegistry(reg({ showIncome: true, showTasksPage: true, showTimeOverview: true, calendarSync: false, calendarName: "StudioManager", backupPath: "", exportLanguage: "FR" }));
    await useOrgStore.getState().savePrefs({ showIncome: false });
    const set = invokedCommands.find((c) => c.cmd === "set_organisation_prefs");
    expect(set?.args).toMatchObject({ prefs: { showIncome: false, calendarName: "StudioManager" } });
  });

  it("savePrefs surfaces a write-through failure and keeps the optimistic local state", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "set_organisation_prefs") throw new Error("db unavailable");
      return null;
    });
    useOrgStore.getState().applyRegistry(reg({ showIncome: true, showTasksPage: true, showTimeOverview: true, calendarSync: false, calendarName: "StudioManager", backupPath: "", exportLanguage: "FR" }));
    await useOrgStore.getState().savePrefs({ showIncome: false });
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().showIncome).toBe(false);
  });

  it("prefsFromLocalStorage uses the same defaults as the app store", () => {
    expect(prefsFromLocalStorage()).toEqual({ showIncome: false, showTasksPage: true, showTimeOverview: false, calendarSync: false, calendarName: "", backupPath: "", exportLanguage: "FR" });
  });

  it("two savePrefs calls issued back-to-back both land, not just the last one", async () => {
    setInvokeHandler((cmd, args) => (cmd === "set_organisation_prefs" ? reg(args.prefs as never) : null));
    useOrgStore.getState().applyRegistry(reg({ showIncome: false, showTasksPage: false, showTimeOverview: false, calendarSync: false, calendarName: "", backupPath: "", exportLanguage: "FR" }));
    // No await between these two — both must read/merge before either's
    // write-through resolves, which is exactly what clobbered the first
    // call's change before the pendingPrefs fix.
    const p1 = useOrgStore.getState().savePrefs({ showIncome: true });
    const p2 = useOrgStore.getState().savePrefs({ showTasksPage: true });
    await Promise.all([p1, p2]);
    const calls = invokedCommands.filter((c) => c.cmd === "set_organisation_prefs");
    expect(calls).toHaveLength(2);
    // The second call's own write-through payload must already carry the
    // first call's change too, merged in via pendingPrefs.
    expect(calls[1].args.prefs).toMatchObject({ showIncome: true, showTasksPage: true });
    expect(useAppStore.getState().showIncome).toBe(true);
    expect(useAppStore.getState().showTasksPage).toBe(true);
  });

  it("clears pendingPrefs once a savePrefs call succeeds", async () => {
    setInvokeHandler((cmd, args) => (cmd === "set_organisation_prefs" ? reg(args.prefs as never) : null));
    useOrgStore.getState().applyRegistry(reg({ showIncome: false, showTasksPage: false, showTimeOverview: false, calendarSync: false, calendarName: "", backupPath: "", exportLanguage: "FR" }));
    await useOrgStore.getState().savePrefs({ showIncome: true });
    expect(useOrgStore.getState().pendingPrefs).toBeNull();
  });

  it("keeps the later-completing savePrefs call's result when two calls resolve out of order", async () => {
    const initial = { showIncome: false, showTasksPage: false, showTimeOverview: false, calendarSync: false, calendarName: "", backupPath: "", exportLanguage: "FR" as const };
    let resolveFirst!: (r: Registry) => void;
    let resolveSecond!: (r: Registry) => void;
    let call = 0;
    setInvokeHandler((cmd, args) => {
      if (cmd !== "set_organisation_prefs") return null;
      call += 1;
      if (call === 1) return new Promise<Registry>((resolve) => { resolveFirst = resolve; });
      if (call === 2) return new Promise<Registry>((resolve) => { resolveSecond = resolve; });
      return reg(args.prefs as never);
    });
    useOrgStore.getState().applyRegistry(reg(initial));

    // Two calls in flight at once — the second reads pendingPrefs from the
    // first (still unresolved) before either write-through completes.
    const p1 = useOrgStore.getState().savePrefs({ showIncome: true });
    const p2 = useOrgStore.getState().savePrefs({ showTasksPage: true });

    // The SECOND call's write-through completes first, carrying both changes.
    resolveSecond(reg({ ...initial, showIncome: true, showTasksPage: true }));
    await p2;
    // The FIRST call resolves last, with its own (now stale) result — it must
    // not clobber the more complete state the second call just landed.
    resolveFirst(reg({ ...initial, showIncome: true }));
    await p1;

    expect(useOrgStore.getState().pendingPrefs).toBeNull();
    expect(useOrgStore.getState().activePrefs()).toMatchObject({ showIncome: true, showTasksPage: true });

    // A third call afterwards must merge onto that complete state, not the
    // stale one the first call would have left behind.
    await useOrgStore.getState().savePrefs({ showTimeOverview: true });
    const calls = invokedCommands.filter((c) => c.cmd === "set_organisation_prefs");
    expect(calls[2].args.prefs).toMatchObject({ showIncome: true, showTasksPage: true, showTimeOverview: true });
  });
});
