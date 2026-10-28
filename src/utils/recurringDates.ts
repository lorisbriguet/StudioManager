import { parseLocalDate, toLocalISO } from "./localDate";
import type { RecurringFrequency } from "../types/recurring";
import type { IntervalUnit } from "../types/upkeep";

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
  return addInterval(dateISO, MONTHS_PER_PERIOD[frequency], "month", anchorDay);
}

/**
 * Add `n` units to a date. Day/week steps are plain day arithmetic; month/year
 * steps target `min(anchorDay, daysInTargetMonth)` exactly like `advanceDate`.
 */
export function addInterval(
  dateISO: string,
  n: number,
  unit: IntervalUnit,
  anchorDay: number
): string {
  const d = parseLocalDate(dateISO);
  if (unit === "day" || unit === "week") {
    const days = n * (unit === "week" ? 7 : 1);
    return toLocalISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
  }
  const months = unit === "year" ? n * 12 : n;
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(Math.max(anchorDay, 1), daysInTargetMonth));
  return toLocalISO(target);
}
