import { invoke } from "@tauri-apps/api/core";
import { getDb, validateFields, TransactionBatch } from "../index";
import { useOrgStore } from "../../stores/org-store";
import { todayLocalISO } from "../../utils/localDate";
import type {
  Connection,
  ConnectionKind,
  DiskHealth,
  Machine,
  MachineDisk,
  MachineReading,
} from "../../types/upkeep";

/** One device as read by a Rust connector (`connectors::DeviceReading`). */
export interface DiskReading {
  slot: string;
  model: string | null;
  serial: string;
  size_bytes: number | null;
  power_on_hours: number | null;
  health: string;
  bad_sectors: number | null;
  temperature: number | null;
}

export interface DeviceReading {
  device_id: string;
  model: string | null;
  metrics: [string, number][];
  disks: DiskReading[];
  /** Bambu: finished prints since the connection was made, `[start ISO UTC, hours]`. */
  print_tasks?: [string, number][] | null;
}

export interface SyncResult {
  devices: DeviceReading[];
}

/** A device a connection can see (`connectors::DeviceInfo`). */
export interface DeviceInfo {
  device_id: string;
  name: string | null;
  model: string | null;
}

/** Editable connection fields. The secret is never one of them: it goes to the Keychain. */
export interface ConnectionInput {
  kind: ConnectionKind;
  label: string;
  host?: string | null;
  port?: number | null;
  region?: string | null;
  account?: string | null;
  cert_fingerprint?: string | null;
}

const CONNECTION_COLUMNS = ["kind", "label", "host", "port", "region", "account", "cert_fingerprint"] as const;

export async function getConnections(): Promise<Connection[]> {
  const db = await getDb();
  return db.select<Connection[]>("SELECT * FROM connections ORDER BY label ASC");
}

export async function getConnection(id: number): Promise<Connection | null> {
  const db = await getDb();
  const rows = await db.select<Connection[]>("SELECT * FROM connections WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function createConnection(data: ConnectionInput): Promise<number> {
  const cols = CONNECTION_COLUMNS.filter((c) => data[c] !== undefined);
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO connections (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => data[c])
  );
  return result.lastInsertId ?? 0;
}

export async function updateConnection(id: number, data: Partial<ConnectionInput>): Promise<void> {
  const fields = Object.keys(data).filter(
    (k) => (CONNECTION_COLUMNS as readonly string[]).includes(k) && data[k as keyof ConnectionInput] !== undefined
  );
  if (fields.length === 0) return;
  validateFields(fields);
  const db = await getDb();
  const sets = fields.map((f, i) => `${f} = $${i + 1}`);
  sets.push("updated_at = datetime('now')");
  await db.execute(
    `UPDATE connections SET ${sets.join(", ")} WHERE id = $${fields.length + 1}`,
    [...fields.map((f) => data[f as keyof ConnectionInput]), id]
  );
}

/**
 * Remove a connection's Keychain secret, then the connection. Secret first: if
 * the Keychain refuses, the row stays (and can be removed again) instead of
 * leaving an orphaned secret nothing points to. Linked machines keep their
 * readings; `ON DELETE SET NULL` unlinks them.
 */
export async function deleteConnection(id: number): Promise<void> {
  const org = useOrgStore.getState().activeId;
  await invoke("connection_delete_secret", { org, id });
  await deleteConnectionRow(id);
}

/** The row only: for a connection whose secret was never stored. */
export async function deleteConnectionRow(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM connections WHERE id = $1", [id]);
}

/**
 * Record a sync outcome. A failure sets `failing_since` on the first failure
 * only (the "failing for 3 days" notice counts from it); a success clears it
 * and `failing_notified`, so a later run of failures notifies again.
 */
export async function recordSync(
  id: number,
  ok: boolean,
  error?: string,
  expectedOrg?: string
): Promise<void> {
  const now = new Date().toISOString();
  const batch = new TransactionBatch(expectedOrg);
  if (ok) {
    batch.add(
      `UPDATE connections SET last_sync_at = $1, last_ok_at = $1, last_error = NULL,
       failing_since = NULL, failing_notified = 0 WHERE id = $2`,
      [now, id]
    );
  } else {
    batch.add(
      `UPDATE connections SET last_sync_at = $1, last_error = $2,
       failing_since = COALESCE(failing_since, $3) WHERE id = $4`,
      [now, error ?? "", todayLocalISO(), id]
    );
  }
  await batch.commit();
}

const HEALTHS: DiskHealth[] = ["healthy", "warning", "failing"];
const rank = (expr: string) =>
  `(CASE ${expr} WHEN 'failing' THEN 2 WHEN 'warning' THEN 1 ELSE 0 END)`;

/**
 * Store one device's readings on its machine: one `machine_readings` row per
 * metric, and each disk upserted by serial. `first_seen` stays from the first
 * sync (drive age falls back to it). When a disk gets better, its notice
 * marker comes down with it, so getting worse again notifies again (spec §7).
 */
export async function storeReadings(
  machine: Pick<Machine, "id">,
  r: DeviceReading,
  readAtISO: string,
  expectedOrg?: string
): Promise<void> {
  const batch = new TransactionBatch(expectedOrg);
  for (const [metric, value] of r.metrics) {
    if (!Number.isFinite(value)) continue;
    batch.add(
      "INSERT INTO machine_readings (machine_id, metric, value, read_at) VALUES ($1, $2, $3, $4)",
      [machine.id, metric, value, readAtISO]
    );
  }
  for (const d of r.disks) {
    if (!d.serial) continue;
    const health: DiskHealth = (HEALTHS as string[]).includes(d.health) ? (d.health as DiskHealth) : "warning";
    batch.add(
      `INSERT INTO machine_disks (machine_id, slot, model, serial, size_bytes, power_on_hours, health,
         bad_sectors, temperature, first_seen, last_read_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (machine_id, serial) DO UPDATE SET
         slot = excluded.slot, model = excluded.model, size_bytes = excluded.size_bytes,
         power_on_hours = excluded.power_on_hours, health = excluded.health,
         bad_sectors = excluded.bad_sectors, temperature = excluded.temperature,
         notified_health = CASE
           WHEN notified_health IS NOT NULL AND ${rank("excluded.health")} < ${rank("notified_health")}
           THEN (CASE WHEN excluded.health = 'healthy' THEN NULL ELSE excluded.health END)
           ELSE notified_health END,
         last_read_at = excluded.last_read_at`,
      [machine.id, d.slot, d.model, d.serial, d.size_bytes, d.power_on_hours, health,
        d.bad_sectors, d.temperature, readAtISO]
    );
  }
  if (r.metrics.length === 0 && r.disks.length === 0) return;
  await batch.commit();
}

/** Latest stored value of a metric plus the machine's `reading_baseline`; null without readings. */
export async function currentReading(machineId: number, metric: string): Promise<number | null> {
  const db = await getDb();
  const rows = await db.select<{ value: number }[]>(
    `SELECT value FROM machine_readings WHERE machine_id = $1 AND metric = $2
     ORDER BY read_at DESC, id DESC LIMIT 1`,
    [machineId, metric]
  );
  if (rows.length === 0) return null;
  const m = await db.select<Pick<Machine, "reading_baseline">[]>(
    "SELECT reading_baseline FROM machines WHERE id = $1",
    [machineId]
  );
  return rows[0].value + (m[0]?.reading_baseline ?? 0);
}

/**
 * First reading of a metric on or after a date, plus the machine's baseline
 * (like `currentReading`); null when there is none.
 */
export async function firstReadingSince(
  machineId: number,
  metric: string,
  sinceISO: string
): Promise<number | null> {
  const db = await getDb();
  const rows = await db.select<{ value: number }[]>(
    `SELECT value FROM machine_readings WHERE machine_id = $1 AND metric = $2 AND read_at >= $3
     ORDER BY read_at ASC, id ASC LIMIT 1`,
    [machineId, metric, sinceISO]
  );
  if (rows.length === 0) return null;
  const m = await db.select<Pick<Machine, "reading_baseline">[]>(
    "SELECT reading_baseline FROM machines WHERE id = $1",
    [machineId]
  );
  return rows[0].value + (m[0]?.reading_baseline ?? 0);
}

/** Readings of a metric since a date (inclusive), oldest first. */
export async function getMachineReadings(
  machineId: number,
  metric: string,
  sinceISO: string
): Promise<Pick<MachineReading, "value" | "read_at">[]> {
  const db = await getDb();
  return db.select<Pick<MachineReading, "value" | "read_at">[]>(
    `SELECT value, read_at FROM machine_readings
     WHERE machine_id = $1 AND metric = $2 AND read_at >= $3 ORDER BY read_at ASC, id ASC`,
    [machineId, metric, sinceISO]
  );
}

export async function getMachineDisks(machineId: number): Promise<MachineDisk[]> {
  const db = await getDb();
  return db.select<MachineDisk[]>(
    "SELECT * FROM machine_disks WHERE machine_id = $1 ORDER BY slot ASC",
    [machineId]
  );
}
