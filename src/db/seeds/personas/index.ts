import type Database from "@tauri-apps/plugin-sql";
import { splitSeedStatements } from "../splitSql";
import { seedUserGuide } from "../user-guide";

export type PersonaId = "designer";

export interface Persona {
  id: PersonaId;
  labelKey: "persona_designer" | "persona_music";
  /** Organisation preferences the demo app applies after loading. */
  prefs: { showIncome: boolean; showTasksPage: boolean };
  /** config.sql — business profile + activities (demo build only). */
  config: () => Promise<string>;
  /** data.sql — a year of demo data; never touches configuration tables. */
  data: () => Promise<string>;
}

const raw = (m: Promise<{ default: string }>) => m.then((x) => x.default);

export const PERSONAS: Record<PersonaId, Persona> = {
  designer: {
    id: "designer",
    labelKey: "persona_designer",
    prefs: { showIncome: false, showTasksPage: true },
    config: () => raw(import("./designer/config.sql?raw")),
    data: () => raw(import("./designer/data.sql?raw")),
  },
};

export const PERSONA_IDS = Object.keys(PERSONAS) as PersonaId[];

async function runSql(db: Database, sql: string): Promise<void> {
  for (const stmt of splitSeedStatements(sql)) {
    await db.execute(stmt + ";");
  }
}

/**
 * Load a persona into `db`. `withConfig: false` is the real app's presentation
 * mode (the owner keeps their own profile and activities); `true` is the demo
 * app, which has no profile of its own. The built-in user guide is re-seeded
 * afterwards because data.sql wipes the wiki.
 */
export async function seedPersona(db: Database, id: PersonaId, opts: { withConfig: boolean }): Promise<void> {
  const persona = PERSONAS[id];
  if (opts.withConfig) await runSql(db, await persona.config());
  await runSql(db, await persona.data());
  await seedUserGuide(db);
}
