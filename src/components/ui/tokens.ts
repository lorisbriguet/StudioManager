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
