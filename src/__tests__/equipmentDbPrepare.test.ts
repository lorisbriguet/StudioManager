import { describe, it, expect, vi, beforeEach } from "vitest";

const { calls, invoke, load } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    invoke: vi.fn(async (cmd: string) => { calls.push(cmd); }),
    load: vi.fn(async (url: string) => { calls.push(`load ${url}`); return { close: async () => {} }; }),
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load } }));

import { getEquipmentDb, closeEquipmentDb } from "../db";
import { useOrgStore } from "../stores/org-store";
import type { OrgPrefs } from "../lib/orgs";

const prefs = (equipmentFrom?: string): OrgPrefs => ({
  showIncome: true, showTasksPage: true, showTimeOverview: true,
  calendarSync: false, calendarName: "", backupPath: "", exportLanguage: "FR",
  equipmentFrom,
});
const org = (id: string, equipmentFrom?: string) => ({ id, name: id, createdAt: "", prefs: prefs(equipmentFrom) });

describe("getEquipmentDb", () => {
  beforeEach(async () => {
    await closeEquipmentDb();
    calls.length = 0;
    invoke.mockClear();
    load.mockClear();
    useOrgStore.setState({ activeId: "pers", organisations: [org("stud"), org("pers", "stud")], pendingPrefs: null });
  });

  it("brings the lender's database up to date before opening it", async () => {
    await getEquipmentDb();
    expect(invoke).toHaveBeenCalledWith("prepare_equipment_org", { id: "stud" });
    expect(calls).toEqual(["prepare_equipment_org", "load sqlite:orgs/stud/studiomanager.db"]);
  });

  it("does not open the lender when it cannot be prepared, and retries next time", async () => {
    invoke.mockRejectedValueOnce(new Error("migration 13 failed"));
    await expect(getEquipmentDb()).rejects.toThrow("migration 13 failed");
    expect(load).not.toHaveBeenCalledWith("sqlite:orgs/stud/studiomanager.db");
    await getEquipmentDb();
    expect(calls).toContain("load sqlite:orgs/stud/studiomanager.db");
  });
});
