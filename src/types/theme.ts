export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  mode: "light" | "dark";
  colors: {
    sidebar: string;
    sidebarBorder: string;
    bg: string;
    text: string;
    textMuted: string;
    border: string;
    surface: string;
    accent: string;
    accentLight: string;
    accentHover: string;
    success: string;
    warning: string;
    danger: string;
    chart1: string;
    chart2: string;
    chart3: string;
    chart4: string;
    chart5: string;
    chart6: string;
    chart7: string;
    chart8: string;
    /* Optional: derived from bg / text / border when left out (lib/themeTokens.ts) */
    textSecondary?: string;
    inputBg?: string;
    inputBorder?: string;
    hoverRow?: string;
    borderDivider?: string;
    /** Text on an accent fill; computed from the accent's luminance when left out. */
    onAccent?: string;
  };
}
