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

/** A raised surface: popovers, menus, dialogs, floating bars. Add the shadow per use. */
export const SURFACE = "bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl";
