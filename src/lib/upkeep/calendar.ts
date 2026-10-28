import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "../appleCalendar";
import { useAppStore } from "../../stores/app-store";
import { notifyError, getLabels } from "../notifyError";
import { effectiveDue, shouldMoveEvent } from "./schedule";
import { getMachine } from "../../db/queries/machines";
import { getUpkeepItem, getUpkeepItems, setItemCalendarEvent } from "../../db/queries/upkeepItems";
import { getSubscription, getSubscriptions, setSubscriptionCalendarEvent } from "../../db/queries/subscriptions";
import type { Machine, Subscription, UpkeepAlert, UpkeepItem } from "../../types/upkeep";

/**
 * Upkeep items and subscriptions in Apple Calendar: one all-day event per
 * item for its NEXT due date, with a display alarm, so the reminder fires even
 * when the app is closed. Every function here swallows calendar failures
 * (one notifyError) and returns the ids to persist, so a save never fails
 * because of the calendar.
 */

type ConcreteAlert = Exclude<UpkeepAlert, "default">;

/** Alarm offset in minutes from midnight of the event day; null = no alarm. */
export function alertMinutes(alert: UpkeepAlert, settingsDefault: ConcreteAlert): number | null {
  const resolved = alert === "default" ? settingsDefault : alert;
  switch (resolved) {
    case "day_9am":
      return 540; // 9:00 on the day
    case "day_before":
      return -900; // 9:00 the day before
    case "week_before":
      return -9540; // 9:00 seven days before
    default:
      return null;
  }
}

export interface SyncOptions {
  /** Recreate an existing event even when its date has not moved (title or alert changed). */
  force?: boolean;
}

type ItemEventIds = Pick<UpkeepItem, "calendar_event_id" | "calendar_event_date">;
type SubscriptionEventIds = Pick<Subscription, "calendar_event_id">;

const notifyFailure = (e: unknown) => notifyError(getLabels().calendar_sync_failed, e);

function resolveAlert(alert: UpkeepAlert): number | null {
  return alertMinutes(alert, useAppStore.getState().upkeepAlertDefault ?? "day_9am");
}

/** Delete an event by uid; true when there is nothing left to track. */
export async function removeUpkeepEvent(uid: string | null): Promise<boolean> {
  if (!uid) return true;
  try {
    await deleteCalendarEvent(uid);
    return true;
  } catch (e) {
    notifyFailure(e);
    return false;
  }
}

export async function syncItemEvent(
  item: UpkeepItem,
  machine: Machine,
  opts: SyncOptions = {}
): Promise<ItemEventIds> {
  const current: ItemEventIds = {
    calendar_event_id: item.calendar_event_id,
    calendar_event_date: item.calendar_event_date,
  };
  const due = effectiveDue(item);
  const wanted =
    useAppStore.getState().calendarSync &&
    !item.archived &&
    item.in_calendar !== 0 &&
    machine.status !== "retired" &&
    due !== null;

  if (!wanted || due === null) {
    const removed = await removeUpkeepEvent(item.calendar_event_id);
    return removed ? { calendar_event_id: null, calendar_event_date: null } : current;
  }

  if (
    item.calendar_event_id &&
    !opts.force &&
    !shouldMoveEvent(item.calendar_event_date, due, item.schedule)
  ) {
    return current;
  }

  const event = {
    title: `${item.title} · ${machine.name}`,
    date: due,
    alertMinutes: resolveAlert(item.alert),
  };
  try {
    const uid = item.calendar_event_id
      ? await updateCalendarEvent(item.calendar_event_id, event)
      : await createCalendarEvent(event);
    return { calendar_event_id: uid, calendar_event_date: due };
  } catch (e) {
    notifyFailure(e);
    return current;
  }
}

/**
 * Renewal event on `renews_on`. Subscriptions don't store the event's date,
 * so callers pass `force` whenever renews_on, the name or the alert changed.
 */
export async function syncSubscriptionEvent(
  sub: Subscription,
  opts: SyncOptions = {}
): Promise<SubscriptionEventIds> {
  const current: SubscriptionEventIds = { calendar_event_id: sub.calendar_event_id };
  const wanted =
    useAppStore.getState().calendarSync && sub.status !== "cancelled" && sub.in_calendar !== 0;

  if (!wanted) {
    const removed = await removeUpkeepEvent(sub.calendar_event_id);
    return removed ? { calendar_event_id: null } : current;
  }
  if (sub.calendar_event_id && !opts.force) return current;

  const event = {
    title: `${sub.name} renews`,
    date: sub.renews_on,
    alertMinutes: resolveAlert(sub.alert),
  };
  try {
    const uid = sub.calendar_event_id
      ? await updateCalendarEvent(sub.calendar_event_id, event)
      : await createCalendarEvent(event);
    return { calendar_event_id: uid };
  } catch (e) {
    notifyFailure(e);
    return current;
  }
}

// ── Orchestration used by the upkeep hooks ──────────────────────────────────

// One chain per item/subscription: two quick edits of the same row run their
// calendar work one after the other, so the second sees the first's event id
// instead of creating a duplicate event.
const chains = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, work: () => Promise<T>): Promise<T | undefined> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next: Promise<T | undefined> = prev
    .then(work)
    .catch((e) => {
      notifyFailure(e);
      return undefined;
    })
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  chains.set(key, next);
  return next;
}

/** Sync one item; true when it ends up on a new event (created or moved). */
function syncItemById(id: number, opts: SyncOptions): Promise<boolean | undefined> {
  return serialize(`item:${id}`, async () => {
    const item = await getUpkeepItem(id);
    if (!item) return false;
    const machine = await getMachine(item.machine_id);
    if (!machine) return false;
    const ids = await syncItemEvent(item, machine, opts);
    if (
      ids.calendar_event_id === item.calendar_event_id &&
      ids.calendar_event_date === item.calendar_event_date
    ) {
      return false;
    }
    await setItemCalendarEvent(id, ids.calendar_event_id, ids.calendar_event_date);
    return ids.calendar_event_id !== null && ids.calendar_event_id !== item.calendar_event_id;
  });
}

function syncSubscriptionById(id: number, opts: SyncOptions): Promise<boolean | undefined> {
  return serialize(`sub:${id}`, async () => {
    const sub = await getSubscription(id);
    if (!sub) return false;
    const ids = await syncSubscriptionEvent(sub, opts);
    if (ids.calendar_event_id === sub.calendar_event_id) return false;
    await setSubscriptionCalendarEvent(id, ids.calendar_event_id);
    return ids.calendar_event_id !== null;
  });
}

/** Reload an item and its machine, sync its event and store the new ids. */
export async function syncItemCalendar(id: number, opts: SyncOptions = {}): Promise<void> {
  await syncItemById(id, opts);
}

/** Reload a subscription, sync its renewal event and store the new id. */
export async function syncSubscriptionCalendar(id: number, opts: SyncOptions = {}): Promise<void> {
  await syncSubscriptionById(id, opts);
}

/**
 * Re-sync every item of a machine (created, renamed, retired or back in
 * service). One at a time: each sync is an osascript run against Calendar.
 */
export async function syncMachineItemsCalendar(machineId: number, opts: SyncOptions = {}): Promise<void> {
  try {
    const items = await getUpkeepItems(machineId);
    for (const i of items) await syncItemById(i.id, opts);
  } catch (e) {
    notifyFailure(e);
  }
}

/** Delete the events of item rows being deleted (rows read before the delete). */
export async function removeItemEvents(items: UpkeepItem[]): Promise<void> {
  for (const i of items) {
    if (!i.calendar_event_id) continue;
    await serialize(`item:${i.id}`, () => removeUpkeepEvent(i.calendar_event_id));
  }
}

/** Delete the renewal event of a subscription row being deleted. */
export async function removeSubscriptionEvent(sub: Subscription): Promise<void> {
  if (!sub.calendar_event_id) return;
  await serialize(`sub:${sub.id}`, () => removeUpkeepEvent(sub.calendar_event_id));
}

/**
 * Turning calendar sync on: give every item and subscription that should be
 * in the calendar its event. Returns how many events were created.
 */
export async function syncAllUpkeepEvents(): Promise<number> {
  let count = 0;
  try {
    for (const i of await getUpkeepItems()) {
      if (await syncItemById(i.id, {})) count++;
    }
    for (const s of await getSubscriptions()) {
      if (await syncSubscriptionById(s.id, {})) count++;
    }
  } catch (e) {
    notifyFailure(e);
  }
  return count;
}
