import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// A real SQLite (src-tauri migrations + ensureSchema), reopened to stand in
// for an app restart: seed data and the address copy must run once per
// database file, so what the user deletes stays deleted.
vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({
  seedUserGuide: async (db: { execute: (sql: string) => Promise<unknown> }) => {
    await db.execute("INSERT INTO wiki_folders (name) VALUES ('User Guide')");
  },
}));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";
import { closeDb, getDb } from "../db/index";
import * as q from "../db/queries/clients";
import { useDeleteClientAddress } from "../db/hooks/useClients";
import { useUndoStore } from "../stores/undo-store";
import { useAppStore } from "../stores/app-store";
import type { Client } from "../types/client";

const count = (table: string, where = "1") =>
  (rawDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
const run = (sql: string, ...params: (string | number)[]) => rawDb().prepare(sql).run(...params);
const own = (id: string) =>
  rawDb().prepare("SELECT address_line1, address_line2, postal_city FROM clients WHERE id = ?").get(id);

/** Close and reopen the connection: ensureSchema runs again, as at app start. */
async function restart() {
  await closeDb();
  await getDb();
}

const SEEDED = ["resources", "dashboard_presets", "workload_templates", "invoice_templates", "wiki_folders"];

function client(over: Partial<Client> = {}): Omit<Client, "created_at" | "updated_at"> {
  return {
    id: "C-001",
    name: "ACME",
    billing_name: "ACME SA",
    address_line1: "Rue du Lac 1",
    address_line2: "",
    postal_city: "1200 Genève",
    email: "",
    phone: "",
    language: "FR",
    has_discount: 0,
    discount_rate: 0,
    notes: "",
    ...over,
  } as Omit<Client, "created_at" | "updated_at">;
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  useAppStore.setState({ language: "EN" });
  useUndoStore.setState({ stack: [], redoStack: [] });
  await freshRealDb();
});

describe("seed data", () => {
  it("fills a new database once and records it", () => {
    for (const t of SEEDED) expect(count(t), t).toBeGreaterThan(0);
    const keys = (rawDb().prepare("SELECT key FROM meta ORDER BY key").all() as { key: string }[]).map((r) => r.key);
    expect(keys).toEqual([
      "moved:client_addresses",
      "schema_fixups",
      "seeded:dashboard_presets",
      "seeded:invoice_templates",
      "seeded:resources",
      "seeded:wiki_guide",
      "seeded:workload_templates",
    ]);
  });

  it("does not come back after the user empties the tables", async () => {
    run("DELETE FROM resources");
    run("DELETE FROM dashboard_presets");
    run("DELETE FROM workload_templates");
    run("DELETE FROM invoice_templates");
    run("DELETE FROM wiki_folders");
    await restart();
    for (const t of SEEDED) expect(count(t), t).toBe(0);
  });

  it("does not come back in a database the previous version already opened", async () => {
    // Opened by the old code: its tables exist, but nothing is recorded yet.
    run("DELETE FROM meta");
    run("DELETE FROM resources");
    run("DELETE FROM dashboard_presets");
    await restart();
    expect(count("resources")).toBe(0);
    expect(count("dashboard_presets")).toBe(0);
    expect(count("meta", "key = 'seeded:resources'")).toBe(1);
  });
});

describe("client addresses", () => {
  it("gives a new client its Main address straight away", async () => {
    await q.createClient(client());
    const rows = rawDb().prepare("SELECT label, billing_name, address_line1, postal_city FROM client_addresses").all();
    expect(rows).toEqual([{ label: "Main", billing_name: "ACME SA", address_line1: "Rue du Lac 1", postal_city: "1200 Genève" }]);
    await restart();
    expect(count("client_addresses")).toBe(1);
  });

  it("adds no address row for a client created without one", async () => {
    await q.createClient(client({ address_line1: "", postal_city: "" }));
    expect(count("client_addresses")).toBe(0);
  });

  it("copies an old client's address once, and a deleted copy stays deleted", async () => {
    run("DELETE FROM meta WHERE key = 'moved:client_addresses'");
    run("INSERT INTO clients (id, name, address_line1, postal_city) VALUES ('C-009', 'Old', 'Quai 3', '1003 Lausanne')");
    await restart();
    const addr = rawDb().prepare("SELECT * FROM client_addresses WHERE client_id = 'C-009'").get() as { id: number; label: string };
    expect(addr.label).toBe("Main");

    const { result } = renderHook(() => useDeleteClientAddress(), { wrapper });
    await result.current.mutateAsync({ id: addr.id, clientId: "C-009" });
    expect(own("C-009")).toEqual({ address_line1: "", address_line2: "", postal_city: "" });

    await restart();
    expect(count("client_addresses", "client_id = 'C-009'")).toBe(0);
  });

  it("undo brings the address and the client's own address back, redo clears both again", async () => {
    await q.createClient(client());
    const id = (rawDb().prepare("SELECT id FROM client_addresses").get() as { id: number }).id;
    const { result } = renderHook(() => useDeleteClientAddress(), { wrapper });
    await result.current.mutateAsync({ id, clientId: "C-001" });

    const action = useUndoStore.getState().stack[0];
    await action.execute();
    expect(count("client_addresses")).toBe(1);
    expect(own("C-001")).toEqual({ address_line1: "Rue du Lac 1", address_line2: "", postal_city: "1200 Genève" });

    await action.redo!();
    expect(count("client_addresses")).toBe(0);
    expect(own("C-001")).toEqual({ address_line1: "", address_line2: "", postal_city: "" });
  });

  it("keeps the client's own address when another of several addresses is deleted", async () => {
    await q.createClient(client());
    const officeId = await q.createClientAddress({
      client_id: "C-001", label: "Office", billing_name: "", address_line1: "Av. 9", address_line2: "", postal_city: "8000 Zürich",
    });
    const { result } = renderHook(() => useDeleteClientAddress(), { wrapper });
    await result.current.mutateAsync({ id: officeId, clientId: "C-001" });
    expect(own("C-001")).toEqual({ address_line1: "Rue du Lac 1", address_line2: "", postal_city: "1200 Genève" });
  });
});
