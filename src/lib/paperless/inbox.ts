export type InboxItem = {
  connectionId: number;
  docId: number;
  title: string;
  /** The raw Paperless correspondent; matching against known suppliers happens when the form opens. */
  supplier: string | null;
  /** YYYY-MM-DD */
  date: string;
  state: "new" | "dismissed";
};

/** What `paperless_inbox` returns (Rust `InboxDoc`). */
export interface InboxDoc {
  id: number;
  title: string;
  correspondent: string | null;
  created: string;
  original_file_name: string | null;
}

/** Transport failures start with this (Rust contract): the inbox goes offline instead of erroring. */
export const OFFLINE_PREFIX = "Paperless unreachable: ";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** An existing supplier matching the name (case/space-insensitive), else the trimmed name; null when empty. */
export function matchSupplier(name: string | null, known: string[]): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const key = norm(trimmed);
  return known.find((k) => norm(k) === key) ?? trimmed;
}
