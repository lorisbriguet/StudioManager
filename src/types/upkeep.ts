export type ConnectionKind = "synology" | "bambu_cloud";
export type MachineStatus = "working" | "attention" | "broken" | "lent" | "retired";
export type IntervalUnit = "day" | "week" | "month" | "year";
export type RenewalDecision = "pending" | "added" | "skipped";
export type DiskHealth = "healthy" | "warning" | "failing";
export type UpkeepAlert = "default" | "none" | "day_9am" | "day_before" | "week_before";

export interface Connection {
  id: number;
  kind: ConnectionKind;
  label: string;
  host: string | null;
  port: number | null;
  region: string | null;
  account: string | null;
  cert_fingerprint: string | null;
  last_sync_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  failing_since: string | null;
  failing_notified: number;
  created_at: string;
  updated_at: string;
}

export interface Machine {
  id: number;
  name: string;
  kind: string;
  maker: string | null;
  model: string | null;
  serial: string | null;
  location: string | null;
  status: MachineStatus;
  lent_to: string | null;
  lent_until: string | null;
  purchase_date: string | null;
  supplier: string | null;
  price: number | null;
  currency: string | null;
  expense_id: number | null;
  warranty_until: string | null;
  warranty_notified_for: string | null;
  lifespan_years: number | null;
  photo_path: string | null;
  notes: string | null;
  template_key: string | null;
  connection_id: number | null;
  device_id: string | null;
  reading_baseline: number | null;
  created_at: string;
  updated_at: string;
}

export interface MachineFile {
  id: number;
  machine_id: number;
  label: string;
  kind: "file" | "link";
  path_or_url: string;
}

export interface UpkeepItem {
  id: number;
  machine_id: number;
  title: string;
  notes: string | null;
  schedule: "interval" | "usage";
  interval_n: number | null;
  interval_unit: IntervalUnit | null;
  anchor_day: number | null;
  usage_metric: "print_hours" | null;
  usage_every: number | null;
  last_done_on: string | null;
  last_done_reading: number | null;
  next_due_on: string | null;
  snooze_until: string | null;
  in_calendar: number;
  alert: UpkeepAlert;
  calendar_event_id: string | null;
  calendar_event_date: string | null;
  overdue_notified_for: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface ServiceLogEntry {
  id: number;
  machine_id: number;
  upkeep_item_id: number | null;
  done_on: string;
  description: string;
  cost: number | null;
  expense_id: number | null;
  reading: number | null;
  created_at: string;
}

export interface Consumable {
  id: number;
  name: string;
  machine_id: number | null;
  unit: string;
  stock: number;
  reorder_level: number;
  supplier: string | null;
  product_url: string | null;
  unit_price: number | null;
  currency: string | null;
  low_notified: number;
  created_at: string;
  updated_at: string;
}

export interface ConsumableUsage {
  id: number;
  consumable_id: number;
  project_id: number | null;
  used_on: string;
  amount: number;
  cost: number | null;
}

export interface Subscription {
  id: number;
  name: string;
  plan: string | null;
  vendor: string | null;
  url: string | null;
  renews_on: string;
  anchor_day: number;
  period: "month" | "year";
  cost: number;
  currency: string | null;
  status: "active" | "cancelled";
  in_calendar: number;
  alert: UpkeepAlert;
  calendar_event_id: string | null;
  coming_notified_for: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRenewal {
  id: number;
  subscription_id: number;
  renewed_on: string;
  amount: number;
  currency: string | null;
  decision: RenewalDecision;
  expense_id: number | null;
  notified: number;
}

export interface MachineReading {
  id: number;
  machine_id: number;
  metric: string;
  value: number;
  read_at: string;
}

export interface MachineDisk {
  id: number;
  machine_id: number;
  slot: string;
  model: string | null;
  serial: string;
  size_bytes: number | null;
  power_on_hours: number | null;
  health: DiskHealth;
  notified_health: string | null;
  bad_sectors: number | null;
  temperature: number | null;
  first_seen: string;
  last_read_at: string;
}

type MachineSystemFields = "id" | "created_at" | "updated_at" | "warranty_notified_for";

/** Editable machine fields; only the name is required, the DB supplies defaults. */
export type MachineInput = Pick<Machine, "name"> &
  Partial<Omit<Machine, MachineSystemFields | "name">>;

type UpkeepItemComputedFields =
  | "id"
  | "created_at"
  | "updated_at"
  | "next_due_on"
  | "calendar_event_id"
  | "calendar_event_date"
  | "overdue_notified_for"
  | "snooze_until"
  | "last_done_reading";

/**
 * Editable upkeep item fields. `last_done_on` may be given for an item that
 * was already serviced; otherwise `start_on` (default today) is the base date
 * of the first due date.
 */
export type UpkeepItemInput = Pick<UpkeepItem, "machine_id" | "title" | "schedule"> &
  Partial<Omit<UpkeepItem, UpkeepItemComputedFields | "machine_id" | "title" | "schedule">> & {
    start_on?: string;
  };

/** A template item created together with its machine (machine id not known yet). */
export type MachineTemplateItemInput = Omit<UpkeepItemInput, "machine_id">;
