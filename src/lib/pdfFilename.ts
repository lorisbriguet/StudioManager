import { isDraftDocument } from "./draftDocument";
import { invoiceLabels } from "../i18n/invoice-labels";

/**
 * Make one file name safe to write inside a chosen folder. Path separators
 * become "_" so a name like "A/B GmbH" cannot escape (or fail inside) the
 * target directory; control characters and leading dots are dropped so the
 * file is neither hidden nor unwritable.
 */
export function safeFileName(name: string): string {
  return name
    .replace(/[/\\]/g, "_")
    // eslint-disable-next-line no-control-regex -- intentional: strip control characters
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+/, "")
    .normalize("NFC");
}

/**
 * Build the "<stem>.pdf" filename (stem from documentPdfStem) used when
 * writing a generated PDF to disk. Path separators are replaced so a client
 * name like "A/B GmbH" cannot escape (or fail inside) the target directory —
 * mirrors the temp-file sanitization of the email-PDF path.
 */
export function pdfFileName(stem: string): string {
  return `${stem}.pdf`.replace(/[/\\]/g, "_");
}

/**
 * Reserve a collision-free "<stem>.<ext>" within one export batch. Distinct
 * files can map to the same name (two receipts with one reference and
 * supplier, two draft quotes for one client) and a later write would silently
 * overwrite the earlier one. The name goes through safeFileName, and on
 * collision a numeric suffix is appended before the extension ("a.pdf",
 * "a_2.pdf", ...). Names are compared case-insensitively (macOS volumes
 * usually are); the chosen name is recorded in `used`.
 */
export function uniqueFileName(stem: string, ext: string, used: Set<string>): string {
  const safeStem = safeFileName(stem);
  const safeExt = safeFileName(ext);
  const dotExt = safeExt ? `.${safeExt}` : "";
  let candidate = `${safeStem}${dotExt}`;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    candidate = `${safeStem}_${n}${dotExt}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export type PdfDocumentKind = "invoice" | "quote";

/**
 * The file name (without ".pdf") of an exported invoice or quote. An issued
 * document is "<Reference>_<Client>". A draft only has an internal
 * DRAFT-<uuid> placeholder, so it gets "<Brouillon-facture|Draft-invoice|
 * Brouillon-offre|Draft-quote>_<Client>_<document date>" in the document's
 * language. The document date keeps re-exports of one draft on one name;
 * bulk export adds _2, _3 when two drafts share it (see uniqueFileName).
 */
export function documentPdfStem(
  kind: PdfDocumentKind,
  doc: { reference: string; status?: string | null; language?: string | null; date?: string | null },
  clientName: string,
): string {
  if (!isDraftDocument(doc)) return `${doc.reference}_${clientName}`;
  const t = invoiceLabels[doc.language === "EN" ? "EN" : "FR"];
  const prefix = kind === "invoice" ? t.draft_invoice_file : t.draft_quote_file;
  const date = doc.date?.slice(0, 10);
  return [prefix, clientName, date].filter(Boolean).join("_");
}
