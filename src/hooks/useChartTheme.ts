import type { CSSProperties } from "react";

/**
 * Recharts colours as CSS variable strings (SVG stroke/fill and the tooltip's
 * inline style accept them), so charts follow dark mode and themes without
 * re-rendering. A constant: kept as a hook so callers don't change.
 */
const CHART_THEME = {
  gridStroke: "var(--color-border-divider)",
  tickFill: "var(--color-muted)",
  tooltipStyle: {
    fontSize: 12,
    borderRadius: 8,
    border: "none",
    backgroundColor: "var(--color-surface)",
    color: "var(--color-text)",
    boxShadow: "var(--shadow-menu)",
  } as CSSProperties,
  cursorFill: "var(--color-overlay-hover)",
  pieItemStyle: { color: "var(--color-text)" } as CSSProperties,
};

export function useChartTheme() {
  return CHART_THEME;
}
