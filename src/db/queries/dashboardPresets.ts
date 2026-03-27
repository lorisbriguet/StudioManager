import { getDb } from "../index";

export interface DashboardPreset {
  id: number;
  name: string;
  layout_json: string;
  is_builtin: number;
  sort_order: number;
  created_at: string;
}

export async function getDashboardPresets(): Promise<DashboardPreset[]> {
  const db = await getDb();
  return db.select<DashboardPreset[]>(
    "SELECT * FROM dashboard_presets ORDER BY is_builtin DESC, sort_order ASC"
  );
}

export async function createDashboardPreset(
  name: string,
  layoutJson: string
): Promise<number> {
  const db = await getDb();
  const maxOrder = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM dashboard_presets WHERE is_builtin = 0"
  );
  const nextOrder = (maxOrder[0]?.m ?? -1) + 1;
  const result = await db.execute(
    "INSERT INTO dashboard_presets (name, layout_json, is_builtin, sort_order) VALUES ($1, $2, 0, $3)",
    [name, layoutJson, nextOrder]
  );
  return result.lastInsertId ?? 0;
}

export async function updateDashboardPreset(
  id: number,
  data: { name?: string; layout_json?: string }
): Promise<void> {
  const db = await getDb();
  // Only update non-builtin presets
  if (data.name !== undefined) {
    await db.execute(
      "UPDATE dashboard_presets SET name = $1 WHERE id = $2 AND is_builtin = 0",
      [data.name, id]
    );
  }
  if (data.layout_json !== undefined) {
    await db.execute(
      "UPDATE dashboard_presets SET layout_json = $1 WHERE id = $2 AND is_builtin = 0",
      [data.layout_json, id]
    );
  }
}

export async function deleteDashboardPreset(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM dashboard_presets WHERE id = $1 AND is_builtin = 0",
    [id]
  );
}
