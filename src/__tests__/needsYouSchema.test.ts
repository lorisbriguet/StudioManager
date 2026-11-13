import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";

beforeEach(async () => {
  await freshRealDb();
});

describe("needs_you schema (migration 018)", () => {
  it("gives a project the agent settings with their defaults", () => {
    const db = rawDb();
    db.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'Studio A')").run();
    db.prepare("INSERT INTO projects (id, client_id, name) VALUES (1, 'c1', 'Identity')").run();

    const row = db.prepare("SELECT * FROM projects WHERE id = 1").get() as Record<string, unknown>;

    expect(row.merge_alone).toBe(0);
    expect(row.hub_project).toBe(0);
    expect(row.check_command).toBeNull();
  });
});
