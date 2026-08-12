import { getDb } from "../index";
import { parseActivities } from "../../types/business-profile";
import type { Activity } from "../../types/activity";

export async function getActivities(): Promise<Activity[]> {
  const db = await getDb();
  const rows = await db.select<Activity[]>(
    "SELECT * FROM activities ORDER BY sort_order, id"
  );
  if (rows.length > 0) return rows;

  // First run: seed from the legacy business_profile.default_activity list
  // (JSON string array, or a plain string on very old profiles). The user
  // fills in the other language in Settings afterwards.
  const profile = await db.select<{ default_activity: string }[]>(
    "SELECT default_activity FROM business_profile LIMIT 1"
  );
  const names = [
    ...new Set(
      parseActivities(profile[0]?.default_activity)
        .map((n) => n.trim())
        .filter(Boolean)
    ),
  ];
  if (names.length === 0) return [];
  for (let i = 0; i < names.length; i++) {
    await db.execute(
      "INSERT INTO activities (name_fr, name_en, sort_order) VALUES ($1, $2, $3)",
      [names[i], names[i], i]
    );
  }
  return db.select<Activity[]>(
    "SELECT * FROM activities ORDER BY sort_order, id"
  );
}

export async function createActivity(
  name_fr: string,
  name_en: string
): Promise<number> {
  const db = await getDb();
  const fr = name_fr.trim();
  const en = name_en.trim();
  const [row] = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM activities"
  );
  const result = await db.execute(
    "INSERT INTO activities (name_fr, name_en, sort_order) VALUES ($1, $2, $3)",
    [fr || en, en || fr, (row?.m ?? -1) + 1]
  );
  return result.lastInsertId ?? 0;
}

export async function updateActivity(
  id: number,
  data: { name_fr: string; name_en: string }
): Promise<void> {
  const db = await getDb();
  const fr = data.name_fr.trim();
  const en = data.name_en.trim();
  await db.execute(
    "UPDATE activities SET name_fr = $2, name_en = $3 WHERE id = $1",
    [id, fr || en, en || fr]
  );
}

export async function deleteActivity(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM activities WHERE id = $1", [id]);
}
