import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ClientsPage } from "../pages/ClientsPage";
import { ProjectsPage } from "../pages/ProjectsPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler, clearExecutedStatements } from "../__mocks__/tauri-sql";

// Task 5 — arrow-key row navigation on Clients and Projects, mirroring the
// finance pages (Invoices/Quotes/Expenses/Income) that already wire
// useListNavigation.

function renderRoute(ui: React.ReactElement, path: string, detailPath: string, detailTestId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path={detailPath} element={<div data-testid={detailTestId} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const clientA = {
  id: "C-001",
  name: "Alpha Co",
  billing_name: "Alpha Co",
  address_line1: "",
  address_line2: "",
  postal_city: "",
  email: "",
  phone: "",
  language: "EN" as const,
  has_discount: 0,
  discount_rate: 0,
  notes: "",
  created_at: "",
  updated_at: "",
};
const clientB = { ...clientA, id: "C-002", name: "Beta Inc" };

const projectA = {
  id: 1,
  client_id: "C-001",
  name: "Website Revamp",
  description: "",
  status: "active" as const,
  start_date: null,
  deadline: null,
  notes: "",
  layout_config: null,
  folder_path: null,
  created_at: "",
  updated_at: "",
};
const projectB = { ...projectA, id: 2, name: "Brand Refresh" };

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  clearExecutedStatements();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("ClientsPage arrow-key navigation", () => {
  it("moves focus with ArrowDown, opens the row's menu with Space, and the client with Enter", async () => {
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM clients")) return [clientA, clientB];
      if (flat.includes("FROM projects")) return [];
      return [];
    });

    renderRoute(<ClientsPage />, "/clients", "/clients/:id", "client-detail");

    const rowA = (await screen.findByText("Alpha Co")).closest("tr")!;
    expect(rowA.className).not.toContain("ring-2");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(rowA.className).toContain("ring-2");

    fireEvent.keyDown(window, { key: " " });
    expect(await screen.findByRole("menuitem", { name: /view details/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Enter" });
    expect(await screen.findByTestId("client-detail")).toBeInTheDocument();
  });
});

describe("ProjectsPage arrow-key navigation", () => {
  it("moves focus with ArrowDown over the cards and opens the project on Enter", async () => {
    useAppStore.setState({ projectOpenMode: "page" });
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM projects")) return [projectA, projectB];
      if (flat.includes("FROM clients")) return [clientA];
      if (flat.includes("FROM tasks")) return [];
      if (flat.includes("FROM subtasks")) return [];
      return [];
    });

    renderRoute(<ProjectsPage />, "/projects", "/projects/:id", "project-detail");

    const cardA = (await screen.findByText("Website Revamp")).closest("[data-list-row]") as HTMLElement | null;
    expect(cardA).not.toBeNull();
    expect(cardA!.className).not.toContain("ring-2");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(cardA!.className).toContain("ring-2");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(await screen.findByTestId("project-detail")).toBeInTheDocument();
  });
});
