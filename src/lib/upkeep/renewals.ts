import { addInterval } from "../../utils/recurringDates";
import type { Subscription } from "../../types/upkeep";

/**
 * The renewal to record now, and the first date after today. Pure. Cancelled
 * subscriptions never renew. The anchor day keeps month-end renewals on the
 * 31st across short months.
 *
 * At most one renewal per check: the latest that came due. A "renews on" far
 * in the past (the original subscription date, a restored backup) would
 * otherwise become one "add to expenses?" question per period since, 33 for
 * a monthly subscription from 2024. The older dates are passed over: the
 * date moves past today and only the most recent renewal is asked about.
 */
export function rollRenewals(
  sub: Pick<Subscription, "renews_on" | "period" | "anchor_day" | "status">,
  todayISO: string
): { renewedOn: string[]; nextRenewsOn: string } {
  let next = sub.renews_on;
  if (sub.status !== "active") return { renewedOn: [], nextRenewsOn: next };
  let latest: string | null = null;
  while (next <= todayISO) {
    latest = next;
    next = addInterval(next, 1, sub.period, sub.anchor_day);
  }
  return { renewedOn: latest ? [latest] : [], nextRenewsOn: next };
}

/**
 * A "renews on" typed in the form, moved forward by whole periods to the
 * first renewal on or after today (unchanged when not past). The day of the
 * typed date is the anchor, so a 31st stays a month-end renewal.
 */
export function nextRenewalFrom(
  renewsOnISO: string,
  period: Subscription["period"],
  todayISO: string
): string {
  const anchor = Number(renewsOnISO.slice(8, 10));
  let next = renewsOnISO;
  while (next < todayISO) next = addInterval(next, 1, period, anchor);
  return next;
}
