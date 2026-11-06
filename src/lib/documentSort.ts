import { sortRows, type SortDir } from "../components/ui/SortHeader";
import { isDraftReference } from "../types/invoice";

/**
 * Sort invoice or quote rows for a list. Drafts carry a random
 * `DRAFT-<uuid>` reference, so sorting by reference orders them by creation
 * (their id) instead; they still sit together, apart from the numbered ones.
 */
export function sortDocuments<T extends { id: number; reference: string }>(rows: T[], key: string, dir: SortDir): T[] {
  if (key !== "reference") return sortRows(rows, key, dir);
  const keyed = rows.map((row) => ({
    row,
    reference_sort: isDraftReference(row.reference) ? `draft-${String(row.id).padStart(12, "0")}` : row.reference,
  }));
  return sortRows(keyed, "reference_sort", dir).map((k) => k.row);
}
