import type { ThemeDefinition } from "../types/theme";

/** Text colour on a light fill (the app's default text, near-black). */
export const ON_LIGHT = "#111827";
/** Text colour on a dark or saturated fill. */
export const ON_DARK = "#ffffff";

/** WCAG relative luminance of a #rgb / #rrggbb colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 0;
  const channel = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio of two #rgb / #rrggbb colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The text colour that reads on a fill: whichever of white and near-black has
 * more contrast with it. Mid-tone fills (orange, teal, sage…) take near-black.
 */
export function onColorFor(fill: string): string {
  return contrastRatio(ON_DARK, fill) >= contrastRatio(ON_LIGHT, fill) ? ON_DARK : ON_LIGHT;
}

const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

/**
 * The dark tag palette's text colours (the .dark values in src/index.css,
 * checked by colourTokens.test.ts). Dark custom themes derive their tag
 * colours from these and their own surface / text.
 */
export const DARK_TAG_COLORS: Record<string, string> = {
  blue: "#60a5fa", purple: "#a78bfa", green: "#4ade80", red: "#f87171", yellow: "#fbbf24",
  cyan: "#38bdf8", orange: "#fb923c", teal: "#2dd4bf", gray: "#a8a8a8",
};

/**
 * The solid info fill (status dots), light and dark: the --color-info values
 * in src/index.css (@theme and .dark), checked by colourTokens.test.ts.
 * Themes have no info colour of their own; they take the one for their mode.
 */
export const INFO_COLORS = { light: "#2563eb", dark: "#60a5fa" } as const;

/** True for the two built-in themes, whose values live in src/index.css. */
export function isDefaultTheme(theme: ThemeDefinition): boolean {
  return theme.id === "default-light" || theme.id === "default-dark";
}

/**
 * Every colour token a theme sets, as CSS custom property → value. Values a
 * theme doesn't give are derived from its bg / surface / text / border with
 * color-mix, so a theme only needs its base colours:
 *
 *   text-secondary   text 80% over bg
 *   input-bg         text 8% over surface  (so fields show on cards)
 *   hover-row        text 4% over bg
 *   border-divider   border 50% over bg    (fainter than the surface edge)
 *   input-border     border 80% over text  (stronger than the surface edge)
 *   checkbox-border  muted 75% over surface (3:1, a control boundary)
 *   status bg        the status colour 15% over bg
 *   status text      the status colour 55% over text (dark) or 50% (light)
 *   accent-text      accent 60% over white (dark) or over text (light)
 *   on-accent        white or near-black, whichever reads (onColorFor)
 *   on-danger        the same for the danger fill
 *   tags (dark)      tag colour 15% over surface, text 50% over theme text,
 *                    so tags don't read as dark holes on lighter surfaces
 *
 *   info             INFO_COLORS for the theme's mode (a fill: status dots)
 *
 * Info text and pills keep the tag palette's blue (it follows .dark by itself).
 */
export function themeTokens(theme: ThemeDefinition): Record<string, string> {
  const c = theme.colors;
  const dark = theme.mode === "dark";
  const isDefault = isDefaultTheme(theme);
  const statusText = (color: string) => mix(color, dark ? 55 : 50, c.text);
  // Dark custom themes re-derive the tag palette from their own surface
  const tags: Record<string, string> = {};
  if (dark && !isDefault) {
    for (const [name, color] of Object.entries(DARK_TAG_COLORS)) {
      tags[`--color-tag-${name}-bg`] = mix(color, 15, c.surface);
      tags[`--color-tag-${name}-text`] = mix(color, 50, c.text);
    }
  }
  const status = isDefault
    ? {
        "--color-success-bg": "var(--color-tag-green-bg)",
        "--color-success-text": "var(--color-tag-green-text)",
        "--color-warning-bg": "var(--color-tag-yellow-bg)",
        "--color-warning-text": "var(--color-tag-yellow-text)",
        "--color-danger-bg": "var(--color-tag-red-bg)",
        "--color-danger-text": "var(--color-tag-red-text)",
      }
    : {
        "--color-success-bg": mix(c.success, 15, c.bg),
        "--color-success-text": statusText(c.success),
        "--color-warning-bg": mix(c.warning, 15, c.bg),
        "--color-warning-text": statusText(c.warning),
        "--color-danger-bg": mix(c.danger, 15, c.bg),
        "--color-danger-text": statusText(c.danger),
      };
  return {
    "--color-bg": c.bg,
    "--color-text": c.text,
    "--color-text-secondary": c.textSecondary ?? mix(c.text, 80, c.bg),
    "--color-muted": c.textMuted,
    "--color-surface": c.surface,
    "--color-sidebar": c.sidebar,
    "--color-sidebar-border": c.sidebarBorder,
    "--color-input-bg": c.inputBg ?? mix(c.text, 8, c.surface),
    "--color-hover-row": c.hoverRow ?? mix(c.text, 4, c.bg),
    "--color-border-divider": c.borderDivider ?? mix(c.border, 50, c.bg),
    "--color-border": c.border,
    "--color-input-border": c.inputBorder ?? mix(c.border, 80, c.text),
    "--color-checkbox-border": isDefault
      ? (dark ? "#6b6b6b" : "#949494")
      : mix(c.textMuted, 75, c.surface),
    "--color-accent": c.accent,
    "--color-accent-light": c.accentLight,
    "--color-accent-hover": c.accentHover,
    "--color-accent-dark-light": c.accentLight,
    // Reads the accent variable, so it follows an accent preset picked later
    "--color-accent-text": mix("var(--color-accent)", 60, dark ? "white" : c.text),
    "--color-on-accent": c.onAccent ?? onColorFor(c.accent),
    "--color-success": c.success,
    "--color-warning": c.warning,
    "--color-danger": c.danger,
    "--color-info": dark ? INFO_COLORS.dark : INFO_COLORS.light,
    "--color-on-danger": onColorFor(c.danger),
    ...status,
    ...tags,
    "--color-chart-1": c.chart1,
    "--color-chart-2": c.chart2,
    "--color-chart-3": c.chart3,
    "--color-chart-4": c.chart4,
    "--color-chart-5": c.chart5,
    "--color-chart-6": c.chart6,
    "--color-chart-7": c.chart7,
    "--color-chart-8": c.chart8,
  };
}

/** Every property themeTokens can set (light and dark): cleared before a theme is applied. */
export const THEME_TOKEN_NAMES: string[] = (["light", "dark"] as const).reduce<string[]>((names, mode) => {
  const tokens = themeTokens({
    id: "",
    name: "",
    description: "",
    mode,
    colors: {
      sidebar: "", sidebarBorder: "", bg: "", text: "", textMuted: "", border: "", surface: "",
      accent: "#000000", accentLight: "", accentHover: "", success: "", warning: "", danger: "#000000",
      chart1: "", chart2: "", chart3: "", chart4: "", chart5: "", chart6: "", chart7: "", chart8: "",
    },
  });
  return [...names, ...Object.keys(tokens).filter((k) => !names.includes(k))];
}, []);
