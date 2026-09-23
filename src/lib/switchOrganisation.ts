import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { confirmIfDirty } from "./dirty-guard";
import { exitPresentationMode, exitTestMode } from "./modes";
import { closeDb, getDb } from "../db";
import { switchOrganisationCmd, type Registry } from "./orgs";
import { queryClient } from "./queryClient";

export interface SwitchDeps {
  confirmIfDirty: () => Promise<boolean>;
  stopTimer: () => Promise<boolean>;
  exitTestMode: () => Promise<void>;
  exitPresentationMode: () => Promise<void>;
  closeDb: () => Promise<void>;
  openDb: () => Promise<unknown>;
  switchCmd: (id: string) => Promise<Registry>;
  applyRegistry: (r: Registry) => void;
  clearQueries: () => void;
  navigate: (path: string) => void;
}

export function defaultSwitchDeps(navigate: (p: string) => void, stopTimer: () => Promise<boolean>): SwitchDeps {
  return {
    confirmIfDirty: () => confirmIfDirty(),
    stopTimer,
    exitTestMode,
    exitPresentationMode,
    closeDb,
    openDb: getDb,
    switchCmd: switchOrganisationCmd,
    applyRegistry: (r) => useOrgStore.getState().applyRegistry(r),
    clearQueries: () => queryClient.clear(),
    navigate,
  };
}

/**
 * Ordered switch. Returns false when the user declined or the timer could
 * not be saved; any other failure rejects.
 */
export async function switchOrganisation(id: string, deps: SwitchDeps): Promise<boolean> {
  if (!(await deps.confirmIfDirty())) return false;
  const { testMode, presentationMode, activeTimer } = useAppStore.getState();
  if (testMode) await deps.exitTestMode();
  if (presentationMode) await deps.exitPresentationMode();
  if (activeTimer) {
    const saved = await deps.stopTimer();
    if (!saved) return false;
  }
  // Spec §4 order: close the old connection first, so the outgoing
  // organisation's database is not held open while Rust swaps the active
  // one. Registry next — the URL the connection reopens on is built from
  // the org store's activeId — and only then reopen.
  await deps.closeDb();
  const reg = await deps.switchCmd(id);
  deps.applyRegistry(reg);
  try {
    await deps.openDb();
  } finally {
    // switchCmd already succeeded, so the new organisation is active
    // (Rust persisted it) and applyRegistry has updated the frontend
    // stores — which also reloaded the new organisation's saved tabs. The
    // UI must end up consistent with that even if reopening the database
    // fails, so these always run — clearing the stale query cache and
    // landing on the dashboard — regardless of openDb's outcome. Its
    // rejection still propagates to the caller once this finishes.
    deps.clearQueries();
    deps.navigate("/");
  }
  return true;
}
