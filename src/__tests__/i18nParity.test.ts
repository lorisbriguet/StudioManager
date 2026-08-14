import { describe, it, expect } from "vitest";
import { uiLabels } from "../i18n/ui";
describe("i18n parity", () => {
  it("EN and FR have identical key sets", () => {
    const en = Object.keys(uiLabels.EN).sort();
    const fr = Object.keys(uiLabels.FR).sort();
    expect(en.length).toBe(fr.length);
    expect(en).toEqual(fr);
  });
});
