import { writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { updateInvoice } from "../db/queries/invoices";
import { buildInvoicePdf } from "./documentPdf";
import { logError } from "./log";
import { orgPaths } from "./orgPaths";

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/^\.+/, "")
    // eslint-disable-next-line no-control-regex -- intentional: strip null bytes for path-traversal safety
    .replace(/\x00/g, "")                        // null bytes
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "") // zero-width chars
    .normalize("NFC")
    .substring(0, 255);
}

/**
 * Generate an invoice PDF and store it in the app data directory.
 * Updates the invoice's pdf_path field.
 * Returns the stored file path, or null on failure.
 */
export async function generateAndStoreInvoicePdf(
  invoiceId: number
): Promise<string | null> {
  try {
    const built = await buildInvoicePdf(invoiceId, { withReminder: false });
    if (!built) return null;
    const { bytes, invoice, client } = built;

    const { invoicesDir } = await orgPaths();
    if (!(await exists(invoicesDir))) {
      await mkdir(invoicesDir, { recursive: true });
    }

    // Sanitize reference to prevent path traversal
    const safeRef = sanitizeFilename(invoice.reference);
    const safeName = sanitizeFilename(client.name);
    // A cancelled invoice gets its own _VOID file: the one the client got
    // stays on disk next to it.
    const voidSuffix = invoice.status === "cancelled" ? "_VOID" : "";
    const filePath = `${invoicesDir}/${safeRef}_${safeName || `invoice-${invoiceId}`}${voidSuffix}.pdf`;
    await writeFile(filePath, bytes);

    // Update invoice record with stored path
    await updateInvoice(invoiceId, { pdf_path: filePath });

    return filePath;
  } catch (e) {
    logError("Failed to generate/store invoice PDF:", e);
    return null;
  }
}
