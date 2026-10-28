/**
 * Shared class strings for ui/ components. See DESIGN-SYSTEM.md.
 * Components build on these instead of retyping the same geometry or tones.
 */

/**
 * The one control height: 26px = py-1 (8px) + 16px line + 1px border top and bottom.
 * Button, Input (sm), Select trigger, FilterChip and SegmentedControl segments
 * all use it, so every control in a row lines up. Add the radius per component.
 */
export const CONTROL_BOX = "px-2.5 py-1 text-xs leading-4 border";

/** Muted text that darkens on hover: inactive nav rows, tabs, segments, sort headers, grips. */
export const MUTED_INTERACTIVE = "text-muted hover:text-[var(--color-text-secondary)]";

/** A raised surface without a border: floating bars. Add the shadow per use. */
export const SURFACE_FILL = "bg-[var(--color-surface)] rounded-xl";

/** A raised surface: popovers, menus, dialogs. Add the shadow per use. */
export const SURFACE = `${SURFACE_FILL} border border-[var(--color-border-header)]`;

/**
 * Label pills (they label, they don't act): Tag, Badge, status pills.
 * PILL is 20px = py-0.5 (4px) + 16px line. PILL_XS is 16px = the 16px line alone,
 * for dense rows and numbers (CountBadge). FilterChip is a control and uses CONTROL_BOX.
 */
export const PILL = "inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap px-2 py-0.5 text-xs leading-4";
export const PILL_XS = "inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap px-1.5 text-[10px] leading-4";

/**
 * Tables. Two densities: default 40px rows with 16px sides (lists),
 * compact 32px rows with 12px sides (settings lists, editing grids).
 * The header is 32px in both. Rows have a minimum height so a row holding
 * a 26px control or a pill is as tall as a text row.
 */
export type TableDensity = "default" | "compact";
export const TABLE_X: Record<TableDensity, string> = { default: "px-4", compact: "px-3" };
export const TABLE_ROW_H: Record<TableDensity, string> = { default: "h-10", compact: "h-8" };
/** Header cell text: Table.Th and SortHeader. Add TABLE_X for the sides. */
export const TABLE_TH = "h-8 py-0 text-xs font-medium text-muted whitespace-nowrap select-none";
/** Numbers: right-aligned, digits of equal width so columns line up. */
export const NUMERIC = "text-right tabular-nums";

/**
 * Forms. One field grid gap (12px both ways), 24px between sections and
 * before the action row, a 768px cap on page forms. The action row is
 * right-aligned with the primary last; the Modal footer uses the same row.
 */
export const FORM_GAP = "gap-3";
export const FORM_STACK = "space-y-6";
export const FORM_WIDTH = "max-w-3xl";
export const FORM_ACTIONS = "flex items-center justify-end gap-2";
/** The field label: 12px muted, plain weight. FormField, and labels that can't be one. */
export const FIELD_LABEL = "block text-xs text-muted";
/** Columns a grid item takes in a FormGrid. */
export const FORM_SPAN = { 2: "col-span-2", 3: "col-span-3", 4: "col-span-4", full: "col-span-full" } as const;
export type FormSpan = keyof typeof FORM_SPAN;
