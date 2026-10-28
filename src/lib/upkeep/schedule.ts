import { addInterval } from "../../utils/recurringDates";
import { parseLocalDate, toLocalISO } from "../../utils/localDate";
import type { UpkeepItem } from "../../types/upkeep";

const DAY_MS = 86_400_000;

function daysBetween(fromISO: string, toISO: string): number {
  const a = parseLocalDate(fromISO);
  const b = parseLocalDate(toISO);
  // Date.UTC on the local Y/M/D avoids DST hour shifts.
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS
  );
}

function addDays(dateISO: string, n: number): string {
  const d = parseLocalDate(dateISO);
  return toLocalISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Next due date of an interval item, counted from `fromISO`. */
export function nextIntervalDue(
  item: Pick<UpkeepItem, "interval_n" | "interval_unit" | "anchor_day">,
  fromISO: string
): string {
  return addInterval(
    fromISO,
    item.interval_n ?? 1,
    item.interval_unit ?? "month",
    item.anchor_day ?? parseLocalDate(fromISO).getDate()
  );
}

/** Usage remaining before the next service, clamped to [0, every]. */
export function usageLeft(every: number, current: number, lastDone: number | null): number {
  const used = Math.max(0, current - (lastDone ?? 0));
  return Math.min(every, Math.max(0, every - used));
}

/** Average use per day over the last 30 days; null without a positive trend. */
export function dailyUse(
  readings: { value: number; read_at: string }[],
  todayISO: string
): number | null {
  const recent = readings
    .filter((r) => {
      const age = daysBetween(r.read_at, todayISO);
      return age >= 0 && age <= 30;
    })
    .sort((a, b) => (a.read_at < b.read_at ? -1 : a.read_at > b.read_at ? 1 : 0));
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const days = daysBetween(first.read_at, last.read_at);
  if (days <= 0) return null;
  const perDay = (last.value - first.value) / days;
  return perDay > 0 ? perDay : null;
}

/** Date the usage will run out: today + ceil(left / perDay) days. */
export function forecastUsageDue(
  left: number,
  perDay: number | null,
  todayISO: string
): string | null {
  if (perDay == null || perDay <= 0) return null;
  return addDays(todayISO, Math.ceil(left / perDay));
}

/** Due date that counts: a later snooze wins over next_due_on. */
export function effectiveDue(item: UpkeepItem): string | null {
  if (item.snooze_until && (!item.next_due_on || item.snooze_until > item.next_due_on)) {
    return item.snooze_until;
  }
  return item.next_due_on;
}

export function dueState(
  item: UpkeepItem,
  todayISO: string,
  soonDays: number
): "overdue" | "soon" | "later" | "none" {
  const due = effectiveDue(item);
  if (!due) return "none";
  const diff = daysBetween(todayISO, due);
  if (diff < 0) return "overdue";
  return diff <= soonDays ? "soon" : "later";
}

/** Whether a calendar event should be moved from oldISO to newISO. */
export function shouldMoveEvent(
  oldISO: string | null,
  newISO: string | null,
  schedule: "interval" | "usage"
): boolean {
  if (oldISO === newISO) return false;
  if (schedule === "interval") return true;
  if (oldISO == null || newISO == null) return true;
  return Math.abs(daysBetween(oldISO, newISO)) >= 2;
}
