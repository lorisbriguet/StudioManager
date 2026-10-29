import { addInterval } from "../../utils/recurringDates";
import type { Subscription } from "../../types/upkeep";

/**
 * Every renewal date up to and including today, and the first date after.
 * Pure. Cancelled subscriptions never renew. The anchor day keeps month-end
 * renewals on the 31st across short months.
 */
export function rollRenewals(
  sub: Pick<Subscription, "renews_on" | "period" | "anchor_day" | "status">,
  todayISO: string
): { renewedOn: string[]; nextRenewsOn: string } {
  const renewedOn: string[] = [];
  let next = sub.renews_on;
  if (sub.status !== "active") return { renewedOn, nextRenewsOn: next };
  while (next <= todayISO) {
    renewedOn.push(next);
    next = addInterval(next, 1, sub.period, sub.anchor_day);
  }
  return { renewedOn, nextRenewsOn: next };
}
