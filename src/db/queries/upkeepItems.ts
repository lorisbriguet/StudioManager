import { getDb, validateFields, TransactionBatch } from "../index";
import { nextIntervalDue } from "../../lib/upkeep/schedule";
import { addInterval } from "../../utils/recurringDates";
import { parseLocalDate, todayLocalISO } from "../../utils/localDate";
import type { UpkeepItem, UpkeepItemInput, MachineTemplateItemInput } from "../../types/upkeep";

const ITEM_COLUMNS = [
  "title",
  "notes",
  "schedule",
  "interval_n",
  "interval_unit",
  "anchor_day",
  "usage_metric",
  "usage_every",
  "last_done_on",
  "in_calendar",
  "alert",
  "archived",
] as const;

/**
 * Normalise a new item: for interval items derive `anchor_day` and the first
 * `next_due_on` from the last service date, else from `start_on` (default
 * today). Usage items start without a due date; it is forecast from readings.
 */
function prepareNewItem(data: MachineTemplateItemInput): {
  values: Record<(typeof ITEM_COLUMNS)[number], unknown>;
  next_due_on: string | null;
} {
  let anchor = data.anchor_day ?? null;
  let next: string | null = null;
  if (data.schedule === "interval") {
    const base = data.last_done_on ?? data.start_on ?? todayLocalISO();
    anchor = anchor ?? parseLocalDate(base).getDate();
    next = nextIntervalDue(
      { interval_n: data.interval_n ?? 1, interval_unit: data.interval_unit ?? "month", anchor_day: anchor },
      base
    );
  }
  return {
    values: {
      title: data.title,
      notes: data.notes ?? null,
      schedule: data.schedule,
      interval_n: data.interval_n ?? null,
      interval_unit: data.interval_unit ?? null,
      anchor_day: anchor,
      usage_metric: data.usage_metric ?? null,
      usage_every: data.usage_every ?? null,
      last_done_on: data.last_done_on ?? null,
      in_calendar: data.in_calendar ?? 1,
      alert: data.alert ?? "default",
      archived: data.archived ?? 0,
    },
    next_due_on: next,
  };
}

/**
 * INSERT statement for a new upkeep item. `machineId` is either a number
 * (bound parameter) or the `$LAST_INSERT_ID` placeholder of a batch.
 */
export function buildUpkeepItemInsert(
  data: MachineTemplateItemInput,
  machineId: number | "$LAST_INSERT_ID"
): { sql: string; params: unknown[] } {
  const { values, next_due_on } = prepareNewItem(data);
  const cols = [...ITEM_COLUMNS, "next_due_on"];
  const params: unknown[] = [...ITEM_COLUMNS.map((c) => values[c]), next_due_on];
  let machineExpr: string;
  if (machineId === "$LAST_INSERT_ID") {
    machineExpr = "$LAST_INSERT_ID";
  } else {
    params.push(machineId);
    machineExpr = `$${params.length}`;
  }
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  return {
    sql: `INSERT INTO upkeep_items (${cols.join(", ")}, machine_id) VALUES (${placeholders}, ${machineExpr})`,
    params,
  };
}

export async function getUpkeepItems(machineId?: number): Promise<UpkeepItem[]> {
  const db = await getDb();
  if (machineId !== undefined) {
    return db.select<UpkeepItem[]>(
      "SELECT * FROM upkeep_items WHERE machine_id = $1 ORDER BY archived ASC, next_due_on IS NULL, next_due_on ASC, title ASC",
      [machineId]
    );
  }
  return db.select<UpkeepItem[]>(
    "SELECT * FROM upkeep_items ORDER BY archived ASC, next_due_on IS NULL, next_due_on ASC, title ASC"
  );
}

/** Items that still need attention: not archived and the machine is not retired. */
export async function getActiveUpkeepItems(): Promise<UpkeepItem[]> {
  const db = await getDb();
  return db.select<UpkeepItem[]>(
    `SELECT u.* FROM upkeep_items u
     JOIN machines m ON m.id = u.machine_id
     WHERE u.archived = 0 AND m.status != 'retired'
     ORDER BY u.next_due_on IS NULL, u.next_due_on ASC, u.title ASC`
  );
}

export async function getUpkeepItem(id: number): Promise<UpkeepItem | null> {
  const db = await getDb();
  const rows = await db.select<UpkeepItem[]>("SELECT * FROM upkeep_items WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function createUpkeepItem(data: UpkeepItemInput): Promise<number> {
  const db = await getDb();
  const { machine_id, ...rest } = data;
  const stmt = buildUpkeepItemInsert(rest, machine_id);
  const result = await db.execute(stmt.sql, stmt.params);
  return result.lastInsertId ?? 0;
}

const UPDATABLE = new Set<string>([...ITEM_COLUMNS, "machine_id"]);

const SCHEDULE_FIELDS = ["schedule", "interval_n", "interval_unit", "anchor_day", "last_done_on"] as const;

/**
 * Where a never-done interval item's current due date was counted from: one
 * interval before it. Null when it has no interval due date to go back from.
 */
function intervalStart(item: UpkeepItem): string | null {
  if (item.schedule !== "interval" || !item.next_due_on) return null;
  return addInterval(
    item.next_due_on,
    -(item.interval_n ?? 1),
    item.interval_unit ?? "month",
    item.anchor_day ?? parseLocalDate(item.next_due_on).getDate()
  );
}

/**
 * Update editable fields. The next due date is recomputed only when a
 * schedule value really differs from the stored row (an edit that resends
 * the same values keeps it). An interval item counts from its last service;
 * a never-done one from where its current due date was counted (one old
 * interval back), so an edit never restarts it from today.
 */
export async function updateUpkeepItem(
  id: number,
  data: Partial<UpkeepItemInput>
): Promise<void> {
  const { start_on, ...rest } = data;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined && UPDATABLE.has(k)) patch[k] = v;
  }
  const mayChange = start_on !== undefined || SCHEDULE_FIELDS.some((k) => k in patch);
  const current = mayChange ? await getUpkeepItem(id) : null;
  const scheduleChanged =
    current !== null &&
    (start_on !== undefined ||
      SCHEDULE_FIELDS.some((k) => k in patch && patch[k] !== current[k]));
  if (current && scheduleChanged) {
    const merged = { ...current, ...patch } as UpkeepItem;
    if (merged.schedule === "interval") {
      const base = merged.last_done_on ?? start_on ?? intervalStart(current) ?? todayLocalISO();
      const anchor = merged.anchor_day ?? parseLocalDate(base).getDate();
      if (merged.anchor_day == null) patch.anchor_day = anchor;
      patch.next_due_on = nextIntervalDue({ ...merged, anchor_day: anchor }, base);
    } else {
      patch.next_due_on = null;
    }
  }
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  validateFields(fields);
  const db = await getDb();
  const sets = fields.map((f, i) => `${f} = $${i + 1}`);
  sets.push("updated_at = datetime('now')");
  await db.execute(
    `UPDATE upkeep_items SET ${sets.join(", ")} WHERE id = $${fields.length + 1}`,
    [...fields.map((f) => patch[f]), id]
  );
}

export async function archiveUpkeepItem(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE upkeep_items SET archived = 1, updated_at = datetime('now') WHERE id = $1",
    [id]
  );
}

export async function deleteUpkeepItem(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM upkeep_items WHERE id = $1", [id]);
}

/**
 * Record a service: writes the service log, sets last_done_*, recomputes the
 * next due date (interval items), clears snooze and overdue notification.
 * Usage items get `next_due_on = NULL` until readings re-forecast it.
 */
export async function markUpkeepDone(
  id: number,
  doneOnISO: string,
  reading: number | null,
  note?: string
): Promise<UpkeepItem> {
  const item = await getUpkeepItem(id);
  if (!item) throw new Error(`Upkeep item ${id} not found`);

  const batch = new TransactionBatch();
  batch.add(
    `INSERT INTO service_log (machine_id, upkeep_item_id, done_on, description, reading)
     VALUES ($1, $2, $3, $4, $5)`,
    [item.machine_id, id, doneOnISO, note?.trim() ? note.trim() : item.title, reading]
  );
  if (item.schedule === "interval") {
    const next = nextIntervalDue(item, doneOnISO);
    batch.add(
      `UPDATE upkeep_items SET last_done_on = $1, last_done_reading = $2, next_due_on = $3,
       snooze_until = NULL, overdue_notified_for = NULL, updated_at = datetime('now') WHERE id = $4`,
      [doneOnISO, reading, next, id]
    );
  } else {
    batch.add(
      `UPDATE upkeep_items SET last_done_on = $1, last_done_reading = $2, next_due_on = NULL,
       snooze_until = NULL, overdue_notified_for = NULL, updated_at = datetime('now') WHERE id = $3`,
      [doneOnISO, reading, id]
    );
  }
  await batch.commit();
  return (await getUpkeepItem(id)) ?? item;
}

/**
 * Remember the Apple Calendar event of an item. Bookkeeping only: does not
 * touch updated_at or any user-visible field. With `expectedOrg`, Rust
 * refuses the write if another organisation is open by then.
 */
export async function setItemCalendarEvent(
  id: number,
  eventId: string | null,
  eventDate: string | null,
  expectedOrg?: string
): Promise<void> {
  const batch = new TransactionBatch(expectedOrg);
  batch.add(
    "UPDATE upkeep_items SET calendar_event_id = $1, calendar_event_date = $2 WHERE id = $3",
    [eventId, eventDate, id]
  );
  await batch.commit();
}

/** Hide an item from alerts for 1, 3 or 7 days. */
export async function snoozeUpkeep(id: number, days: 1 | 3 | 7, todayISO: string): Promise<void> {
  const db = await getDb();
  const until = addInterval(todayISO, days, "day", parseLocalDate(todayISO).getDate());
  await db.execute(
    `UPDATE upkeep_items SET snooze_until = $1, overdue_notified_for = NULL,
     updated_at = datetime('now') WHERE id = $2`,
    [until, id]
  );
}
