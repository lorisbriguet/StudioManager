import { open } from "@tauri-apps/plugin-dialog";
import { confirm } from "./confirm";
import { writeFile } from "@tauri-apps/plugin-fs";
import { notify } from "./notify";
import { logError } from "./log";
import { uniquePdfFileName } from "./pdfFilename";

interface BulkPdfDoc {
  id: number;
  reference: string;
}

interface BulkPdfLabels {
  export_pdfs: string;
  bulk_export_draft_warning: string;
  bulk_export_draft_title: string;
  pdf_generation_busy: string;
  bulk_export_progress: string;
  bulk_export_done: string;
  bulk_export_partial: string;
  failed_to_generate_pdf: string;
  cancel: string;
}

/**
 * Shared bulk PDF export flow for InvoicesPage and QuotesPage: busy check,
 * ONE draft warning for the whole selection (single export warns per
 * document), folder pick, sequential generation with per-doc failure
 * isolation and batch-scoped filename dedupe, one summary toast.
 */
export async function runBulkPdfExport<D extends BulkPdfDoc>(opts: {
  docs: D[];
  /** The page's busyPdfIds ref content — shared with the single-doc paths. */
  busyIds: Set<number>;
  t: BulkPdfLabels;
  generate: (
    doc: D
  ) => Promise<{ bytes: Uint8Array; reference: string; client: { name: string } } | null>;
  notFoundMessage: string;
  /** Document kind for the error log, e.g. "invoice" / "quote". */
  logLabel: string;
  onDone: () => void;
}): Promise<void> {
  const { docs, busyIds, t, generate, notFoundMessage, logLabel, onDone } = opts;
  if (docs.length === 0) return;
  // Busy check before any dialog: the dialogs are modal and block the UI
  // that could start a generation, so the set cannot change while they are
  // open — and the user never confirms a warning and picks a folder only to
  // have the export no-op.
  if (docs.some((d) => busyIds.has(d.id))) {
    notify.info(t.pdf_generation_busy);
    return;
  }
  if (docs.some((d) => d.reference.startsWith("DRAFT"))) {
    const proceed = await confirm({
      title: t.bulk_export_draft_title,
      message: t.bulk_export_draft_warning,
      confirmLabel: t.export_pdfs,
      cancelLabel: t.cancel,
    });
    if (!proceed) return;
  }
  // recursive: true extends the session fs scope to the whole subtree —
  // mirrors the backup-path picker in SettingsPage; a plain pick outside the
  // static scope roots would otherwise fail on the first write.
  const dir = await open({ directory: true, recursive: true, title: t.export_pdfs });
  if (typeof dir !== "string") return; // dialog cancelled — clean no-op
  docs.forEach((d) => busyIds.add(d.id));
  const progress = (n: number) =>
    t.bulk_export_progress.replace("{n}", String(n)).replace("{total}", String(docs.length));
  const usedNames = new Set<string>();
  try {
    await notify.progress(
      progress(1),
      async (update) => {
        let exported = 0;
        for (let i = 0; i < docs.length; i++) {
          update(progress(i + 1));
          try {
            const result = await generate(docs[i]);
            if (!result) throw new Error(notFoundMessage);
            await writeFile(
              `${dir}/${uniquePdfFileName(result.reference, result.client.name, usedNames)}`,
              result.bytes
            );
            exported++;
          } catch (err) {
            logError(`Bulk PDF export failed for ${logLabel} ${docs[i].reference}:`, err);
          }
        }
        return exported;
      },
      {
        success: (exported) =>
          exported === docs.length
            ? t.bulk_export_done.replace("{n}", String(exported))
            : { warning: t.bulk_export_partial.replace("{n}", String(exported)).replace("{total}", String(docs.length)) },
        error: t.failed_to_generate_pdf,
      }
    );
  } finally {
    docs.forEach((d) => busyIds.delete(d.id));
  }
  onDone();
}
