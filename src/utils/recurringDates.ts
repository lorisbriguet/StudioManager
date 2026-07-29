import { parseLocalDate, toLocalISO } from "./localDate";
import type { RecurringFrequency } from "../types/recurring";

const MONTHS_PER_PERIOD: Record<RecurringFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  biannual: 6,
  annual: 12,
};

/**
 * Advance a recurring template's due date by one period.
 *
 * Each step targets `min(anchorDay, daysInTargetMonth)` so a clamp in a short
 * month never becomes permanent: Jan 31 → Feb 28 → Mar 31 (anchor 31), not
 * Mar 28 forever. `anchorDay` must be the IMMUTABLE day-of-month of the base
 * invoice's invoice_date — never the day of the mutating next_due, which
 * decays after one clamp.
 *
 * The result is always strictly later than `dateISO` (the target month is at
 * least one month ahead and the day is >= 1), which guarantees termination of
 * catch-up loops built on this function.
 */
export function advanceDate(
  dateISO: string,
  frequency: RecurringFrequency,
  anchorDay: number
): string {
  const d = parseLocalDate(dateISO);
  const target = new Date(d.getFullYear(), d.getMonth() + MONTHS_PER_PERIOD[frequency], 1);
  const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(Math.max(anchorDay, 1), daysInTargetMonth));
  return toLocalISO(target);
}
