import { invoke } from "@tauri-apps/api/core";
import { remove } from "@tauri-apps/plugin-fs";
import { copyIntoReceipts } from "../attachReceipt";
import { getConnections } from "../../db/queries/connections";
import { connectionConfig } from "../upkeep/connections";
import { useOrgStore } from "../../stores/org-store";
import { linkPaperlessDoc } from "../../db/queries/paperlessLinks";
import { getLabels, notify } from "../notify";
import { logError } from "../log";

/** Call a Paperless command for a connection with the `{ org, id, config }` args every connector command takes. */
async function call<T>(cmd: string, connectionId: number, args: Record<string, unknown>): Promise<T> {
  const c = (await getConnections()).find((x) => x.id === connectionId);
  if (!c) throw new Error(`Paperless connection ${connectionId} not found`);
  const org = useOrgStore.getState().activeId;
  return invoke<T>(cmd, { org, id: c.id, config: connectionConfig(c), ...args });
}

/**
 * Download the original file into `<app data>/paperless-cache/` (inside the
 * fs scope, so it can be copied into receipts/); resolves to its absolute path.
 */
export const paperlessDownload = (connectionId: number, docId: number) =>
  call<string>("paperless_download", connectionId, { docId });

/**
 * Copy a downloaded original into receipts/ (see `copyIntoReceipts`), then
 * delete the downloaded copy. A failed delete is only logged: the Rust side
 * prunes downloads older than a day anyway.
 */
export async function receiptFromDownload(downloadPath: string, reference: string, supplier: string): Promise<string> {
  const dest = await copyIntoReceipts(downloadPath, reference, supplier);
  try {
    await remove(downloadPath);
  } catch (e) {
    logError("Paperless download cleanup failed:", e);
  }
  return dest;
}

/** The document's thumbnail as a data URL. */
export const paperlessThumbnail = (connectionId: number, docId: number) =>
  call<string>("paperless_thumbnail", connectionId, { docId });

/** Write back after linking: set the title, add the tags (created when missing), remove "À saisir". */
export const paperlessMarkLinked = (connectionId: number, docId: number, title: string, tags: string[]) =>
  call<void>("paperless_mark_linked", connectionId, { docId, title, tags });

/** The document's page in the Paperless web app. */
export const paperlessDocUrl = (host: string, port: number, docId: number) =>
  `https://${host}:${port}/documents/${docId}/details`;

/** Where an open expense form came from in the inbox. */
export interface PaperlessSource {
  connectionId: number;
  docId: number;
  title: string;
}

/**
 * After the expense is saved: record the link, then write the title and tags
 * back to Paperless. The expense is already booked, so neither failure undoes
 * it: a failed link is an error toast, a failed write-back a warning (the link
 * is recorded, the document leaves the inbox). Resolves to whether the link
 * was recorded.
 */
export async function recordInboxLink(
  src: PaperlessSource,
  expenseId: number,
  title: string,
  tags: string[],
  /** Runs as soon as the link is recorded, before the (network) write-back. */
  onLinked: () => void
): Promise<boolean> {
  const t = getLabels();
  try {
    await linkPaperlessDoc(src.connectionId, src.docId, expenseId);
  } catch (e) {
    notify.error(t.paperless_link_failed, e);
    return false;
  }
  onLinked();
  try {
    await paperlessMarkLinked(src.connectionId, src.docId, title, tags);
  } catch (e) {
    logError("Paperless write-back failed:", e);
    notify.warning(t.paperless_writeback_failed);
  }
  return true;
}
