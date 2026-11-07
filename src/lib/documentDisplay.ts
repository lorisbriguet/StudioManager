import { isDraftDocument } from "./draftDocument";

type Labels = { draft: string };

/** How an invoice or quote is named on screen: its number, or "Draft" (never DRAFT-<uuid>). */
export function documentDisplayRef(doc: { reference: string; status?: string | null }, t: Labels): string {
  return isDraftDocument(doc) ? t.draft : doc.reference;
}

/** A status code ("paid", "on_hold") in the UI language; the code itself if it has no label. */
export function statusLabel(status: string, t: object): string {
  const label = (t as Record<string, unknown>)[status];
  return typeof label === "string" ? label : status;
}
