import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import { DEFAULT_ORG_PREFS } from "../lib/orgs";

beforeEach(() => {
  localStorage.clear();
  clearInvokedCommands();
  useOrgStore.getState().applyRegistry({ version: 1, activeId: "o1", organisations: [{ id: "o1", name: "S", createdAt: "", prefs: { ...DEFAULT_ORG_PREFS } }] });
  setInvokeHandler((cmd, args) => (cmd === "set_organisation_prefs" ? { version: 1, activeId: "o1", organisations: [{ id: "o1", name: "S", createdAt: "", prefs: args.prefs }] } : null));
});
afterEach(() => setInvokeHandler(null));

describe("per-organisation preference setters", () => {
  it.each([
    ["setShowIncome", false, "showIncome"],
    ["setShowTasksPage", false, "showTasksPage"],
    ["setShowTimeOverview", false, "showTimeOverview"],
    ["setCalendarSync", true, "calendarSync"],
    ["setCalendarName", "Label", "calendarName"],
    ["setBackupPath", "/x", "backupPath"],
    ["setExportLanguage", "EN", "exportLanguage"],
  ] as const)("%s writes through to the registry, not localStorage", async (setter, value, field) => {
    (useAppStore.getState()[setter] as (v: never) => void)(value as never);
    await new Promise((r) => setTimeout(r, 0));
    expect((useAppStore.getState() as unknown as Record<string, unknown>)[field]).toBe(value);
    expect(localStorage.getItem(field)).toBeNull();
    const call = invokedCommands.find((c) => c.cmd === "set_organisation_prefs");
    expect(call?.args.prefs).toMatchObject({ [field]: value });
  });

  it("app-wide setters still use localStorage", () => {
    useAppStore.getState().setDateFormat("dd.MM.yyyy" as never);
    expect(localStorage.getItem("dateFormat")).not.toBeNull();
  });
});
