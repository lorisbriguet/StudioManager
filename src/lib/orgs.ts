import { invoke } from "@tauri-apps/api/core";
import type { AppLanguage } from "../i18n/ui";

export interface OrgPrefs {
  showIncome: boolean;
  showTasksPage: boolean;
  showTimeOverview: boolean;
  calendarSync: boolean;
  calendarName: string;
  backupPath: string;
  exportLanguage: AppLanguage;
}

export interface Organisation {
  id: string;
  name: string;
  createdAt: string;
  /** null only for the organisation created by the layout upgrade */
  prefs: OrgPrefs | null;
}

export interface Registry {
  version: number;
  activeId: string;
  organisations: Organisation[];
}

export const DEFAULT_ORG_PREFS: OrgPrefs = {
  showIncome: true,
  showTasksPage: true,
  showTimeOverview: true,
  calendarSync: false,
  calendarName: "StudioManager",
  backupPath: "",
  exportLanguage: "FR",
};

export const listOrganisations = () => invoke<Registry>("list_organisations");
export const createOrganisation = (name: string, seedFromCurrent: boolean, prefs: OrgPrefs) =>
  invoke<Registry>("create_organisation", { name, seedFromCurrent, prefs });
export const renameOrganisation = (id: string, name: string) => invoke<Registry>("rename_organisation", { id, name });
export const reorderOrganisations = (ids: string[]) => invoke<Registry>("reorder_organisations", { ids });
export const deleteOrganisation = (id: string) => invoke<Registry>("delete_organisation", { id });
export const switchOrganisationCmd = (id: string) => invoke<Registry>("switch_organisation", { id });
export const setOrganisationPrefs = (id: string, prefs: OrgPrefs) =>
  invoke<Registry>("set_organisation_prefs", { id, prefs });
