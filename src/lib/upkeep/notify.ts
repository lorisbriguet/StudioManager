import type { QueryClient } from "@tanstack/react-query";
import { getDb, TransactionBatch } from "../../db";
import { getActiveUpkeepItems } from "../../db/queries/upkeepItems";
import { getMachines } from "../../db/queries/machines";
import { getConsumables, isLow } from "../../db/queries/consumables";
import { applyRenewals, getPendingRenewals, getSubscriptions } from "../../db/queries/subscriptions";
import type { PendingRenewal } from "../../db/queries/subscriptions";
import { createNotification } from "../../db/queries/notifications";
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
 * Roll due subscription renewals, plan the notices that are owed and write them
 * with their markers. Returns the number of notices created. Does nothing in
 * test and presentation modes, and writes nothing if the organisation changed
 * while it ran.
 */
export async function runUpkeepCheck(qc: QueryClient, todayISO: string): Promise<number> {
  const app = useAppStore.getState();
  if (app.testMode || app.presentationMode) return 0;
  const org = useOrgStore.getState().activeId;
  const sameOrg = () => useOrgStore.getState().activeId === org;

  // Renewals first: a rolled subscription can owe a "renewal happened" notice.
  const allSubs = await getSubscriptions();
  let rolled = false;
  for (const sub of allSubs) {
    if (sub.status !== "active") continue;
    if (!sameOrg()) return 0;
    const n = await applyRenewals(sub, todayISO);
    if (n > 0) {
      rolled = true;
      try {
        await syncSubscriptionCalendar(sub.id);
      } catch (e) {
        logWarn("Calendar sync after renewal failed:", e);
      }
    }
  }

  const db = await getDb();
  const [items, machines, consumables, subs, pendingRenewals, disks, connections] = await Promise.all([
    getActiveUpkeepItems(),
    getMachines(),
    getConsumables(),
    rolled ? getSubscriptions() : Promise.resolve(allSubs),
    getPendingRenewals(),
    db.select<MachineDisk[]>(
      `SELECT d.* FROM machine_disks d JOIN machines m ON m.id = d.machine_id
       WHERE m.status != 'retired'`
    ),
    db.select<Connection[]>(
      "SELECT * FROM connections WHERE failing_since IS NOT NULL AND failing_notified = 0"
    ),
  ]);
  if (!sameOrg()) return 0;

  const notices = planNotifications({
    items, machines, consumables, subs, pendingRenewals, disks, connections, todayISO,
    windows: { warrantyDays: app.warrantyWindowDays, renewalDays: app.renewalWindowDays },
  });

  const written: PlannedNotice[] = [];
  for (const n of notices) {
    if (!sameOrg()) break;
    await createNotification({
      type: n.cause === "disk" || n.cause === "connection" ? "error" : "warning",
      title: n.title, message: n.message, read: 0, link: n.link,
    });
    written.push(n);
  }

  if (written.length > 0 && sameOrg()) {
    const batch = new TransactionBatch();
    for (const n of written) {
      const s = markerStatement(n);
      batch.add(s.sql, s.params);
    }
    await batch.commit();
  }

  if (rolled || written.length > 0) {
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["upkeep-items"] });
    qc.invalidateQueries({ queryKey: ["subscriptions"] });
    qc.invalidateQueries({ queryKey: ["machines"] });
    qc.invalidateQueries({ queryKey: ["consumables"] });
  }
  for (const n of written) sendNativeNotification(n.title, n.message);
  return written.length;
}
