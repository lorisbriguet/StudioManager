import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { getDb } from "../db";
import { setSelectHandler, clearExecutedStatements } from "../__mocks__/tauri-sql";
import { renderWidget } from "../components/dashboard/widgets";
import { useClients } from "../db/hooks/useClients";

// Audit P1: the dashboard's "recent invoices" widget used to run its own
// inline `useQuery({ queryKey: ["clients"], ... })` selecting only
// `id, name` from the DB. That shares a cache entry with useClients()'s
// `SELECT * FROM clients` (used by the Clients page and everywhere else),
// so once the dashboard had rendered, the Clients page's own `["clients"]`
// query read back the truncated rows already sitting in the cache — every
// other column (language, address, notes, ...) came back undefined until a
// background refetch eventually replaced the entry.

const FULL_CLIENT_ROW = {
  id: "C-001",
  name: "Atelier Noir",
  billing_name: "Atelier Noir Sarl",
  address_line1: "Rue du Rhone 1",
  address_line2: "",
  postal_city: "1200 Geneve",
  email: "contact@atelier-noir.ch",
  phone: "",
  language: "FR",
  has_discount: 0,
  discount_rate: 0,
  notes: "",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

function installSelectHandler() {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ").trim();
    // The widget's old inline query, if it still exists — deliberately
    // returns a truncated row so we can prove whether it ever reaches the
    // shared cache entry.
    if (flat === "SELECT id, name FROM clients") {
      return [{ id: FULL_CLIENT_ROW.id, name: FULL_CLIENT_ROW.name }];
    }
    if (flat.includes("FROM clients")) return [FULL_CLIENT_ROW];
    if (flat.includes("FROM invoices")) return [];
    return [];
  });
}

/** Minimal stand-in for the Clients page: reads the same shared hook. */
function ClientsListProbe() {
  const { data: clients } = useClients();
  return (
    <ul>
      {(clients ?? []).map((c) => (
        <li key={c.id} data-testid={`client-${c.id}`}>
          {c.name}:{c.language ?? "MISSING"}
        </li>
      ))}
    </ul>
  );
}

beforeAll(async () => {
  // Warm the DB singleton so ensureSchema noise doesn't pollute the SQL log.
  await getDb();
});

beforeEach(() => {
  clearExecutedStatements();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("dashboard/clients [\"clients\"] cache key collision", () => {
  it("does not poison the shared cache entry with the dashboard widget's truncated rows", async () => {
    installSelectHandler();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // 1. Render the dashboard's recent-invoices widget first, exactly as it
    //    would on app start (the dashboard is the default landing page).
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>{renderWidget("recent-invoices")}</MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(qc.getQueryData(["clients"])).toBeDefined();
    });

    // 2. Now render the Clients page's own consumer of the same key against
    //    the SAME QueryClient, simulating navigating to /clients next.
    //    useQuery reads the cache synchronously on mount, so this captures
    //    exactly what the Clients page would paint before any refetch has a
    //    chance to run — the moment the bug report describes.
    render(
      <QueryClientProvider client={qc}>
        <ClientsListProbe />
      </QueryClientProvider>
    );

    expect(screen.getByTestId("client-C-001").textContent).toBe("Atelier Noir:FR");

    const cached = qc.getQueryData<{ language?: string }[]>(["clients"]);
    expect(cached?.[0]?.language).toBe("FR");
  });
});
