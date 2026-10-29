import { invoke } from "@tauri-apps/api/core";
import type { QueryClient } from "@tanstack/react-query";
import { TransactionBatch } from "../../db";
import {
  currentReading,
  firstReadingSince,
  getConnections,
  getMachineReadings,
  recordSync,
  storeReadings,
  type DeviceInfo,
  type DeviceReading,
  type SyncResult,
} from "../../db/queries/connections";
import { getMachines } from "../../db/queries/machines";
import { getUpkeepItem, getUpkeepItems, markUpkeepDone } from "../../db/queries/upkeepItems";
import { useAppStore } from "../../stores/app-store";
import { useOrgStore } from "../../stores/org-store";
import { parseLocalDate, toLocalISO, todayLocalISO } from "../../utils/localDate";
import { logWarn } from "../log";
import { formatDisplayDateTime } from "../../utils/formatDate";
import { syncItemCalendar } from "./calendar";
import { dailyUse, forecastUsageDue, usageLeft } from "./schedule";
import { parseBambuError } from "./bambu";
import { parseSynologyError } from "./synology";
import type { Connection, Machine, UpkeepItem } from "../../types/upkeep";

/** Sync on start, then every 6 hours while the app is open (spec §8). */
export const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

const DEFAULT_METRIC = "print_hours";

/**
 * What Rust gets to reach the device. Never the secret: Rust reads it from the
 * Keychain. These come from the (backed-up, editable) SQLite row, so Rust
 * sends a Synology password only when host, port and pin match the ones
 * stored with it (`reenter_password` otherwise).
 */
export function connectionConfig(c: Connection): Record<string, unknown> {
  return {
    host: c.host,
    port: c.port,
    region: c.region,
    account: c.account,
    cert_fingerprint: c.cert_fingerprint,
    // Bambu counts print hours from the connection's creation (UTC, SQLite text).
    created_at: c.created_at,
  };
}

type ErrorLabels = {
  upkeep_err_untrusted_cert: string;
  upkeep_err_otp: string;
  upkeep_err_bambu_code: string;
  upkeep_err_bambu_signin: string;
  upkeep_err_bambu_password: string;
  upkeep_err_bambu_tfa: string;
  upkeep_err_bambu_history: string;
  upkeep_err_syno_reenter: string;
};

/**
 * A connector error as the user reads it: the codes that need the user
 * (`untrusted_cert:…`, `otp_required`, `otp_invalid`, `reenter_password`, Bambu's `code_required`,
 * `code_invalid`, `token_expired`, `password_invalid`, `tfa_unsupported`,
 * `history_too_long`) become a translated pointer to Reconnect;
 * other (already redacted) messages pass through.
 */
export function connectionErrorText(e: unknown, t: ErrorLabels): string {
  const b = parseBambuError(e);
  if (b.kind === "code") return t.upkeep_err_bambu_code;
  if (b.kind === "signin") return t.upkeep_err_bambu_signin;
  if (b.kind === "password") return t.upkeep_err_bambu_password;
  if (b.kind === "tfa") return t.upkeep_err_bambu_tfa;
  if (b.kind === "history") return t.upkeep_err_bambu_history;
  const r = parseSynologyError(e);
  if (r.kind === "cert") return t.upkeep_err_untrusted_cert;
  if (r.kind === "otp") return t.upkeep_err_otp;
  if (r.kind === "password") return t.upkeep_err_syno_reenter;
  return r.message;
}

/** "Last sync <date>", plus the (already redacted) error of a failing connection. */
export function connectionStatusText(
  c: Pick<Connection, "last_sync_at" | "last_error">,
  t: { upkeep_last_sync: string; upkeep_never_synced: string } & ErrorLabels
): string {
  const sync = c.last_sync_at
    ? t.upkeep_last_sync.replace("{date}", formatDisplayDateTime(c.last_sync_at))
    : t.upkeep_never_synced;
  return c.last_error ? `${sync} · ${connectionErrorText(c.last_error, t)}` : sync;
}

/** Store a connection's secret in the Keychain (`<org>:<id>`). */
export async function saveConnectionSecret(id: number, secret: string): Promise<void> {
  const org = useOrgStore.getState().activeId;
  await invoke("connection_save_secret", { org, id, secret });
}

/**
 * Devices the connection can see, for linking a machine. Errors come back
 * redacted. `recheckCert` (Reconnect): the pinned certificate is set aside for
 * this call, so the one the NAS shows now is reported and confirmed again.
 */
export async function testConnection(c: Connection, opts: { recheckCert?: boolean } = {}): Promise<DeviceInfo[]> {
  const org = useOrgStore.getState().activeId;
  const config = opts.recheckCert ? { ...connectionConfig(c), recheck_cert: true } : connectionConfig(c);
  return invoke<DeviceInfo[]>("connection_test", { org, id: c.id, kind: c.kind, config });
}

/** Local `YYYY-MM-DD HH:MM:SS`: sorts as text and starts with the local date. */
export function localDateTime(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${toLocalISO(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function daysBefore(todayISO: string, n: number): string {
  const d = parseLocalDate(todayISO);
  return toLocalISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));
}

/**
 * Re-forecast a usage item from stored readings (spec §7): left = every −
 * (current − reading when last done), date = today + left ÷ average daily use
 * over 30 days. Writes `next_due_on` when it changed and returns whether it
 * did. The caller syncs the Calendar event.
 *
 * An item whose usage ran out never moves forward: it keeps a date already
 * reached (so it stays overdue and its notice fires once) or comes back to
 * today, with or without a trend. A counter that went below the reading of
 * the last service (reset or replaced) keeps the date as it is. Only an item
 * with usage left and no trend loses its date. Done without a reading, the
 * first reading after the service counts as the reading at the service.
 */
export async function recomputeUsageForecast(
  item: UpkeepItem,
  todayISO: string,
  expectedOrg?: string
): Promise<boolean> {
  if (item.schedule !== "usage" || item.usage_every == null) return false;
  const metric = item.usage_metric ?? DEFAULT_METRIC;
  const current = await currentReading(item.machine_id, metric);
  let next: string | null = null;
  if (current != null) {
    let done = item.last_done_reading;
    if (done == null && item.last_done_on) {
      done = (await firstReadingSince(item.machine_id, metric, item.last_done_on)) ?? current;
    }
    if (done != null && current < done) return false;
    const left = usageLeft(item.usage_every, current, done);
    if (left <= 0) {
      next = item.next_due_on && item.next_due_on <= todayISO ? item.next_due_on : todayISO;
    } else {
      const readings = await getMachineReadings(item.machine_id, metric, daysBefore(todayISO, 30));
      next = forecastUsageDue(left, dailyUse(readings, todayISO), todayISO);
    }
  }
  if (next === item.next_due_on) return false;
  const batch = new TransactionBatch(expectedOrg);
  batch.add(
    "UPDATE upkeep_items SET next_due_on = $1, updated_at = datetime('now') WHERE id = $2",
    [next, item.id]
  );
  await batch.commit();
  return true;
}

/**
 * Re-forecast every live usage item of a machine and sync their Calendar
 * events. `stillSameOrg` is checked before each DB call.
 */
async function recomputeMachine(
  machineId: number,
  todayISO: string,
  org: string,
  stillSameOrg: () => boolean
): Promise<boolean> {
  if (!stillSameOrg()) return false;
  const items = (await getUpkeepItems(machineId)).filter((i) => i.schedule === "usage" && !i.archived);
  for (const item of items) {
    if (!stillSameOrg()) return false;
    try {
      await recomputeUsageForecast(item, todayISO, org);
      if (!stillSameOrg()) return false;
      await syncItemCalendar(item.id);
    } catch (e) {
      logWarn(`Usage forecast of item ${item.id} failed:`, e);
    }
  }
  return true;
}

function orgGuard(): { org: string; same: () => boolean } {
  const org = useOrgStore.getState().activeId;
  return {
    org,
    same: () => {
      const s = useOrgStore.getState();
      return !s.switching && s.activeId === org;
    },
  };
}

/**
 * Mark an upkeep item done. A usage item without a given reading takes the
 * current one, and its next date is re-forecast right away from stored
 * readings (not left empty until the next sync). Syncs the Calendar event.
 */
export async function markDoneWithForecast(
  id: number,
  doneOnISO: string,
  reading: number | null,
  note?: string,
  todayISO: string = todayLocalISO()
): Promise<UpkeepItem> {
  const before = await getUpkeepItem(id);
  let r = reading;
  if (before?.schedule === "usage" && r == null) {
    r = await currentReading(before.machine_id, before.usage_metric ?? DEFAULT_METRIC);
  }
  const item = await markUpkeepDone(id, doneOnISO, r, note);
  if (item.schedule === "usage") {
    try {
      await recomputeUsageForecast(item, todayISO);
    } catch (e) {
      logWarn(`Usage forecast of item ${id} failed:`, e);
    }
  }
  void syncItemCalendar(id);
  return item;
}

/**
 * After a usage item is created or edited: forecast it from stored readings,
 * then sync its Calendar event. Interval items only get the event sync.
 */
export async function syncItemWithForecast(
  id: number,
  opts: { force?: boolean } = {},
  todayISO: string = todayLocalISO()
): Promise<void> {
  try {
    const item = await getUpkeepItem(id);
    if (item?.schedule === "usage") await recomputeUsageForecast(item, todayISO);
  } catch (e) {
    logWarn(`Usage forecast of item ${id} failed:`, e);
  }
  await syncItemCalendar(id, opts);
}

/**
 * A reading typed in by the user (machine without a connection). Stored net
 * of the machine's baseline so `currentReading` returns what was typed, then
 * the machine's usage items are re-forecast.
 */
export async function recordManualReading(
  machine: Machine,
  value: number,
  todayISO: string = todayLocalISO(),
  metric: string = DEFAULT_METRIC
): Promise<void> {
  const { org, same } = orgGuard();
  await storeReadings(
    machine,
    { device_id: "", model: null, metrics: [[metric, value - (machine.reading_baseline ?? 0)]], disks: [] },
    localDateTime(),
    org
  );
  await recomputeMachine(machine.id, todayISO, org, same);
}

/**
 * A device's reading as one linked machine stores it. Bambu sends its finished
 * prints rather than a total: the machine's `print_hours` is the sum of those
 * that started at or after its `linked_at`, so prints already in the counter
 * typed as baseline at linking are never counted twice. A machine linked
 * before link times were kept counts every print Rust sent (since the
 * connection was made). Other devices pass through.
 */
export function readingForMachine(device: DeviceReading, machine: Pick<Machine, "linked_at">): DeviceReading {
  if (!device.print_tasks) return device;
  const from = machine.linked_at ? Date.parse(machine.linked_at) : Number.NEGATIVE_INFINITY;
  const hours = device.print_tasks
    .filter(([start]) => Date.parse(start) >= from)
    .reduce((sum, [, h]) => sum + h, 0);
  return {
    ...device,
    metrics: [...device.metrics.filter(([m]) => m !== DEFAULT_METRIC), [DEFAULT_METRIC, hours]],
  };
}

/** The sync pass in progress, if any. */
let inFlight: Promise<void> | null = null;

export interface SyncOptions {
  /** Sync even when the last sync is under 6 hours old ("Sync now"). */
  force?: boolean;
  /** Only this connection. */
  connectionId?: number;
  todayISO?: string;
}

/**
 * Sync the open organisation's connections: store readings on the machines
 * linked to each device, record success or failure, re-forecast usage items
 * and move their Calendar events. Never in test or presentation mode. The
 * active org is captured first; every DB call is preceded by a check, every
 * write carries it, and a result that arrives after a switch is dropped.
 */
export async function runConnectionSyncs(qc: QueryClient, opts: SyncOptions = {}): Promise<void> {
  const app = useAppStore.getState();
  if (app.testMode || app.presentationMode) return;
  // One pass at a time. A background pass that finds one running just skips;
  // "Sync now" (forced) waits for it, then runs its own forced pass.
  while (inFlight) {
    if (!opts.force) return;
    await inFlight.catch(() => {});
  }
  const pass = syncPass(qc, opts);
  inFlight = pass;
  try {
    await pass;
  } finally {
    if (inFlight === pass) inFlight = null;
  }
}

async function syncPass(qc: QueryClient, opts: SyncOptions): Promise<void> {
  const { org, same } = orgGuard();
  if (!same()) return;
  const todayISO = opts.todayISO ?? todayLocalISO();
  const now = Date.now();
  const due = (await getConnections()).filter((c) => {
    if (opts.connectionId != null && c.id !== opts.connectionId) return false;
    if (opts.force || !c.last_sync_at) return true;
    const last = Date.parse(c.last_sync_at);
    return !Number.isFinite(last) || now - last >= SYNC_INTERVAL_MS;
  });
  if (due.length === 0) return;
  if (!same()) return;
  const machines = await getMachines();
  const touched = new Set<number>();
  let wrote = false;

  /** Record a failure so it shows on the connection (errors from Rust are already redacted). */
  const fail = async (id: number, e: unknown) => {
    if (!same()) return;
    try {
      await recordSync(id, false, String(e), org);
      wrote = true;
    } catch (w) {
      logWarn(`Connection ${id}: failure not recorded:`, w);
    }
  };

  for (const c of due) {
    if (!same()) return;
    let result: SyncResult;
    try {
      result = await invoke<SyncResult>("connection_sync", {
        org, id: c.id, kind: c.kind, config: connectionConfig(c),
      });
    } catch (e) {
      await fail(c.id, e);
      continue;
    }
    if (!same()) return;
    const readAt = localDateTime();
    try {
      for (const m of machines) {
        if (m.connection_id !== c.id || !m.device_id) continue;
        const device = result.devices.find((d) => d.device_id === m.device_id);
        if (!device) continue;
        if (!same()) return;
        await storeReadings(m, readingForMachine(device, m), readAt, org);
        touched.add(m.id);
      }
      if (!same()) return;
      await recordSync(c.id, true, undefined, org);
      wrote = true;
    } catch (e) {
      logWarn(`Connection ${c.id}: readings not stored:`, e);
      await fail(c.id, e);
    }
  }

  for (const id of touched) {
    if (!(await recomputeMachine(id, todayISO, org, same))) return;
  }

  if (wrote && same()) {
    for (const key of ["connections", "machines", "upkeep-items", "machine-readings", "machine-disks"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  }
}
