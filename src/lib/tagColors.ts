export interface TagColor {
  bg: string;
  text: string;
}

const TAG_COLORS_DARK: TagColor[] = [
  { bg: "#1a2332", text: "#60a5fa" }, // blue
  { bg: "#1e1b2e", text: "#a78bfa" }, // purple
  { bg: "#052e16", text: "#4ade80" }, // green
  { bg: "#2a1215", text: "#f87171" }, // red
  { bg: "#1c1917", text: "#fbbf24" }, // yellow
  { bg: "#0c1a2e", text: "#38bdf8" }, // cyan
  { bg: "#2a1a0e", text: "#fb923c" }, // orange
  { bg: "#042f2e", text: "#2dd4bf" }, // teal
  { bg: "#1a1a1a", text: "#a8a8a8" }, // gray
];

const TAG_COLORS_LIGHT: TagColor[] = [
  { bg: "#dbeafe", text: "#1d4ed8" },
  { bg: "#ede9fe", text: "#6d28d9" },
  { bg: "#dcfce7", text: "#15803d" },
  { bg: "#fee2e2", text: "#b91c1c" },
  { bg: "#fef3c7", text: "#92400e" },
  { bg: "#cffafe", text: "#0e7490" },
  { bg: "#ffedd5", text: "#c2410c" },
  { bg: "#ccfbf1", text: "#0f766e" },
  { bg: "#f3f4f6", text: "#6b7280" },
];

/** Deterministic 0-8 hash of a name — same string always maps to the same
 * palette slot. Also used to keep chart series colors stable across
 * ranking changes (hash the row's stable key, not its sorted index). */
export function tagHash(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 9;
}

export function getTagColor(name: string, dark: boolean): TagColor {
  const index = tagHash(name);
  return dark ? TAG_COLORS_DARK[index] : TAG_COLORS_LIGHT[index];
}

export type TagColorName = "blue" | "purple" | "green" | "red" | "yellow" | "cyan" | "orange" | "teal" | "gray";

/** Canonical color names, in palette order. Use for color pickers and cycling assignment of new tags. */
export const TAG_COLOR_NAMES: TagColorName[] = ["blue", "purple", "green", "red", "yellow", "cyan", "orange", "teal", "gray"];

/** Named color access for fixed semantic uses (free/paid, etc.) */
export function getNamedTagColor(colorName: TagColorName, dark: boolean): TagColor {
  const idx = TAG_COLOR_NAMES.indexOf(colorName);
  return dark ? TAG_COLORS_DARK[idx] : TAG_COLORS_LIGHT[idx];
}

/**
 * Legacy color names (Notion-era workload palette) mapped to the closest canonical name.
 * Workload column configs and custom-list items store color NAMES in JSON/DB, so
 * "brown"/"pink" may exist in stored data forever — never migrate, always map at render.
 */
const LEGACY_COLOR_NAMES: Record<string, TagColorName> = {
  brown: "orange",
  pink: "red",
};

/** Normalize a stored (possibly legacy or missing) color name to a canonical TagColorName. */
export function normalizeTagColorName(name: string | null | undefined): TagColorName {
  if (name && (TAG_COLOR_NAMES as string[]).includes(name)) return name as TagColorName;
  return (name && LEGACY_COLOR_NAMES[name]) || "gray";
}

/** Color for a stored color name — use for workload select options and custom-list items. */
export function getStoredTagColor(name: string | null | undefined, dark: boolean): TagColor {
  return getNamedTagColor(normalizeTagColorName(name), dark);
}
