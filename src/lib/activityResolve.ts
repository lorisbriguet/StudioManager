import type { Activity } from "../types/activity";

/** One row per (activity_id, activity-text) pair from the revenue query. */
export interface ActivityRevenueRow {
  activity_id: number | null;
  activity: string;
  total: number;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Merge revenue rows into one chart row per real activity.
 * Resolution per row: valid activity_id -> name match (FR or EN,
 * case-insensitive, trimmed) -> raw text as its own row. Empty text is the
 * "N/A" bucket. Labels follow the requested UI language.
 * `key` is stable across language and ranking changes — hash it for chart
 * colors so an activity keeps its color when totals shift.
 */
export function resolveActivityRevenue(
  rows: ActivityRevenueRow[],
  activities: Activity[],
  lang: "FR" | "EN"
): { key: string; label: string; total: number }[] {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const byName = new Map<string, Activity>();
  for (const a of activities) {
    byName.set(norm(a.name_fr), a);
    byName.set(norm(a.name_en), a);
  }

  const groups = new Map<string, { key: string; label: string; total: number }>();
  for (const row of rows) {
    // A dangling activity_id (deleted activity) falls back to text matching.
    const act =
      (row.activity_id !== null ? byId.get(row.activity_id) : undefined) ??
      byName.get(norm(row.activity));
    const key = act ? `id:${act.id}` : `text:${norm(row.activity)}`;
    const label = act
      ? lang === "FR"
        ? act.name_fr
        : act.name_en
      : row.activity.trim() || "N/A";
    const g = groups.get(key);
    if (g) g.total += row.total;
    else groups.set(key, { key, label, total: row.total });
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}
