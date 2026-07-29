/**
 * Local-calendar-date helpers.
 *
 * `new Date().toISOString()` yields the UTC day, which lags the local day
 * between midnight and 01:00/02:00 in CET/CEST. Anything that means "today's
 * calendar date" for comparing against or storing into local-date fields
 * (due_date, paid_date, next_due, ...) must go through these helpers instead.
 */

/** Format a Date as YYYY-MM-DD using its LOCAL calendar date (never toISOString, which uses UTC). */
export function toLocalISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today's date as YYYY-MM-DD in LOCAL time. */
export function todayLocalISO(): string {
  return toLocalISO(new Date());
}

/**
 * Parse a YYYY-MM-DD string as LOCAL midnight.
 * (`new Date("YYYY-MM-DD")` parses as UTC midnight, which shifts the calendar
 * day in timezones behind UTC.)
 */
export function parseLocalDate(s: string): Date {
  return new Date(
    Number(s.slice(0, 4)),
    Number(s.slice(5, 7)) - 1,
    Number(s.slice(8, 10))
  );
}
