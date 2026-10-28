import { getDb, validateFields, TransactionBatch } from "../index";
import { rollRenewals } from "../../lib/upkeep/renewals";
import type { Subscription, SubscriptionRenewal } from "../../types/upkeep";

export type SubscriptionInput = Pick<Subscription, "name" | "renews_on" | "period"> &
  Partial<
    Pick<
      Subscription,
      "plan" | "vendor" | "url" | "anchor_day" | "cost" | "currency" | "status" |
      "in_calendar" | "alert" | "notes"
    >
  >;

const SUBSCRIPTION_COLUMNS = [
  "name", "plan", "vendor", "url", "renews_on", "anchor_day", "period", "cost", "currency",
  "status", "in_calendar", "alert", "notes",
] as const;

export type PendingRenewal = SubscriptionRenewal & { name: string };

export async function getSubscriptions(): Promise<Subscription[]> {
  const db = await getDb();
  return db.select<Subscription[]>(
    "SELECT * FROM subscriptions ORDER BY (status = 'cancelled') ASC, renews_on ASC, name ASC"
  );
}

export async function getSubscription(id: number): Promise<Subscription | null> {
  const db = await getDb();
  const rows = await db.select<Subscription[]>("SELECT * FROM subscriptions WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function createSubscription(data: SubscriptionInput): Promise<number> {
  const row: SubscriptionInput = {
    ...data,
    anchor_day: data.anchor_day ?? Number(data.renews_on.slice(8, 10)),
  };
  const cols = SUBSCRIPTION_COLUMNS.filter((c) => row[c] !== undefined);
  validateFields([...cols]);
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO subscriptions (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => row[c])
  );
  return result.lastInsertId ?? 0;
}

export async function updateSubscription(id: number, inputData: Partial<SubscriptionInput>): Promise<void> {
  // A new renewal date moves the day-of-month the subscription rolls on.
  // Only when the date actually changed: a rolled "...-02-28" must not reset a 31st anchor on an unrelated edit.
  let data: Partial<SubscriptionInput> = inputData;
  if (inputData.renews_on && inputData.anchor_day === undefined) {
    const current = await getSubscription(id);
    if (!current || current.renews_on !== inputData.renews_on) {
      data = { ...inputData, anchor_day: Number(inputData.renews_on.slice(8, 10)) };
    }
  }
  const fields = Object.keys(data).filter(
    (k) => (SUBSCRIPTION_COLUMNS as readonly string[]).includes(k) && data[k as keyof SubscriptionInput] !== undefined
  );
  if (fields.length === 0) return;
  validateFields(fields);
  const db = await getDb();
  const sets = fields.map((f, i) => `${f} = $${i + 1}`);
  sets.push("updated_at = datetime('now')");
  await db.execute(
    `UPDATE subscriptions SET ${sets.join(", ")} WHERE id = $${fields.length + 1}`,
    [...fields.map((f) => data[f as keyof SubscriptionInput]), id]
  );
}

export async function cancelSubscription(id: number): Promise<void> {
  await updateSubscription(id, { status: "cancelled" });
}

export async function deleteSubscription(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM subscriptions WHERE id = $1", [id]);
}

/**
 * Remember the Apple Calendar renewal event. Bookkeeping only: does not touch
 * updated_at or any user-visible field.
 */
export async function setSubscriptionCalendarEvent(
  id: number,
  eventId: string | null,
  expectedOrg?: string
): Promise<void> {
  const batch = new TransactionBatch(expectedOrg);
  batch.add("UPDATE subscriptions SET calendar_event_id = $1 WHERE id = $2", [eventId, id]);
  await batch.commit();
}

/**
 * Record every renewal that has come due and move renews_on forward, in one
 * atomic batch. Each renewal is a pending "add to expenses?" question; nothing
 * is written to Expenses. Idempotent: INSERT OR IGNORE plus the advanced
 * renews_on means a second call finds nothing due. Returns the renewals recorded.
 */
export async function applyRenewals(
  sub: Subscription,
  todayISO: string,
  expectedOrg?: string
): Promise<number> {
  const { renewedOn, nextRenewsOn } = rollRenewals(sub, todayISO);
  if (renewedOn.length === 0) return 0;
  const batch = new TransactionBatch(expectedOrg);
  for (const on of renewedOn) {
    batch.add(
      `INSERT OR IGNORE INTO subscription_renewals (subscription_id, renewed_on, amount, currency)
       VALUES ($1, $2, $3, $4)`,
      [sub.id, on, sub.cost, sub.currency]
    );
  }
  batch.add(
    "UPDATE subscriptions SET renews_on = $1, updated_at = datetime('now') WHERE id = $2",
    [nextRenewsOn, sub.id]
  );
  await batch.commit();
  return renewedOn.length;
}

export async function getPendingRenewals(): Promise<PendingRenewal[]> {
  const db = await getDb();
  return db.select<PendingRenewal[]>(
    `SELECT r.*, s.name AS name
     FROM subscription_renewals r
     JOIN subscriptions s ON s.id = r.subscription_id
     WHERE r.decision = 'pending'
     ORDER BY r.renewed_on ASC, s.name ASC`
  );
}

export async function decideRenewal(
  id: number,
  decision: "added" | "skipped",
  expenseId?: number
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE subscription_renewals SET decision = $1, expense_id = $2 WHERE id = $3",
    [decision, decision === "added" ? expenseId ?? null : null, id]
  );
}

/** Yearly cost per currency (null currency under ''); monthly x 12, cancelled excluded. */
export function yearlyTotal(
  subs: Pick<Subscription, "cost" | "currency" | "period" | "status">[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const s of subs) {
    if (s.status !== "active") continue;
    const key = s.currency ?? "";
    totals.set(key, (totals.get(key) ?? 0) + (s.period === "month" ? s.cost * 12 : s.cost));
  }
  return totals;
}
