import { create } from "zustand";
import { useAppStore } from "./app-store";
import { listOrganisations, setOrganisationPrefs, type Organisation, type OrgPrefs, type Registry } from "../lib/orgs";
import type { AppLanguage } from "../i18n/ui";

/** localStorage keys that used to hold what is now per-organisation. */
const LEGACY_PREF_KEYS = ["showIncome", "showTasksPage", "showTimeOverview", "calendarSync", "calendarName", "backupPath", "exportLanguage"] as const;

/** Mirrors the app store's own localStorage defaults (pre-organisations). */
export function prefsFromLocalStorage(): OrgPrefs {
  return {
    showIncome: localStorage.getItem("showIncome") === "true",
    showTasksPage: localStorage.getItem("showTasksPage") !== "false",
    showTimeOverview: localStorage.getItem("showTimeOverview") === "true",
    calendarSync: localStorage.getItem("calendarSync") === "true",
    calendarName: localStorage.getItem("calendarName") ?? "",
    backupPath: localStorage.getItem("backupPath") ?? "",
    exportLanguage: ((localStorage.getItem("exportLanguage") as AppLanguage | null) ?? "FR"),
  };
}

export function applyPrefsToAppStore(prefs: OrgPrefs): void {
  useAppStore.setState({
    showIncome: prefs.showIncome,
    showTasksPage: prefs.showTasksPage,
    showTimeOverview: prefs.showTimeOverview,
    calendarSync: prefs.calendarSync,
    calendarName: prefs.calendarName,
    backupPath: prefs.backupPath,
    exportLanguage: prefs.exportLanguage,
  });
}

interface OrgState {
  organisations: Organisation[];
  activeId: string;
  loaded: boolean;
  load: () => Promise<void>;
  applyRegistry: (reg: Registry) => void;
  active: () => Organisation | undefined;
  activePrefs: () => OrgPrefs | null;
  orgKey: (base: string) => string;
  savePrefs: (partial: Partial<OrgPrefs>) => Promise<void>;
}

export const useOrgStore = create<OrgState>((set, get) => ({
  organisations: [],
  activeId: "",
  loaded: false,

  applyRegistry: (reg) => {
    set({ organisations: reg.organisations, activeId: reg.activeId });
    const prefs = get().activePrefs();
    if (prefs) applyPrefsToAppStore(prefs);
  },

  load: async () => {
    const reg = await listOrganisations();
    get().applyRegistry(reg);
    const active = reg.organisations.find((o) => o.id === reg.activeId);
    if (active && active.prefs === null) {
      // First launch after the layout upgrade: adopt the legacy localStorage values once.
      const seeded = prefsFromLocalStorage();
      const updated = await setOrganisationPrefs(active.id, seeded);
      for (const k of LEGACY_PREF_KEYS) localStorage.removeItem(k);
      get().applyRegistry(updated);
    }
    set({ loaded: true });
  },

  active: () => get().organisations.find((o) => o.id === get().activeId),
  activePrefs: () => get().active()?.prefs ?? null,
  orgKey: (base) => `${base}:${get().activeId}`,

  savePrefs: async (partial) => {
    const current = get().activePrefs();
    const id = get().activeId;
    if (!current || !id) return;
    const next = { ...current, ...partial };
    applyPrefsToAppStore(next);
    const reg = await setOrganisationPrefs(id, next);
    set({ organisations: reg.organisations });
  },
}));
