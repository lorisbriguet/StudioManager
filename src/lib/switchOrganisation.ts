import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { useTabStore } from "../stores/tab-store";
import { confirmIfDirty } from "./dirty-guard";
import { exitPresentationMode, exitTestMode } from "./modes";
import { resetDb } from "../db";
import { switchOrganisationCmd, type Registry } from "./orgs";
import { queryClient } from "./queryClient";

export interface SwitchDeps {
  confirmIfDirty: () => Promise<boolean>;
  stopTimer: () => Promise<boolean>;
  exitTestMode: () => Promise<void>;
  exitPresentationMode: () => Promise<void>;
  resetDb: () => Promise<void>;
  switchCmd: (id: string) => Promise<Registry>;
  applyRegistry: (r: Registry) => void;
  clearQueries: () => void;
  closeAllTabs: () => void;
  navigate: (path: string) => void;
}

export function defaultSwitchDeps(navigate: (p: string) => void, stopTimer: () => Promise<boolean>): SwitchDeps {
  return {
    confirmIfDirty: () => confirmIfDirty(),
    stopTimer,
    exitTestMode,
    exitPresentationMode,
    resetDb,
    switchCmd: switchOrganisationCmd,
    applyRegistry: (r) => useOrgStore.getState().applyRegistry(r),
    clearQueries: () => queryClient.clear(),
    closeAllTabs: () => useTabStore.getState().closeAllTabs(),
    navigate,
  };
}

/** Ordered switch. Returns false when the user declined or the timer could not be saved. */
export async function switchOrganisation(id: string, deps: SwitchDeps): Promise<boolean> {
  if (!(await deps.confirmIfDirty())) return false;
  const { testMode, presentationMode, activeTimer } = useAppStore.getState();
  if (testMode) await deps.exitTestMode();
  if (presentationMode) await deps.exitPresentationMode();
  if (activeTimer) {
    const saved = await deps.stopTimer();
    if (!saved) return false;
  }
  const reg = await deps.switchCmd(id);
  // Registry first: resetDb reopens the connection with a URL built from activeId.
  deps.applyRegistry(reg);
  await deps.resetDb();
  deps.clearQueries();
  deps.closeAllTabs();
  deps.navigate("/");
  return true;
}
