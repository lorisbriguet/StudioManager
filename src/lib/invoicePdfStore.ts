import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";
import { writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";
import { InvoicePDF } from "../components/invoice/InvoicePDF";
import { getInvoice, getInvoiceLineItems, updateInvoice } from "../db/queries/invoices";
import { getClient } from "../db/queries/clients";
import { getBusinessProfile } from "../db/queries/business-profile";

/**
 * Generate an invoice PDF and store it in the app data directory.
 * Updates the invoice's pdf_path field.
 * Returns the stored file path, or null on failure.
 */
export async function generateAndStoreInvoicePdf(
  invoiceId: number
): Promise<string | null> {
  try {
    const invoice = await getInvoice(invoiceId);
    if (!invoice) return null;

    const client = await getClient(invoice.client_id);
    if (!client) return null;

    const profile = await getBusinessProfile();
    if (!profile) return null;

    const lineItems = await getInvoiceLineItems(invoiceId);

    const doc = createElement(InvoicePDF, {
      invoice,
      lineItems,
      client,
      profile,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blob = await pdf(doc as any).toBlob();
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const dataDir = await appDataDir();
    const invoicesDir = `${dataDir}/invoices`;
    if (!(await exists(invoicesDir))) {
      await mkdir(invoicesDir, { recursive: true });
    }

    // Sanitize reference to prevent path traversal
    const safeRef = invoice.reference.replace(/[/\\]/g, "_").replace(/\.\./g, "_").replace(/^\.+/, "");
    const safeName = client.name.replace(/[/\\]/g, "_").replace(/\.\./g, "_").replace(/^\.+/, "");
    const filePath = `${invoicesDir}/${safeRef}_${safeName || `invoice-${invoiceId}`}.pdf`;
    await writeFile(filePath, bytes);

    // Update invoice record with stored path
    await updateInvoice(invoiceId, { pdf_path: filePath });

    return filePath;
  } catch (e) {
    console.error("Failed to generate/store invoice PDF:", e);
    return null;
  }
}
