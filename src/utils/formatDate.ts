import { format } from "date-fns";
import { useAppStore, type DateFormatOption } from "../stores/app-store";

/** Format a date string (yyyy-MM-dd or ISO) for display using the user's preferred format. */
export function formatDisplayDate(dateStr: string, fmt?: DateFormatOption): string {
  const dateFormat = fmt ?? useAppStore.getState().dateFormat;
  const normalized = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T");
  const d = new Date(normalized.length === 10 ? normalized + "T00:00:00" : normalized);
  return format(d, dateFormat);
}

/** Format a date string with time (HH:mm) appended. */
export function formatDisplayDateTime(dateStr: string): string {
  const dateFormat = useAppStore.getState().dateFormat;
  // SQLite datetime uses space separator ("2026-03-09 14:30:00"), ISO uses "T"
  const normalized = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T");
  // SQLite CURRENT_TIMESTAMP is UTC — append Z so JS converts to local time
  const withTz = normalized.length === 10 ? normalized + "T00:00:00"
    : (normalized.endsWith("Z") || normalized.includes("+")) ? normalized
    : normalized + "Z";
  const d = new Date(withTz);
  return format(d, `${dateFormat} HH:mm`);
}
