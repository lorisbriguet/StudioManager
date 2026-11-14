import { invoke } from "@tauri-apps/api/core";

/** Why the last try failed, as Rust names it (`ErrorKind::label`); the page words it. */
export type HubProblemKind = "notApproved" | "notStarted" | "timedOut" | "tooLarge" | "badAnswer" | "failed";

/** A hub as the Rust side shows it (camelCase over the wire). Every text but `name` comes from a connector or Rust: show it as plain text. */
export interface HubView {
  id: string;
  name: string;
  colour: string;
  folder: string;
  /** The connector, so Edit can prefill it. */
  program: string;
  args: string[];
  approved: boolean;
  waiting: number | null;
  fresh: boolean;
  checkedAt: number | null;
  problem: string | null;
  /** The kind of `problem`, to word it in the app's language; `problem` is the fallback text. */
  problemKind: HubProblemKind | null;
  nextTryAt: number | null;
  paused: boolean;
  busy: boolean;
  offers: string[];
}

/** What the form sends to add (no `id`) or change a hub. */
export interface HubInput {
  id?: string | null;
  name: string;
  colour: string;
  folder: string;
  program: string;
  args: string[];
}

/** Failed tries after which Rust stops trying by itself (`MAX_AUTO_FAILS`). */
export const HUB_MAX_FAILS = 6;

/** Rust's error when the owner cancels the native dialog of `hubs_save`. */
export const HUB_NOT_CONFIRMED = "Not saved: the connector was not allowed";

/** Every hub command answers an error text while the gate is closed (demo, Agents off, a mode). */
export const hubErrorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const isHubNotConfirmed = (e: unknown): boolean => hubErrorText(e).trim() === HUB_NOT_CONFIRMED;

export const listHubs = (): Promise<HubView[]> => invoke<HubView[]>("hubs_list");
export const saveHub = (hub: HubInput): Promise<HubView> => invoke<HubView>("hubs_save", { hub });
export const removeHub = (id: string): Promise<void> => invoke<void>("hubs_remove", { id });
/** The counts held in memory; Rust refreshes the stale ones in the background. */
export const hubCounts = (): Promise<HubView[]> => invoke<HubView[]>("hubs_counts");
export const refreshHub = (id: string): Promise<HubView> => invoke<HubView>("hubs_refresh", { id });
export const openInHub = (id: string, item?: string): Promise<void> =>
  invoke<void>("hubs_open", item === undefined ? { id } : { id, item });

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
const parts = (p: string) => trimSlash(p).toLowerCase().split("/");

/** Same rule as Rust's `tie::folder_in`: by path components, a trailing slash ignored, without case. Display only. */
export function folderIn(folder: string, root: string): boolean {
  const f = parts(folder);
  const r = parts(root);
  return r.length <= f.length && r.every((c, i) => c === f[i]);
}

/** The hub whose folder holds `folder`, for the display only (the merge rule is decided in Rust). */
export function hubForFolder(folder: string | null, hubs: HubView[]): HubView | null {
  if (!folder) return null;
  return hubs.find((h) => h.folder && folderIn(folder, h.folder)) ?? null;
}
