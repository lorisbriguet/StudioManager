import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getNamedTagColor, getStoredTagColor, getTagColor, TAG_COLOR_NAMES } from "../lib/tagColors";
import {
  contrastRatio, DARK_TAG_COLORS, INFO_COLORS, isDefaultTheme, onColorFor, relativeLuminance, themeTokens, THEME_TOKEN_NAMES,
  ON_DARK, ON_LIGHT,
} from "../lib/themeTokens";
import { getThemeById, THEMES } from "../lib/themes";
import { ACCENT_PRESETS, applyAccentColor, applyThemeColors } from "../stores/app-store";
import type { ThemeDefinition } from "../types/theme";

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

/** `--name: value;` pairs of the first block opened by `selector {`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const end = css.indexOf("\n}", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

type RGB = [number, number, number];
const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000" };

/** Splits `a, b` at top-level commas (not inside parentheses). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * A token value as an sRGB colour: hex, white/black, var(--x[, fallback])
 * looked up in `env`, or color-mix(in srgb, A p%, B), recursively.
 */
function resolveColor(value: string, env: Record<string, string>, depth = 0): RGB {
  if (depth > 20) throw new Error(`cycle resolving ${value}`);
  const v = value.trim();
  if (NAMED[v]) return resolveColor(NAMED[v], env, depth + 1);
  if (v.startsWith("#")) {
    let h = v.slice(1);
    if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
  }
  const inner = (prefix: string) => v.slice(prefix.length, -1);
  if (v.startsWith("var(")) {
    const [name, fallback] = splitArgs(inner("var("));
    const found = env[name] ?? fallback;
    if (!found) throw new Error(`unset ${name}`);
    return resolveColor(found, env, depth + 1);
  }
  if (v.startsWith("color-mix(")) {
    const [, a, b] = splitArgs(inner("color-mix("));
    const m = a.match(/^(.*)\s+([\d.]+)%$/);
    if (!m) throw new Error(`no percentage in ${v}`);
    const p = Number(m[2]) / 100;
    const ca = resolveColor(m[1], env, depth + 1);
    const cb = resolveColor(b, env, depth + 1);
    return ca.map((x, i) => x * p + cb[i] * (1 - p)) as RGB;
  }
  throw new Error(`can't resolve ${v}`);
}

/** WCAG relative luminance of 0-255 channels (unrounded, as color-mix computes them). */
function luminance(c: RGB): number {
  const ch = (x: number) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
}

/** The tokens in force for a theme: the stylesheet, then the theme's inline overrides. */
function themeEnv(theme: ThemeDefinition): Record<string, string> {
  const sheet = { ...block("@theme"), ...block(":root"), ...(theme.mode === "dark" ? block(".dark") : {}) };
  return isDefaultTheme(theme) ? sheet : { ...sheet, ...themeTokens(theme) };
}

/** Contrast of two tokens (or literal colours) in a theme's environment. */
function ratio(env: Record<string, string>, fg: string, bg: string): number {
  const l = (x: string) => luminance(resolveColor(x.startsWith("--") ? `var(${x})` : x, env));
  const [a, b] = [l(fg), l(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("tag colours", () => {
  it("are CSS variables, the same in light and dark (the stylesheet switches them)", () => {
    expect(getNamedTagColor("green")).toEqual({ bg: "var(--color-tag-green-bg)", text: "var(--color-tag-green-text)" });
    expect(getStoredTagColor("pink")).toEqual(getNamedTagColor("red"));
    expect(getTagColor("typography").bg).toMatch(/^var\(--color-tag-[a-z]+-bg\)$/);
  });

  it("every tag variable is defined in :root and in .dark", () => {
    const dark = block(".dark");
    for (const name of TAG_COLOR_NAMES) {
      for (const part of ["bg", "text"]) {
        const v = `--color-tag-${name}-${part}`;
        expect(css).toMatch(new RegExp(`:root \\{[^}]*${v}:`));
        expect(dark[v], v).toMatch(/^#/);
      }
    }
  });

  it("status colours alias the tag palette", () => {
    const theme = block("@theme");
    expect(theme["--color-success-bg"]).toBe("var(--color-tag-green-bg)");
    expect(theme["--color-danger-text"]).toBe("var(--color-tag-red-text)");
    expect(theme["--color-warning-bg"]).toBe("var(--color-tag-yellow-bg)");
    expect(theme["--color-info-text"]).toBe("var(--color-tag-blue-text)");
  });
});

describe("on-accent from luminance", () => {
  it("computes WCAG relative luminance", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(relativeLuminance("#fff")).toBeCloseTo(1);
    expect(relativeLuminance("#2563eb")).toBeCloseTo(0.153, 2);
  });

  it("picks whichever of white and near-black contrasts more", () => {
    expect(onColorFor("#2563eb")).toBe(ON_DARK);
    expect(onColorFor("#ffffff")).toBe(ON_LIGHT);
    expect(onColorFor("#fde68a")).toBe(ON_LIGHT);
    // Pastel theme accents
    expect(onColorFor("#88c0d0")).toBe(ON_LIGHT); // Nord
    expect(onColorFor("#c4a7e7")).toBe(ON_LIGHT); // Rosé Pine
    // Mid-tone presets read better with near-black
    expect(onColorFor("#ea580c")).toBe(ON_LIGHT); // Orange
  });

  it("every accent preset and theme accent reads 4.5:1 with its on-accent", () => {
    for (const p of ACCENT_PRESETS) {
      expect(contrastRatio(onColorFor(p.color), p.color), p.name).toBeGreaterThanOrEqual(4.5);
    }
    for (const theme of THEMES) {
      const env = themeEnv(theme);
      env["--color-accent"] = theme.colors.accent;
      env["--color-on-accent"] = themeTokens(theme)["--color-on-accent"];
      expect(ratio(env, "--color-on-accent", "--color-accent"), theme.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("applyAccentColor sets --color-on-accent", () => {
    applyAccentColor("#fde68a", "#fef3c7", "#422006");
    expect(document.documentElement.style.getPropertyValue("--color-on-accent")).toBe(ON_LIGHT);
    applyAccentColor("#2563eb", "#dbeafe", "#172554");
    expect(document.documentElement.style.getPropertyValue("--color-on-accent")).toBe(ON_DARK);
  });
});

describe("themes", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.documentElement.classList.remove("dark");
  });

  it("applyThemeColors sets the full token set for a custom theme", () => {
    const nord = getThemeById("nord")!;
    applyThemeColors(nord);
    const style = document.documentElement.style;
    for (const name of [
      "--color-bg", "--color-text", "--color-text-secondary", "--color-input-bg", "--color-input-border",
      "--color-hover-row", "--color-border-divider", "--color-border", "--color-success-bg",
      "--color-success-text", "--color-danger-bg", "--color-danger-text", "--color-warning-bg",
      "--color-warning-text", "--color-on-accent", "--color-surface", "--color-muted", "--color-accent",
    ]) {
      expect(style.getPropertyValue(name), name).not.toBe("");
    }
    expect(style.getPropertyValue("--color-bg")).toBe(nord.colors.bg);
    expect(style.getPropertyValue("--color-on-accent")).toBe(ON_LIGHT);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // No body inline colours, no gray remap
    expect(document.body.style.background).toBe("");
    expect(style.getPropertyValue("--color-gray-50")).toBe("");
  });

  it("a default theme clears the overrides so the stylesheet applies", () => {
    applyThemeColors(getThemeById("nord")!);
    applyThemeColors(getThemeById("default-light")!);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--color-bg")).toBe("");
    expect(style.getPropertyValue("--color-border")).toBe("");
    expect(style.getPropertyValue("--color-accent")).toBe("#2563eb");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("every theme yields every token (dark custom themes add the tag palette)", () => {
    const tagTokens = THEME_TOKEN_NAMES.filter((n) => n.startsWith("--color-tag-"));
    expect(tagTokens).toHaveLength(TAG_COLOR_NAMES.length * 2);
    for (const theme of THEMES) {
      const tokens = themeTokens(theme);
      const expected = theme.mode === "dark" && !isDefaultTheme(theme)
        ? THEME_TOKEN_NAMES
        : THEME_TOKEN_NAMES.filter((n) => !tagTokens.includes(n));
      expect(Object.keys(tokens).sort(), theme.id).toEqual([...expected].sort());
      for (const [k, v] of Object.entries(tokens)) expect(v, `${theme.id} ${k}`).toBeTruthy();
    }
  });

  it("DARK_TAG_COLORS match the .dark tag palette", () => {
    const dark = block(".dark");
    for (const name of TAG_COLOR_NAMES) {
      expect(DARK_TAG_COLORS[name], name).toBe(dark[`--color-tag-${name}-text`]);
    }
  });

  it("default-light and default-dark match src/index.css", () => {
    const light = block("@theme");
    const dark = { ...light, ...block(".dark") };
    for (const [id, sheet] of [["default-light", light], ["default-dark", dark]] as const) {
      const tokens = themeTokens(getThemeById(id)!);
      for (const [name, value] of Object.entries(tokens)) {
        const fromCss = sheet[name];
        // Only literal colours: aliases and color-mix values aren't comparable.
        // The accent is checked on its own below: applyAccentColor sets it inline.
        if (fromCss && /^#/.test(fromCss) && name !== "--color-accent" && name !== "--color-accent-light" && name !== "--color-accent-hover") {
          expect(value.toLowerCase(), `${id} ${name}`).toBe(fromCss.toLowerCase());
        }
      }
    }
  });

  it("the default themes' accents: Default Light the stylesheet blue, Default Dark its own slate", () => {
    // Default Light's accent is the @theme value; Default Dark deliberately
    // differs from it: applyAccentColor sets slate inline over the stylesheet.
    expect(getThemeById("default-light")!.colors.accent).toBe(block("@theme")["--color-accent"]);
    expect(block(".dark")["--color-accent"]).toBeUndefined();
    const c = getThemeById("default-dark")!.colors;
    expect([c.accent, c.accentLight, c.accentHover]).toEqual(["#64748b", "#0f172a", "#475569"]);

    applyThemeColors(getThemeById("default-dark")!);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--color-accent")).toBe("#64748b");
    expect(style.getPropertyValue("--color-on-accent")).toBe(onColorFor("#64748b"));

    // The slate reads like any accent: on-accent on the fill, accent-text on
    // the dark page, surface and accent-light
    const env = themeEnv(getThemeById("default-dark")!);
    env["--color-accent"] = c.accent;
    env["--color-accent-light"] = c.accentLight;
    expect(contrastRatio(onColorFor(c.accent), c.accent)).toBeGreaterThanOrEqual(4.5);
    for (const bg of ["--color-bg", "--color-surface", "--color-accent-light"]) {
      expect(ratio(env, "--color-accent-text", bg), bg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("--color-info is a solid fill, light and dark, and themes take their mode's", () => {
    expect(block("@theme")["--color-info"]).toBe(INFO_COLORS.light);
    expect(block(".dark")["--color-info"]).toBe(INFO_COLORS.dark);
    for (const theme of THEMES) {
      expect(themeTokens(theme)["--color-info"], theme.id).toBe(INFO_COLORS[theme.mode]);
    }
  });
});

/**
 * WCAG contrast, computed from the real tokens: 4.5:1 for text, 3:1 for
 * control boundaries. Each theme's values come from src/index.css plus its
 * themeTokens overrides, color-mix resolved.
 */
describe("contrast", () => {
  const surfaces = ["--color-bg", "--color-surface"];

  it("muted text reads 4.5:1 on bg and surface in every theme", () => {
    for (const theme of THEMES) {
      const env = themeEnv(theme);
      for (const bg of surfaces) {
        expect(ratio(env, "--color-muted", bg), `${theme.id} ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("status text reads 4.5:1 on its status bg in every theme", () => {
    for (const theme of THEMES) {
      const env = themeEnv(theme);
      for (const s of ["success", "warning", "danger", "info"]) {
        expect(ratio(env, `--color-${s}-text`, `--color-${s}-bg`), `${theme.id} ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("status text reads 4.5:1 on bg and surface in every theme", () => {
    for (const theme of THEMES) {
      const env = themeEnv(theme);
      for (const s of ["success", "warning", "danger"]) {
        for (const bg of surfaces) {
          expect(ratio(env, `--color-${s}-text`, bg), `${theme.id} ${s} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("the info fill (status dots) is 3:1 against bg and surface in every theme", () => {
    for (const theme of THEMES) {
      const env = themeEnv(theme);
      for (const bg of surfaces) {
        expect(ratio(env, "--color-info", bg), `${theme.id} ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("on-danger reads 4.5:1 on the danger fill in every theme", () => {
    for (const theme of THEMES) {
      const env = themeEnv(theme);
      expect(ratio(env, "--color-on-danger", "--color-danger"), theme.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("accent text reads 4.5:1 on bg, surface and accent-light in every theme", () => {
    for (const theme of THEMES) {
      const env = themeEnv(theme);
      env["--color-accent"] = theme.colors.accent;
      env["--color-accent-light"] = theme.colors.accentLight;
      for (const bg of [...surfaces, "--color-accent-light"]) {
        expect(ratio(env, "--color-accent-text", bg), `${theme.id} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("accent text reads 4.5:1 for every preset, light and dark", () => {
    for (const id of ["default-light", "default-dark"]) {
      const theme = getThemeById(id)!;
      for (const p of ACCENT_PRESETS) {
        const env = themeEnv(theme);
        env["--color-accent"] = p.color;
        env["--color-accent-light"] = theme.mode === "dark" ? p.darkLight : p.light;
        // The 10% accent tint (selected menu row) over the page
        env["--tint"] = `color-mix(in srgb, ${p.color} 10%, ${env["--color-bg"]})`;
        for (const bg of [...surfaces, "--color-input-bg", "--color-accent-light", "--tint"]) {
          expect(ratio(env, "--color-accent-text", bg), `${id} ${p.name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("the checkbox border is 3:1 against bg and surface in every theme", () => {
    for (const theme of THEMES) {
      const env = themeEnv(theme);
      for (const bg of surfaces) {
        expect(ratio(env, "--color-checkbox-border", bg), `${theme.id} ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("placeholders (muted) read on input-bg", () => {
    for (const theme of THEMES) {
      const env = themeEnv(theme);
      expect(ratio(env, "--color-muted", "--color-input-bg"), theme.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("tags read 4.5:1 in every theme", () => {
    for (const theme of THEMES) {
      const env = themeEnv(theme);
      for (const name of TAG_COLOR_NAMES) {
        expect(ratio(env, `--color-tag-${name}-text`, `--color-tag-${name}-bg`), `${theme.id} ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("banner text reads 4.5:1, light and dark", () => {
    for (const env of [themeEnv(getThemeById("default-light")!), themeEnv(getThemeById("default-dark")!)]) {
      for (const b of ["test", "test-hover", "presentation", "presentation-hover"]) {
        expect(ratio(env, "--color-on-banner", `--color-banner-${b}`), b).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
