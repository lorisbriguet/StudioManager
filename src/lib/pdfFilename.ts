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
 * Build the "<Reference>_<Client>.pdf" filename used when writing a generated
 * PDF to disk. Path separators are replaced so a client name like "A/B GmbH"
 * cannot escape (or fail inside) the target directory — mirrors the temp-file
 * sanitization of the email-PDF path.
 */
export function pdfFileName(reference: string, clientName: string): string {
  return `${reference}_${clientName}.pdf`.replace(/[/\\]/g, "_");
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

/**
 * Reserve a collision-free "<Reference>_<Client>.pdf" within one bulk-export
 * batch — e.g. two draft quotes for one client both collapse to
 * "DRAFT_Client.pdf", so the second becomes "DRAFT_Client_2.pdf".
 */
export function uniquePdfFileName(reference: string, clientName: string, used: Set<string>): string {
  return uniqueFileName(`${reference}_${clientName}`, "pdf", used);
}
