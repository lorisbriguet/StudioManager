import { getEquipmentDb, equipmentOrgId, validateFields, TransactionBatch } from "../index";
import type { Consumable } from "../../types/upkeep";

export type ConsumableInput = Pick<Consumable, "name" | "unit"> &
  Partial<
    Pick<
      Consumable,
      "machine_id" | "stock" | "reorder_level" | "supplier" | "product_url" | "unit_price" | "currency"
    >
  >;

const CONSUMABLE_COLUMNS = [
  "name", "machine_id", "unit", "stock", "reorder_level", "supplier", "product_url",
  "unit_price", "currency",
] as const;

export interface ProjectMaterialCostRow {
  name: string;
  amount: number;
  unit: string;
  cost: number;
  currency: string | null;
}

/** A consumable is low when its stock is below the reorder level. */
export function isLow(c: Pick<Consumable, "stock" | "reorder_level">): boolean {
  return c.stock < c.reorder_level;
}

/**
 * Lowest relative stock first. Items without a reorder level (0) go last:
 * SQLite sorts the NULL ratio first, so they are pushed down explicitly.
 */
export async function getConsumables(): Promise<Consumable[]> {
  const db = await getEquipmentDb();
  return db.select<Consumable[]>(
    "SELECT * FROM consumables ORDER BY (reorder_level = 0) ASC, stock / NULLIF(reorder_level, 0) ASC, name ASC"
  );
}

export async function getConsumable(id: number): Promise<Consumable | null> {
  const db = await getEquipmentDb();
  const rows = await db.select<Consumable[]>("SELECT * FROM consumables WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function createConsumable(data: ConsumableInput): Promise<number> {
  const cols = CONSUMABLE_COLUMNS.filter((c) => data[c] !== undefined);
  validateFields([...cols]);
  const db = await getEquipmentDb();
  const result = await db.execute(
    `INSERT INTO consumables (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => data[c])
  );
  return result.lastInsertId ?? 0;
}

/**
 * Update editable fields. A stock or level edit that puts the stock back
 * above the level clears the low-stock notice, like a restock, so the next
 * drop notifies again.
 */
export async function updateConsumable(id: number, data: Partial<ConsumableInput>): Promise<void> {
  const fields = Object.keys(data).filter(
    (k) => (CONSUMABLE_COLUMNS as readonly string[]).includes(k) && data[k as keyof ConsumableInput] !== undefined
  );
  if (fields.length === 0) return;
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 1}`);
  sets.push("updated_at = datetime('now')");
  const batch = new TransactionBatch(undefined, equipmentOrgId());
  batch.add(
    `UPDATE consumables SET ${sets.join(", ")} WHERE id = $${fields.length + 1}`,
    [...fields.map((f) => data[f as keyof ConsumableInput]), id]
  );
  if (fields.includes("stock") || fields.includes("reorder_level")) {
    batch.add(
      "UPDATE consumables SET low_notified = 0 WHERE id = $1 AND stock > reorder_level AND low_notified != 0",
      [id]
    );
  }
  await batch.commit();
}

export async function deleteConsumable(id: number): Promise<void> {
  const db = await getEquipmentDb();
  await db.execute("DELETE FROM consumables WHERE id = $1", [id]);
}

/**
 * Log a use: one atomic batch inserts the usage row (cost = amount x the
 * consumable's current unit_price) and lowers the stock, never below zero.
 */
export async function logConsumableUsage(
  id: number,
  amount: number,
  projectId: number | null,
  usedOnISO: string
): Promise<void> {
  if (!(amount > 0)) throw new Error("Amount must be greater than zero");
  // A project id of this organisation means nothing in the borrowed database.
  if (equipmentOrgId()) projectId = null;
  const batch = new TransactionBatch(undefined, equipmentOrgId());
  batch.add(
    `INSERT INTO consumable_usage (consumable_id, project_id, used_on, amount, cost)
     SELECT id, $2, $3, $4, CASE WHEN unit_price IS NULL THEN NULL ELSE $4 * unit_price END
     FROM consumables WHERE id = $1`,
    [id, projectId, usedOnISO, amount]
  );
  batch.add(
    "UPDATE consumables SET stock = MAX(stock - $1, 0), updated_at = datetime('now') WHERE id = $2",
    [amount, id]
  );
  await batch.commit();
}

/** Add stock; clears the low-stock notification once stock is above the reorder level. */
export async function restockConsumable(id: number, amount: number): Promise<void> {
  if (!(amount > 0)) throw new Error("Amount must be greater than zero");
  const batch = new TransactionBatch(undefined, equipmentOrgId());
  batch.add(
    "UPDATE consumables SET stock = stock + $1, updated_at = datetime('now') WHERE id = $2",
    [amount, id]
  );
  batch.add(
    "UPDATE consumables SET low_notified = 0 WHERE id = $1 AND stock > reorder_level AND low_notified != 0",
    [id]
  );
  await batch.commit();
}

/** Material used on a project, grouped by consumable. */
export async function getProjectMaterialCost(projectId: number): Promise<ProjectMaterialCostRow[]> {
  if (equipmentOrgId()) return [];
  const db = await getEquipmentDb();
  return db.select<ProjectMaterialCostRow[]>(
    `SELECT c.name AS name, c.unit AS unit, c.currency AS currency,
            SUM(u.amount) AS amount, COALESCE(SUM(u.cost), 0) AS cost
     FROM consumable_usage u
     JOIN consumables c ON c.id = u.consumable_id
     WHERE u.project_id = $1
     GROUP BY c.id, c.name, c.unit, c.currency
     ORDER BY c.name ASC`,
    [projectId]
  );
}
