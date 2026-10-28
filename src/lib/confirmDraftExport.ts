import { confirm } from "./confirm";
import { getLabels } from "./notifyError";

export type DraftExportChoice = "cancel" | "draft" | "sent";

/**
 * The one warning before exporting a draft invoice or quote (download, email,
 * preview page): Cancel · Export as draft · Mark as sent & export.
 * The caller marks the document sent when the answer is "sent".
 */
export async function confirmDraftExport(): Promise<DraftExportChoice> {
  const t = getLabels();
  const answer = await confirm({
    title: t.export_draft_title,
    message: t.export_draft_warning,
    confirmLabel: t.mark_sent_and_export,
    extra: { label: t.export_as_draft, value: "draft" },
  });
  return answer === true ? "sent" : answer === "draft" ? "draft" : "cancel";
}

/**
 * For the list pages' download and email actions: true when the export may
 * go ahead. A draft (DRAFT- reference) asks first; "Mark as sent & export"
 * runs `markSent` (the document gets its real reference) before resolving.
 * The generator then reads the document fresh from the database.
 */
export async function settleDraftBeforeExport(
  reference: string,
  markSent: () => Promise<unknown>
): Promise<boolean> {
  if (!reference.startsWith("DRAFT")) return true;
  const choice = await confirmDraftExport();
  if (choice === "cancel") return false;
  if (choice === "sent") {
    try {
      await markSent();
    } catch {
      return false; // the mutation's onError reported it
    }
  }
  return true;
}
