import { describe, it, expect, beforeEach } from "vitest";
import { equipmentOrgId } from "../db";
import { useOrgStore } from "../stores/org-store";
import type { OrgPrefs } from "../lib/orgs";

const prefs = (equipmentFrom?: string): OrgPrefs => ({
  showIncome: true, showTasksPage: true, showTimeOverview: true,
  calendarSync: false, calendarName: "", backupPath: "", exportLanguage: "FR",
  equipmentFrom,
});
const org = (id: string, equipmentFrom?: string) => ({ id, name: id, createdAt: "", prefs: prefs(equipmentFrom) });

describe("equipmentOrgId", () => {
  beforeEach(() => useOrgStore.setState({ activeId: "", organisations: [], pendingPrefs: null }));

  it("is null when the organisation keeps its own equipment", () => {
    useOrgStore.setState({ activeId: "pers", organisations: [org("stud"), org("pers")] });
    expect(equipmentOrgId()).toBeNull();
  });

  it("names the organisation whose equipment is borrowed", () => {
    useOrgStore.setState({ activeId: "pers", organisations: [org("stud"), org("pers", "stud")] });
    expect(equipmentOrgId()).toBe("stud");
  });

  it("ignores a pointer to itself or to an organisation that no longer exists", () => {
    useOrgStore.setState({ activeId: "pers", organisations: [org("pers", "pers")] });
    expect(equipmentOrgId()).toBeNull();
    useOrgStore.setState({ organisations: [org("pers", "gone")] });
    expect(equipmentOrgId()).toBeNull();
  });
});
