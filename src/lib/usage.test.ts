import { describe, expect, it } from "vitest";
import { uiLabels } from "../i18n/ui";
import { scopeName, usageWindowLabel } from "./usage";

describe("usageWindowLabel", () => {
  it("names the windows in both languages", () => {
    const { EN, FR } = uiLabels;
    expect(usageWindowLabel("five_hour", EN)).toBe("5-hour window");
    expect(usageWindowLabel("seven_day", EN)).toBe("Weekly, all models");
    expect(usageWindowLabel("seven_day_opus", EN)).toBe("Weekly, Opus");
    expect(usageWindowLabel("seven_day_claude_design", EN)).toBe("Weekly, Claude Design");
    expect(usageWindowLabel("five_hour", FR)).toBe("Fenetre de 5 heures");
    expect(usageWindowLabel("seven_day_opus", FR)).toBe("Hebdo, Opus");
  });

  it("capitalises each word of a scope", () => {
    expect(scopeName("seven_day_opus_4_5")).toBe("Opus 4 5");
  });
});
