import { describe, it, expect } from "vitest";
import {
  getNamedTagColor,
  getStoredTagColor,
  normalizeTagColorName,
  TAG_COLOR_NAMES,
} from "../lib/tagColors";

describe("normalizeTagColorName", () => {
  it("passes every canonical name through unchanged", () => {
    for (const name of TAG_COLOR_NAMES) {
      expect(normalizeTagColorName(name)).toBe(name);
    }
  });

  it("maps legacy brown to orange", () => {
    expect(normalizeTagColorName("brown")).toBe("orange");
  });

  it("maps legacy pink to red", () => {
    expect(normalizeTagColorName("pink")).toBe("red");
  });

  it("falls back to gray for unknown names", () => {
    expect(normalizeTagColorName("magenta")).toBe("gray");
  });

  it("falls back to gray for null, undefined, and empty string", () => {
    expect(normalizeTagColorName(null)).toBe("gray");
    expect(normalizeTagColorName(undefined)).toBe("gray");
    expect(normalizeTagColorName("")).toBe("gray");
  });
});

describe("getStoredTagColor", () => {
  it("returns defined colors for legacy names in light mode", () => {
    for (const legacy of ["brown", "pink"]) {
      const c = getStoredTagColor(legacy, false);
      expect(c.bg).toBeTruthy();
      expect(c.text).toBeTruthy();
    }
  });

  it("returns defined colors for legacy names in dark mode", () => {
    for (const legacy of ["brown", "pink"]) {
      const c = getStoredTagColor(legacy, true);
      expect(c.bg).toBeTruthy();
      expect(c.text).toBeTruthy();
    }
  });

  it("renders legacy names identically to their mapped canonical name", () => {
    expect(getStoredTagColor("brown", false)).toEqual(getNamedTagColor("orange", false));
    expect(getStoredTagColor("pink", true)).toEqual(getNamedTagColor("red", true));
  });
});

describe("TAG_COLOR_NAMES / getNamedTagColor coverage", () => {
  it("every canonical name yields a defined color in both modes", () => {
    for (const name of TAG_COLOR_NAMES) {
      for (const dark of [false, true]) {
        const c = getNamedTagColor(name, dark);
        expect(c).toBeDefined();
        expect(c.bg).toMatch(/^#/);
        expect(c.text).toMatch(/^#/);
      }
    }
  });

  it("canonical names map to distinct colors", () => {
    const bgs = TAG_COLOR_NAMES.map((n) => getNamedTagColor(n, false).bg);
    expect(new Set(bgs).size).toBe(TAG_COLOR_NAMES.length);
  });
});
