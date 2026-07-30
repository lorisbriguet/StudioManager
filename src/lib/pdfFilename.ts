/**
 * Build the "<Reference>_<Client>.pdf" filename used when writing a generated
 * PDF to disk. Path separators are replaced so a client name like "A/B GmbH"
 * cannot escape (or fail inside) the target directory — mirrors the temp-file
 * sanitization of the email-PDF path.
 */
export function pdfFileName(reference: string, clientName: string): string {
  return `${reference}_${clientName}.pdf`.replace(/[/\\]/g, "_");
}

/**
 * Reserve a collision-free filename within one bulk-export batch. Distinct
 * documents can map to the same name — e.g. two draft quotes for one client
 * both collapse to "DRAFT_Client.pdf" — and a later write would silently
 * overwrite the earlier one. On collision a numeric suffix is appended before
 * ".pdf" ("DRAFT_Client.pdf", "DRAFT_Client_2.pdf", ...). Names are compared
 * case-insensitively (macOS volumes usually are); the chosen name is recorded
 * in `used`.
 */
export function uniquePdfFileName(reference: string, clientName: string, used: Set<string>): string {
  const base = pdfFileName(reference, clientName);
  const stem = base.slice(0, -".pdf".length);
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    candidate = `${stem}_${n}.pdf`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}
