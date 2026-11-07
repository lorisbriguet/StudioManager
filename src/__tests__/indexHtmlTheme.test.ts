import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { THEMES } from "../lib/themes";
import { storedThemeId, syncAppearanceFromStorage, useAppStore } from "../stores/app-store";

// The theme chosen in Settings decides dark or light, whatever the Mac is set to.
// index.html sets it before React loads; app-store applies the full theme at launch.

const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(html)![1];

const realMatchMedia = window.matchMedia;
function macAppearance(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark && query.includes("prefers-color-scheme: dark"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function resetDocument() {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
}

/** Runs index.html's inline script, as on launch before React. */
function runIndexScript() {
  new Function(inlineScript)();
}

beforeEach(resetDocument);
afterEach(() => {
  window.matchMedia = realMatchMedia;
  resetDocument();
});

describe("index.html startup script", () => {
  it("knows the mode of every theme", () => {
    const modes = JSON.parse(
      /var THEME_MODES = (\{[\s\S]*?\});/.exec(inlineScript)![1].replace(/'/g, '"'),
    ) as Record<string, string>;
    expect(modes).toEqual(Object.fromEntries(THEMES.map((t) => [t.id, t.mode])));
  });

  it("a light theme on a Dark Mac starts light, with no inline text colour", () => {
    macAppearance(true);
    for (const id of ["default-light", "sand", "lavender"]) {
      resetDocument();
      localStorage.setItem("themeId", id);
      runIndexScript();
      expect(document.documentElement.classList.contains("dark"), id).toBe(false);
      expect(document.body.style.color, id).toBe("");
      expect(document.documentElement.style.backgroundColor, id).toBe("");
    }
  });

  it("a dark theme on a Light Mac starts dark", () => {
    macAppearance(false);
    localStorage.setItem("themeId", "nord");
    runIndexScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.body.style.color).toBe("");
  });

  it("with no theme stored, follows the Mac", () => {
    macAppearance(true);
    runIndexScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    resetDocument();
    macAppearance(false);
    runIndexScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("ignores the old dark-mode key", () => {
    macAppearance(false);
    localStorage.setItem("darkMode", "true");
    localStorage.setItem("themeId", "default-light");
    runIndexScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("stored theme applied at launch", () => {
  it("before a theme is chosen, the default matching the Mac", () => {
    macAppearance(true);
    expect(storedThemeId()).toBe("default-dark");
    macAppearance(false);
    expect(storedThemeId()).toBe("default-light");
    localStorage.setItem("themeId", "no-such-theme");
    expect(storedThemeId()).toBe("default-light");
    localStorage.setItem("themeId", "sand");
    expect(storedThemeId()).toBe("sand");
  });

  it("Default Light on a Dark Mac, with the old darkMode=true: light on screen and highlighted", () => {
    macAppearance(true);
    localStorage.setItem("themeId", "default-light");
    localStorage.setItem("darkMode", "true");
    runIndexScript();
    syncAppearanceFromStorage();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(useAppStore.getState().themeId).toBe("default-light");
    expect(useAppStore.getState().darkMode).toBe(false);
    expect(localStorage.getItem("darkMode")).toBeNull();
  });

  it("a fresh install on a Dark Mac shows and highlights Default Dark", () => {
    macAppearance(true);
    runIndexScript();
    expect(document.documentElement.style.backgroundColor).not.toBe("");
    syncAppearanceFromStorage();
    expect(useAppStore.getState().themeId).toBe("default-dark");
    expect(useAppStore.getState().darkMode).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // The early background gives way to the theme's tokens.
    expect(document.documentElement.style.backgroundColor).toBe("");
  });

  it("a theme picked in Settings is the one applied after a restart", () => {
    macAppearance(true);
    useAppStore.getState().setTheme("sand");
    // Restart: a fresh document, the same localStorage.
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("style");
    runIndexScript();
    syncAppearanceFromStorage();
    expect(useAppStore.getState().themeId).toBe("sand");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--color-text")).not.toBe("");
  });
});
