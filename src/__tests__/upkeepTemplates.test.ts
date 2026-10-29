import { describe, it, expect } from "vitest";
import { MACHINE_TEMPLATES } from "../lib/upkeep/templates";
import { uiLabels } from "../i18n/ui";

describe("MACHINE_TEMPLATES", () => {
  it("every template item has EN and FR text", () => {
    for (const tpl of MACHINE_TEMPLATES) {
      for (const it of tpl.items) {
        expect(uiLabels.EN[it.titleKey], it.titleKey).toBeTruthy();
        expect(uiLabels.FR[it.titleKey], it.titleKey).toBeTruthy();
      }
    }
  });

  it("covers the v1 set and every non-generic template has items", () => {
    expect(MACHINE_TEMPLATES.map((t) => t.key)).toEqual([
      "nas", "printer_3d", "printer_photo", "monitor", "camera", "computer", "generic",
    ]);
    for (const tpl of MACHINE_TEMPLATES) {
      if (tpl.key !== "generic") expect(tpl.items.length).toBeGreaterThan(0);
    }
  });

  it("usage items only on templates with a usage metric", () => {
    for (const tpl of MACHINE_TEMPLATES) {
      const usage = tpl.items.filter((i) => i.schedule === "usage");
      if (tpl.key !== "printer_3d") expect(usage).toEqual([]);
      for (const u of usage) expect(u.usage_every).toBeGreaterThan(0);
      for (const i of tpl.items.filter((x) => x.schedule === "interval")) {
        expect(i.interval_n).toBeGreaterThan(0);
        expect(i.interval_unit).toBeTruthy();
      }
    }
  });

  it("matches the spec examples", () => {
    const nas = MACHINE_TEMPLATES.find((t) => t.key === "nas")!;
    expect(nas.items.map((i) => [i.interval_n, i.interval_unit])).toEqual([
      [3, "month"], [1, "month"], [1, "month"], [6, "month"],
    ]);
    const p = MACHINE_TEMPLATES.find((t) => t.key === "printer_3d")!;
    expect(p.items.map((i) => [i.schedule, i.usage_every ?? i.interval_n])).toEqual([
      ["usage", 200], ["usage", 50], ["interval", 6],
    ]);
  });
});
