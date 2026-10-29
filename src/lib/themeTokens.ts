import type { ThemeDefinition } from "../types/theme";

/** Text colour on a light fill (the app's default text, near-black). */
export const ON_LIGHT = "#111827";
/** Text colour on a dark or saturated fill. */
export const ON_DARK = "#ffffff";

/**
 * Above this relative luminance a fill is "light" and takes near-black text.
 * 0.4 rather than 0.5: pastel accents such as Nord (#88c0d0, 0.47), Rosé Pine
 * (#c4a7e7, 0.45) and Catppuccin (#89b4fa, 0.45) are already unreadable with
 * white text (contrast about 2:1), while every accent preset stays below it
 * and keeps white.
 */
export const LIGHT_FILL_LUMINANCE = 0.4;

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

/** The text colour that reads on a fill: near-black on a light fill, white otherwise. */
export function onColorFor(fill: string): string {
  return relativeLuminance(fill) > LIGHT_FILL_LUMINANCE ? ON_LIGHT : ON_DARK;
}

const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

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
 *   input-bg         text 6% over bg       hover-row  text 4% over bg
 *   border-divider   border 50% over bg    (fainter than the surface edge)
 *   input-border     border 80% over text  (stronger than the surface edge)
 *   status bg        the status colour 15% over bg
 *   status text      the status colour (dark themes) or 75% over text (light)
 *   on-accent        from the accent's luminance (onColorFor)
 *
 * Info keeps the tag palette's blue (it follows .dark by itself).
 */
export function themeTokens(theme: ThemeDefinition): Record<string, string> {
  const c = theme.colors;
  const dark = theme.mode === "dark";
  const statusText = (color: string) => (dark ? color : mix(color, 75, c.text));
  const status = isDefaultTheme(theme)
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
    "--color-input-bg": c.inputBg ?? mix(c.text, 6, c.bg),
    "--color-hover-row": c.hoverRow ?? mix(c.text, 4, c.bg),
    "--color-border-divider": c.borderDivider ?? mix(c.border, 50, c.bg),
    "--color-border": c.border,
    "--color-input-border": c.inputBorder ?? mix(c.border, 80, c.text),
    "--color-accent": c.accent,
    "--color-accent-light": c.accentLight,
    "--color-accent-hover": c.accentHover,
    "--color-accent-dark-light": c.accentLight,
    "--color-on-accent": c.onAccent ?? onColorFor(c.accent),
    "--color-success": c.success,
    "--color-warning": c.warning,
    "--color-danger": c.danger,
    ...status,
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

/** Every property themeTokens can set: cleared before a theme is applied. */
export const THEME_TOKEN_NAMES: string[] = Object.keys(
  themeTokens({
    id: "",
    name: "",
    description: "",
    mode: "light",
    colors: {
      sidebar: "", sidebarBorder: "", bg: "", text: "", textMuted: "", border: "", surface: "",
      accent: "#000000", accentLight: "", accentHover: "", success: "", warning: "", danger: "",
      chart1: "", chart2: "", chart3: "", chart4: "", chart5: "", chart6: "", chart7: "", chart8: "",
    },
  }),
);
