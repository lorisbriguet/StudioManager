import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "@tauri-apps/plugin-sql";
import { executedStatements, clearExecutedStatements } from "../__mocks__/tauri-sql";

vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: vi.fn(async () => {}) }));
import { seedUserGuide } from "../db/seeds/user-guide";
import { PERSONAS, PERSONA_IDS, seedPersona } from "../db/seeds/personas";

beforeEach(() => {
  clearExecutedStatements();
  vi.mocked(seedUserGuide).mockClear();
});

const touches = (table: string) => executedStatements.some((s) => new RegExp(`\\b(UPDATE|INSERT INTO|DELETE FROM)\\s+${table}\\b`, "i").test(s.sql));

describe("persona registry", () => {
  it("lists every persona with its preferences and both layers", () => {
    expect(PERSONA_IDS).toContain("designer");
    for (const id of PERSONA_IDS) {
      const p = PERSONAS[id];
      expect(p.id).toBe(id);
      expect(typeof p.prefs.showIncome).toBe("boolean");
      expect(typeof p.prefs.showTasksPage).toBe("boolean");
      expect(typeof p.config).toBe("function");
      expect(typeof p.data).toBe("function");
    }
  });
});

describe("seedPersona", () => {
  it("runs the config layer, then the data layer, then the user guide", async () => {
    const db = await Database.load("sqlite:test.db");
    await seedPersona(db, "designer", { withConfig: true });
    expect(touches("business_profile")).toBe(true);
    expect(touches("activities")).toBe(true);
    const firstConfig = executedStatements.findIndex((s) => /^UPDATE business_profile/i.test(s.sql));
    const firstData = executedStatements.findIndex((s) => /^DELETE FROM clients/i.test(s.sql));
    expect(firstConfig).toBeGreaterThanOrEqual(0);
    expect(firstData).toBeGreaterThan(firstConfig);
    expect(seedUserGuide).toHaveBeenCalledTimes(1);
  });

  it("leaves configuration alone when withConfig is false", async () => {
    const db = await Database.load("sqlite:test.db");
    await seedPersona(db, "designer", { withConfig: false });
    expect(touches("business_profile")).toBe(false);
    expect(touches("activities")).toBe(false);
    expect(touches("clients")).toBe(true);
    expect(seedUserGuide).toHaveBeenCalledTimes(1);
  });
});
