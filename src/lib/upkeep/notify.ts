import type { QueryClient } from "@tanstack/react-query";
import { getDb, TransactionBatch } from "../../db";
import { getActiveUpkeepItems } from "../../db/queries/upkeepItems";
import { getMachines } from "../../db/queries/machines";
import { getConsumables, isLow } from "../../db/queries/consumables";
import { applyRenewals, getPendingRenewals, getSubscriptions } from "../../db/queries/subscriptions";
import type { PendingRenewal } from "../../db/queries/subscriptions";
import { sendNativeNotification } from "../nativeNotification";
import { getLabels } from "../notifyError";
import { logWarn } from "../log";
import { useAppStore } from "../../stores/app-store";
import { useOrgStore } from "../../stores/org-store";
import { parseLocalDate } from "../../utils/localDate";
import { dueState, effectiveDue } from "./schedule";
import { syncSubscriptionCalendar } from "./calendar";
import type {
  Connection, Consumable, DiskHealth, Machine, MachineDisk, Subscription, UpkeepItem,
} from "../../types/upkeep";

export type NoticeCause =
  | "overdue" | "low_stock" | "disk" | "warranty" | "renewal_coming" | "renewal_happened" | "connection";

export interface PlannedNotice {
  cause: NoticeCause;
  refId: number;
  /** Stored in the cause's marker column so the same notice never repeats. */
  marker: string;
  title: string;
  message: string;
  link: string;
}

export interface PlanInput {
  items: UpkeepItem[];
  machines: Machine[];
  consumables: Consumable[];
  subs: Subscription[];
  pendingRenewals: PendingRenewal[];
  disks: MachineDisk[];
  connections: Connection[];
  todayISO: string;
  windows: { warrantyDays: number; renewalDays: number };
}

/** Days of failure before the connection notice (spec §7). */
const CONNECTION_FAILING_DAYS = 3;

/** More notices than this in one run: one summary banner instead of one each. */
const MAX_NATIVE_NOTICES = 3;

const HEALTH_RANK: Record<string, number> = { healthy: 0, warning: 1, failing: 2 };

function daysUntil(fromISO: string, toISO: string): number {
  const a = parseLocalDate(fromISO);
  const b = parseLocalDate(toISO);
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000
  );
}

function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/**
 * Pure: which in-app notices are owed right now. Every notice carries the marker
 * that `markerStatement` stores, and a notice whose marker is already stored is
 * not planned, so a cause fires once (spec §7), never daily.
 */
export function planNotifications(input: PlanInput): PlannedNotice[] {
  const t = getLabels();
  const { todayISO, windows } = input;
  const out: PlannedNotice[] = [];
  const byId = new Map(input.machines.map((m) => [m.id, m]));
  const live = (id: number | null) => {
    const m = id == null ? undefined : byId.get(id);
    return m && m.status !== "retired" ? m : undefined;
  };

  for (const item of input.items) {
    const m = live(item.machine_id);
    if (!m || item.archived) continue;
    if (dueState(item, todayISO, 0) !== "overdue") continue;
    const due = effectiveDue(item);
    if (!due || item.overdue_notified_for === due) continue;
    out.push({
      cause: "overdue", refId: item.id, marker: due,
      title: t.notice_overdue_title,
      message: fill(t.notice_overdue_msg, { title: item.title, machine: m.name, date: due }),
      link: `/upkeep/machines/${m.id}`,
    });
  }

  for (const c of input.consumables) {
    if (!isLow(c) || c.low_notified) continue;
    out.push({
      cause: "low_stock", refId: c.id, marker: "1",
      title: t.notice_low_title,
      message: fill(t.notice_low_msg, { name: c.name, stock: c.stock, unit: c.unit, level: c.reorder_level }),
      link: "/upkeep?tab=consumables",
    });
  }

  for (const d of input.disks) {
    const m = live(d.machine_id);
    if (!m) continue;
    const rank = HEALTH_RANK[d.health] ?? 0;
    if (rank <= (HEALTH_RANK[d.notified_health ?? "healthy"] ?? 0)) continue;
    const health: DiskHealth = d.health;
    out.push({
      cause: "disk", refId: d.id, marker: health,
      title: t.notice_disk_title,
      message: fill(t.notice_disk_msg, {
        slot: d.slot, machine: m.name,
        health: health === "failing" ? t.notice_health_failing : t.notice_health_warning,
      }),
      link: `/upkeep/machines/${m.id}`,
    });
  }

  for (const m of input.machines) {
    if (m.status === "retired" || !m.warranty_until) continue;
    const left = daysUntil(todayISO, m.warranty_until);
    if (left < 0 || left > windows.warrantyDays) continue;
    if (m.warranty_notified_for === m.warranty_until) continue;
    out.push({
      cause: "warranty", refId: m.id, marker: m.warranty_until,
      title: t.notice_warranty_title,
      message: fill(t.notice_warranty_msg, { machine: m.name, date: m.warranty_until }),
      link: `/upkeep/machines/${m.id}`,
    });
  }

  for (const s of input.subs) {
    if (s.status !== "active") continue;
    const left = daysUntil(todayISO, s.renews_on);
    if (left < 0 || left > windows.renewalDays) continue;
    if (s.coming_notified_for === s.renews_on) continue;
    out.push({
      cause: "renewal_coming", refId: s.id, marker: s.renews_on,
      title: t.notice_renewal_coming_title,
      message: fill(t.notice_renewal_coming_msg, { name: s.name, date: s.renews_on }),
      link: "/upkeep?tab=subscriptions",
    });
  }

  for (const r of input.pendingRenewals) {
    if (r.notified) continue;
    out.push({
      cause: "renewal_happened", refId: r.id, marker: "1",
      title: t.notice_renewal_happened_title,
      message: fill(t.notice_renewal_happened_msg, {
        name: r.name, date: r.renewed_on,
        amount: `${r.amount.toFixed(2)}${r.currency ? ` ${r.currency}` : ""}`,
      }),
      link: "/upkeep?tab=subscriptions",
    });
  }

  for (const c of input.connections) {
    if (!c.failing_since || c.failing_notified) continue;
    if (daysUntil(c.failing_since, todayISO) < CONNECTION_FAILING_DAYS) continue;
    out.push({
      cause: "connection", refId: c.id, marker: "1",
      title: t.notice_connection_title,
      message: fill(t.notice_connection_msg, { label: c.label, date: c.failing_since }),
      link: "/upkeep",
    });
  }

  return out;
}

/** The UPDATE that records a notice as sent. */
export function markerStatement(n: PlannedNotice): { sql: string; params: unknown[] } {
  switch (n.cause) {
    case "overdue":
      return { sql: "UPDATE upkeep_items SET overdue_notified_for = $1 WHERE id = $2", params: [n.marker, n.refId] };
    case "low_stock":
      return { sql: "UPDATE consumables SET low_notified = 1 WHERE id = $1", params: [n.refId] };
    case "disk":
      return { sql: "UPDATE machine_disks SET notified_health = $1 WHERE id = $2", params: [n.marker, n.refId] };
    case "warranty":
      return { sql: "UPDATE machines SET warranty_notified_for = $1 WHERE id = $2", params: [n.marker, n.refId] };
    case "renewal_coming":
      return { sql: "UPDATE subscriptions SET coming_notified_for = $1 WHERE id = $2", params: [n.marker, n.refId] };
    case "renewal_happened":
      return { sql: "UPDATE subscription_renewals SET notified = 1 WHERE id = $1", params: [n.refId] };
    case "connection":
      return { sql: "UPDATE connections SET failing_notified = 1 WHERE id = $1", params: [n.refId] };
  }
}

/**
 * Roll due subscription renewals, plan the notices that are owed and write them.
 * Returns the number of notices created, or null when an organisation switch
 * (or a switch in progress) stopped the run, so the caller retries it once
 * the switch is over. Does nothing (0) in test and presentation modes. Every DB call is preceded by an organisation check (which also fails
 * while a switch is in progress), and every write carries the expected
 * organisation so Rust refuses it if the active one changed in between.
 * Each notice and its marker go in one batch: both land or neither does.
 */
export async function runUpkeepCheck(qc: QueryClient, todayISO: string): Promise<number | null> {
  const app = useAppStore.getState();
  if (app.testMode || app.presentationMode) return 0;
  const org = useOrgStore.getState().activeId;
  const sameOrg = () => {
    const s = useOrgStore.getState();
    return !s.switching && s.activeId === org;
  };
  if (!sameOrg()) return null;

  // Renewals first: a rolled subscription can owe a "renewal happened" notice.
  const allSubs = await getSubscriptions();
  let rolled = false;
  for (const sub of allSubs) {
    if (sub.status !== "active") continue;
    if (!sameOrg()) return null;
    try {
      const n = await applyRenewals(sub, todayISO, org);
      if (n > 0) {
        rolled = true;
        if (!sameOrg()) return null;
        await syncSubscriptionCalendar(sub.id, { force: true });
      }
    } catch (e) {
      // One bad subscription must not block every other reminder.
      logWarn(`Upkeep check: subscription ${sub.id} skipped:`, e);
    }
  }

  if (!sameOrg()) return null;
  const subs = rolled ? await getSubscriptions() : allSubs;
  if (!sameOrg()) return null;
  const items = await getActiveUpkeepItems();
  if (!sameOrg()) return null;
  const machines = await getMachines();
  if (!sameOrg()) return null;
  const consumables = await getConsumables();
  if (!sameOrg()) return null;
  const pendingRenewals = await getPendingRenewals();
  if (!sameOrg()) return null;
  const db = await getDb();
  const disks = await db.select<MachineDisk[]>(
    `SELECT d.* FROM machine_disks d JOIN machines m ON m.id = d.machine_id
     WHERE m.status != 'retired'`
  );
  if (!sameOrg()) return null;
  const connections = await db.select<Connection[]>(
    "SELECT * FROM connections WHERE failing_since IS NOT NULL AND failing_notified = 0"
  );
  if (!sameOrg()) return null;

  const notices = planNotifications({
    items, machines, consumables, subs, pendingRenewals, disks, connections, todayISO,
    windows: { warrantyDays: app.warrantyWindowDays, renewalDays: app.renewalWindowDays },
  });

  const written: PlannedNotice[] = [];
  for (const n of notices) {
    if (!sameOrg()) break;
    const batch = new TransactionBatch(org);
    batch.add(
      "INSERT INTO notifications (type, title, message, read, link) VALUES ($1, $2, $3, 0, $4)",
      [n.cause === "disk" || n.cause === "connection" ? "error" : "warning", n.title, n.message, n.link]
    );
    const s = markerStatement(n);
    batch.add(s.sql, s.params);
    try {
      await batch.commit();
      written.push(n);
    } catch (e) {
      // Neither the notice nor its marker was written: the next run plans it again.
      logWarn(`Upkeep check: ${n.cause} notice ${n.refId} not written:`, e);
    }
  }

  if (rolled || written.length > 0) {
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["upkeep-items"] });
    qc.invalidateQueries({ queryKey: ["subscriptions"] });
    qc.invalidateQueries({ queryKey: ["machines"] });
    qc.invalidateQueries({ queryKey: ["consumables"] });
  }
  if (written.length > MAX_NATIVE_NOTICES) {
    const t = getLabels();
    sendNativeNotification(
      t.notice_summary_title,
      fill(t.notice_summary_msg, { count: written.length })
    );
  } else {
    for (const n of written) sendNativeNotification(n.title, n.message);
  }
  return written.length;
}
