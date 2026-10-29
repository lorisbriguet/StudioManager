import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getNamedTagColor, getStoredTagColor, getTagColor, TAG_COLOR_NAMES } from "../lib/tagColors";
import { onColorFor, relativeLuminance, themeTokens, THEME_TOKEN_NAMES, ON_DARK, ON_LIGHT } from "../lib/themeTokens";
import { getThemeById, THEMES } from "../lib/themes";
import { ACCENT_PRESETS, applyAccentColor, applyThemeColors } from "../stores/app-store";

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

  it("white on dark or saturated accents, near-black on light ones", () => {
    expect(onColorFor("#2563eb")).toBe(ON_DARK);
    expect(onColorFor("#ffffff")).toBe(ON_LIGHT);
    expect(onColorFor("#fde68a")).toBe(ON_LIGHT);
    // Pastel theme accents
    expect(onColorFor("#88c0d0")).toBe(ON_LIGHT); // Nord
    expect(onColorFor("#c4a7e7")).toBe(ON_LIGHT); // Rosé Pine
  });

  it("every accent preset keeps white text", () => {
    for (const p of ACCENT_PRESETS) expect(onColorFor(p.color), p.name).toBe(ON_DARK);
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

  it("every theme yields every token", () => {
    for (const theme of THEMES) {
      const tokens = themeTokens(theme);
      expect(Object.keys(tokens).sort(), theme.id).toEqual([...THEME_TOKEN_NAMES].sort());
      for (const [k, v] of Object.entries(tokens)) expect(v, `${theme.id} ${k}`).toBeTruthy();
    }
  });

  it("default-light and default-dark match src/index.css", () => {
    const light = block("@theme");
    const dark = { ...light, ...block(".dark") };
    for (const [id, sheet] of [["default-light", light], ["default-dark", dark]] as const) {
      const tokens = themeTokens(getThemeById(id)!);
      for (const [name, value] of Object.entries(tokens)) {
        const fromCss = sheet[name];
        // Only literal colours: aliases and color-mix values aren't comparable
        if (fromCss && /^#/.test(fromCss) && name !== "--color-accent-light" && name !== "--color-accent-hover") {
          expect(value.toLowerCase(), `${id} ${name}`).toBe(fromCss.toLowerCase());
        }
      }
    }
  });
});
