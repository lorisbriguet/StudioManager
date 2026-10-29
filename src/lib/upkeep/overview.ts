import { dueState, effectiveDue } from "./schedule";
import { isLow } from "../../db/queries/consumables";
import { parseLocalDate, toLocalISO } from "../../utils/localDate";
import type { Consumable, Machine, Subscription, UpkeepItem } from "../../types/upkeep";

export interface DueRow {
  item: UpkeepItem;
  machine: Machine;
  due: string | null;
  state: ReturnType<typeof dueState>;
  /** Usage left before the next service; set once readings are available. */
  left?: number;
}

export interface EndingSoon {
  kind: "warranty" | "renewal";
  name: string;
  date: string;
}

export interface UpkeepOverview {
  due: DueRow[];
  lowStock: Consumable[];
  endingSoon: EndingSoon[];
  replacements: { machine: Machine; year: number }[];
  overdueCount: number;
}

function addDays(dateISO: string, n: number): string {
  const d = parseLocalDate(dateISO);
  return toLocalISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

export interface OverviewInput {
  items: UpkeepItem[];
  machines: Machine[];
  consumables: Consumable[];
  subscriptions: Subscription[];
  todayISO: string;
  soonDays: number;
  warrantyWindowDays: number;
  renewalWindowDays: number;
}

export function buildUpkeepOverview(input: OverviewInput): UpkeepOverview {
  const { items, machines, consumables, subscriptions, todayISO } = input;
  const byId = new Map(machines.map((m) => [m.id, m]));

  const due: DueRow[] = [];
  for (const item of items) {
    const machine = byId.get(item.machine_id);
    if (!machine || machine.status === "retired" || item.archived) continue;
    const state = dueState(item, todayISO, input.soonDays);
    if (state !== "overdue" && state !== "soon") continue;
    due.push({ item, machine, due: effectiveDue(item), state });
  }
  due.sort((a, b) => {
    if ((a.state === "overdue") !== (b.state === "overdue")) return a.state === "overdue" ? -1 : 1;
    return (a.due ?? "").localeCompare(b.due ?? "");
  });

  const warrantyEnd = addDays(todayISO, input.warrantyWindowDays);
  const renewalEnd = addDays(todayISO, input.renewalWindowDays);
  const endingSoon: EndingSoon[] = [];
  for (const m of machines) {
    if (m.status === "retired" || !m.warranty_until) continue;
    if (m.warranty_until >= todayISO && m.warranty_until <= warrantyEnd) {
      endingSoon.push({ kind: "warranty", name: m.name, date: m.warranty_until });
    }
  }
  for (const s of subscriptions) {
    if (s.status !== "active") continue;
    if (s.renews_on >= todayISO && s.renews_on <= renewalEnd) {
      endingSoon.push({ kind: "renewal", name: s.name, date: s.renews_on });
    }
  }
  endingSoon.sort((a, b) => a.date.localeCompare(b.date));

  const nextYear = parseLocalDate(todayISO).getFullYear() + 1;
  const replacements: { machine: Machine; year: number }[] = [];
  for (const m of machines) {
    if (m.status === "retired" || !m.purchase_date || !m.lifespan_years || m.lifespan_years <= 0) continue;
    const year = Number(m.purchase_date.slice(0, 4)) + Math.ceil(m.lifespan_years);
    if (year <= nextYear) replacements.push({ machine: m, year });
  }
  replacements.sort((a, b) => a.year - b.year);

  return {
    due,
    lowStock: consumables.filter(isLow),
    endingSoon,
    replacements,
    overdueCount: due.filter((r) => r.state === "overdue").length,
  };
}
