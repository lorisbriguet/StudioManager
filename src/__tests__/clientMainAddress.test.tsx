import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ClientDetailPage } from "../pages/ClientDetailPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

// The separate "Main address" card is hidden when an address row repeats it
// (#65), so that row carries the tag instead (UI test P3: Helvetica's HQ).

const client = { id: "c1", name: "Helvetica Studio AG", language: "EN", has_discount: 0, email: "", phone: "", notes: "", address_line1: "Rue 1", address_line2: "", postal_city: "1000 Lausanne" };
const hq = { id: 1, client_id: "c1", label: "HQ", billing_name: "", address_line1: "Rue 1", address_line2: "", postal_city: "1000 Lausanne" };
const branch = { id: 2, client_id: "c1", label: "Branch", billing_name: "", address_line1: "Quai 9", address_line2: "", postal_city: "1200 Genève" };

function renderPage(addresses: object[]) {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM client_addresses")) return addresses;
    if (flat.includes("FROM client_contacts")) return [];
    if (flat.includes("FROM clients")) return [client];
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1"]}>
        <Routes>
          <Route path="/clients/:id" element={<ClientDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("client addresses: main address tag", () => {
  it("tags the address row that is the main address, once", async () => {
    renderPage([hq, branch]);
    await screen.findByText("Quai 9");
    const tags = screen.getAllByText("Main address");
    expect(tags).toHaveLength(1);
    const hqCard = screen.getByText("HQ").closest(".group") as HTMLElement;
    expect(within(hqCard).getByText("Main address")).toBeTruthy();
  });

  it("keeps the separate Main card when no row repeats it", async () => {
    renderPage([branch]);
    await screen.findByText("Quai 9");
    expect(screen.getAllByText("Main address")).toHaveLength(1);
    expect(screen.getByText("Rue 1")).toBeTruthy();
  });
});
