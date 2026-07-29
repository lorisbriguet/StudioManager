import { format } from "date-fns";
import { useAppStore, type DateFormatOption } from "../stores/app-store";

/**
 * Parse a date string in one of the formats this app's DB produces:
 * - bare "YYYY-MM-DD" dates — parsed date-only (local midnight, no TZ shift);
 * - naive-UTC "YYYY-MM-DD HH:MM:SS" datetimes (SQLite CURRENT_TIMESTAMP /
 *   datetime('now'), space or "T" separator) — Z is appended so JS converts
 *   to local time;
 * - explicit "Z" / "+hh:mm" suffixes — passed through unchanged.
 * Negative-offset strings ("...-01:00") are NOT handled: the DB never
 * produces them (the trailing "-01:00" would be mistaken for a naive datetime).
 */
function parseDbDate(dateStr: string): Date {
  const normalized = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T");
  const withTz = normalized.length === 10 ? normalized + "T00:00:00"
    : (normalized.endsWith("Z") || normalized.includes("+")) ? normalized
    : normalized + "Z";
  return new Date(withTz);
}

/** Format a date string (yyyy-MM-dd or ISO) for display using the user's preferred format. */
export function formatDisplayDate(dateStr: string, fmt?: DateFormatOption): string {
  const dateFormat = fmt ?? useAppStore.getState().dateFormat;
  return format(parseDbDate(dateStr), dateFormat);
}

/** Format a date string with time (HH:mm) appended. */
export function formatDisplayDateTime(dateStr: string): string {
  const dateFormat = useAppStore.getState().dateFormat;
  return format(parseDbDate(dateStr), `${dateFormat} HH:mm`);
}
