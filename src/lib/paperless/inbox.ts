export type InboxItem = {
  connectionId: number;
  docId: number;
  title: string;
  /** The raw Paperless correspondent; matching against known suppliers happens when the form opens. */
  supplier: string | null;
  /** YYYY-MM-DD */
  date: string;
  /** The Paperless `Montant` custom field in CHF; null leaves the form's amount empty. */
  amount: number | null;
  state: "new" | "dismissed";
};

/** What `paperless_inbox` returns (Rust `InboxDoc`). */
export interface InboxDoc {
  id: number;
  title: string;
  correspondent: string | null;
  created: string;
  original_file_name: string | null;
  amount: number | null;
}

/** Transport failures start with this (Rust contract): the inbox goes offline instead of erroring. */
export const OFFLINE_PREFIX = "Paperless unreachable: ";

/**
 * The i18n key for an inbox error (the Rust strings in connectors/paperless.rs are English
 * and technical): a refused token, a bad address, a 404, another HTTP status, or anything else.
 */
export function paperlessErrorKey(message: string) {
  if (message.startsWith("Paperless refused the token")) return "paperless_error_token" as const;
  if (message.startsWith("invalid Paperless address")) return "paperless_error_address" as const;
  if (message.startsWith("Paperless error 404")) return "paperless_error_not_found" as const;
  if (message.startsWith("Paperless error")) return "paperless_error_server" as const;
  return "paperless_error_generic" as const;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** An existing supplier matching the name (case/space-insensitive), else the trimmed name; null when empty. */
export function matchSupplier(name: string | null, known: string[]): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const key = norm(trimmed);
  return known.find((k) => norm(k) === key) ?? trimmed;
}
