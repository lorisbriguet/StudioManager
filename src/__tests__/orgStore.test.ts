import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// plugin-log needs the real Tauri bridge — unmocked it surfaces unhandled
// rejections ("Cannot read properties of undefined (reading 'invoke')").
vi.mock("../lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

import { useOrgStore, prefsFromLocalStorage } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
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

  it("prefsFromLocalStorage uses the same defaults as the app store", () => {
    expect(prefsFromLocalStorage()).toEqual({ showIncome: false, showTasksPage: true, showTimeOverview: false, calendarSync: false, calendarName: "", backupPath: "", exportLanguage: "FR" });
  });
});
