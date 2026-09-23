import { create } from "zustand";
import { useAppStore } from "./app-store";
import { listOrganisations, setOrganisationPrefs, type Organisation, type OrgPrefs, type Registry } from "../lib/orgs";
import type { AppLanguage } from "../i18n/ui";
import { logWarn } from "../lib/log";
import { notifyError, getLabels } from "../lib/notifyError";

/** localStorage keys that used to hold what is now per-organisation. */
const LEGACY_PREF_KEYS = ["showIncome", "showTasksPage", "showTimeOverview", "calendarSync", "calendarName", "backupPath", "exportLanguage"] as const;

/** localStorage keys that are now written as `<key>:<organisation id>`. */
const NAMESPACED_KEYS = ["open-tabs", "activeTimer", "tasksCollapsedProjects", "tasksProjectOrder", "lastAutoBackup"] as const;

/**
 * Rename the pre-organisation keys onto the upgraded organisation. Without
 * this the first launch after the upgrade reads `open-tabs:<id>` and
 * `activeTimer:<id>`, finds nothing, and the user silently loses their open
 * tabs, a running timer, the collapsed-project state and the auto-backup
 * clock (which then runs a backup immediately). Copy then remove, and never
 * overwrite a namespaced value that already exists.
 */
export function migrateLegacyKeysTo(id: string): void {
  if (!id) return;
  for (const key of NAMESPACED_KEYS) {
    const value = localStorage.getItem(key);
    if (value === null) continue;
    const target = `${key}:${id}`;
    if (localStorage.getItem(target) === null) localStorage.setItem(target, value);
    localStorage.removeItem(key);
  }
}

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
  /** Optimistic merge base for a `savePrefs` call still in flight. Without
   *  it, two `savePrefs` calls issued back-to-back (e.g. applying several
   *  persona preferences after a demo data load) each compute `current` from
   *  the same not-yet-updated `organisations`/localStorage source, and the
   *  second call's merge silently clobbers the first. Cleared whenever the
   *  registry is (re)applied, so it never leaks across an organisation switch. */
  pendingPrefs: OrgPrefs | null;
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
  pendingPrefs: null,

  applyRegistry: (reg) => {
    set({ organisations: reg.organisations, activeId: reg.activeId, pendingPrefs: null });
    const prefs = get().activePrefs();
    if (prefs) applyPrefsToAppStore(prefs);
    useAppStore.setState({
      lastAutoBackup: Number(localStorage.getItem(get().orgKey("lastAutoBackup"))) || 0,
    });
    // Reload the active organisation's timer. tab-store's own tabs reload
    // via its useOrgStore.subscribe() (tab-store.ts) — org-store must not
    // import tab-store, to avoid an import cycle (app-store already imports
    // org-store, so the timer reload is wired here instead).
    useAppStore.getState().reloadTimerForOrg();
  },

  load: async () => {
    const reg = await listOrganisations();
    const active = reg.organisations.find((o) => o.id === reg.activeId);
    // Null prefs mark the first launch after the layout upgrade. Rename the
    // legacy keys BEFORE applyRegistry, which reloads the tabs and the timer
    // from their namespaced keys.
    if (active && active.prefs === null) migrateLegacyKeysTo(active.id);
    get().applyRegistry(reg);
    if (active && active.prefs === null) {
      // Adopt the legacy localStorage preference values once.
      const seeded = prefsFromLocalStorage();
      try {
        const updated = await setOrganisationPrefs(active.id, seeded);
        for (const k of LEGACY_PREF_KEYS) localStorage.removeItem(k);
        get().applyRegistry(updated);
      } catch (e) {
        // Could not persist the seed (e.g. offline/DB error): keep the app usable this
        // session with the seeded values, but leave the legacy keys so the next launch retries.
        logWarn("org-store: failed to seed organisation prefs from localStorage:", e);
        applyPrefsToAppStore(seeded);
      }
    }
    set({ loaded: true });
  },

  active: () => get().organisations.find((o) => o.id === get().activeId),
  activePrefs: () => get().active()?.prefs ?? null,
  orgKey: (base) => `${base}:${get().activeId}`,

  savePrefs: async (partial) => {
    const id = get().activeId;
    if (!id) return;
    // prefs is null only between the layout upgrade and the seed write-through
    // in load() — usually because that write failed. Dropping the change on
    // the floor there turns every preference toggle into a silent no-op, so
    // merge over the same legacy values load() would have seeded from.
    // A still-in-flight (or still-failed) savePrefs' own optimistic result
    // (pendingPrefs) wins over both, so a second call issued before the first
    // resolves — or after the first failed — merges onto it instead of the
    // same stale base.
    const current = get().pendingPrefs ?? get().activePrefs() ?? prefsFromLocalStorage();
    const next = { ...current, ...partial };
    set({ pendingPrefs: next });
    applyPrefsToAppStore(next);
    try {
      const reg = await setOrganisationPrefs(id, next);
      // Only adopt/clear if THIS call's `next` is still the pending value.
      // Two calls issued back-to-back each capture their own `next` before
      // awaiting; if they resolve out of order, the earlier call's `reg`
      // reflects a now-stale write and must not overwrite the later call's
      // (already-applied) result. When it's stale, leave state untouched —
      // the later call already adopted its own (superset) registry.
      set((s) => (s.pendingPrefs === next ? { organisations: reg.organisations, pendingPrefs: null } : {}));
    } catch (e) {
      // Keep the optimistic local state (already applied above) — and keep it
      // as pendingPrefs too: the write-through failed, so `activePrefs()`
      // still reflects the pre-change registry value. Falling back to it on
      // the next call would drop this change from that call's merge and
      // re-send the stale value to the backend on the next successful save.
      notifyError(getLabels().operation_failed, e);
    }
  },
}));
