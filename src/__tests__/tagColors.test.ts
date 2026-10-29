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
  it("returns defined colors for legacy names", () => {
    for (const legacy of ["brown", "pink"]) {
      const c = getStoredTagColor(legacy);
      expect(c.bg).toBeTruthy();
      expect(c.text).toBeTruthy();
    }
  });

  it("renders legacy names identically to their mapped canonical name", () => {
    expect(getStoredTagColor("brown")).toEqual(getNamedTagColor("orange"));
    expect(getStoredTagColor("pink")).toEqual(getNamedTagColor("red"));
  });
});

describe("TAG_COLOR_NAMES / getNamedTagColor coverage", () => {
  it("every canonical name yields its CSS variables", () => {
    for (const name of TAG_COLOR_NAMES) {
      const c = getNamedTagColor(name);
      expect(c.bg).toBe(`var(--color-tag-${name}-bg)`);
      expect(c.text).toBe(`var(--color-tag-${name}-text)`);
    }
  });

  it("canonical names map to distinct colors", () => {
    const bgs = TAG_COLOR_NAMES.map((n) => getNamedTagColor(n).bg);
    expect(new Set(bgs).size).toBe(TAG_COLOR_NAMES.length);
  });
});
