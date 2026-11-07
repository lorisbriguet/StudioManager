/**
 * Whether an invoice or quote is still a draft. The app gives a new draft a
 * DRAFT-<uuid> reference and the status "draft"; either one is enough, so
 * every export path warns about the same documents.
 */
export function isDraftDocument(doc: { reference: string; status?: string | null }): boolean {
  return doc.status === "draft" || doc.reference.startsWith("DRAFT");
}
