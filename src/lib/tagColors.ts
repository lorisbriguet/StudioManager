/**
 * Tag colours as CSS variable strings: `var(--color-tag-blue-bg)` and so on.
 * The values live in src/index.css (:root and .dark), so a tag follows dark
 * mode and themes without callers knowing which is on. Use them anywhere a
 * CSS colour goes: inline styles, SVG fill/stroke, FullCalendar event colours.
 * To tint one, mix it: `color-mix(in srgb, ${c.text} 25%, transparent)`.
 */
export interface TagColor {
  bg: string;
  text: string;
}

function tagVars(name: TagColorName): TagColor {
  return { bg: `var(--color-tag-${name}-bg)`, text: `var(--color-tag-${name}-text)` };
}

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

/** A tag's colour from a hash of its name. */
export function getTagColor(name: string): TagColor {
  return tagVars(TAG_COLOR_NAMES[tagHash(name)]);
}

export type TagColorName = "blue" | "purple" | "green" | "red" | "yellow" | "cyan" | "orange" | "teal" | "gray";

/** Canonical color names, in palette order. Use for color pickers and cycling assignment of new tags. */
export const TAG_COLOR_NAMES: TagColorName[] = ["blue", "purple", "green", "red", "yellow", "cyan", "orange", "teal", "gray"];

/** Named color access for fixed semantic uses (free/paid, etc.) */
export function getNamedTagColor(colorName: TagColorName): TagColor {
  return tagVars(colorName);
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
export function getStoredTagColor(name: string | null | undefined): TagColor {
  return getNamedTagColor(normalizeTagColorName(name));
}
