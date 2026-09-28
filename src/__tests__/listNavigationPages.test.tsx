import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ClientsPage } from "../pages/ClientsPage";
import { ProjectsPage } from "../pages/ProjectsPage";
import { TasksPage } from "../pages/TasksPage";
import { IncomePage } from "../pages/IncomePage";
import { ExpensesPage } from "../pages/ExpensesPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler, clearExecutedStatements } from "../__mocks__/tauri-sql";

// Receipt OCR/PDF extraction is irrelevant to the Income/Expenses cases below.
vi.mock("../lib/pdfExtract", () => ({
  extractPdfText: vi.fn(),
  extractImageText: vi.fn(),
}));

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

  // Item 2 — the peek panel is not role="dialog", so the list stayed
  // mounted underneath it and the hook kept handling keys: ArrowDown moved
  // the focus ring on a card hidden behind the peek, Space opened a context
  // menu on it, and Enter swapped the peek to a different project.
  it("does not move the focus ring while the side peek panel is open", async () => {
    useAppStore.setState({ projectOpenMode: "peek" });
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM projects")) return [projectA, projectB];
      if (flat.includes("FROM clients")) return [clientA];
      if (flat.includes("FROM tasks")) return [];
      if (flat.includes("FROM subtasks")) return [];
      return [];
    });

    renderRoute(<ProjectsPage />, "/projects", "/projects/:id", "project-detail");

    const cardA = (await screen.findByText("Website Revamp")).closest("[data-list-row]") as HTMLElement;
    fireEvent.click(cardA);

    // Peek panel open — its "open full page" link only renders inside it.
    await screen.findByTitle("Open full page");
    expect(cardA.className).not.toContain("ring-2");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(cardA.className).not.toContain("ring-2");
  });
});

// Task 6 — Tasks is the last page and the only grouped one: the cycle must
// skip collapsed projects' tasks entirely (they're not even rendered).
describe("TasksPage arrow-key navigation", () => {
  const projectA = {
    id: 1,
    client_id: "C-001",
    name: "Project A",
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
  const projectB = { ...projectA, id: 2, name: "Project B" };

  function makeTask(id: number, project_id: number, title: string) {
    return {
      id,
      project_id,
      title,
      description: "",
      status: "todo" as const,
      priority: "low" as const,
      due_date: null,
      end_date: null,
      start_time: null,
      end_time: null,
      reminder: null,
      scheduled_start: null,
      scheduled_end: null,
      calendar_event_id: null,
      notes: "",
      planned_minutes: null,
      tracked_minutes: 0,
      workload_cells: "{}",
      workload_sort_order: 0,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    };
  }

  const taskA1 = makeTask(1, 1, "Task A1");
  const taskA2 = makeTask(2, 1, "Task A2");
  const taskB1 = makeTask(3, 2, "Task B1");
  const taskB2 = makeTask(4, 2, "Task B2");

  function renderTasksPage() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TasksPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("cycles focus over the expanded project's tasks only, skipping the collapsed project, and Enter opens the focused task", async () => {
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM tasks t")) return [taskA1, taskA2, taskB1, taskB2];
      if (flat.includes("FROM projects")) return [projectA, projectB];
      return [];
    });

    renderTasksPage();

    await screen.findByText("Task A1");

    // Collapse Project B — click the group header's toggle button, not the
    // project name (a Link that stops propagation so it can navigate).
    const projectBHeader = screen.getByText("Project B").closest("button")!;
    fireEvent.click(projectBHeader);
    expect(screen.queryByText("Task B1")).not.toBeInTheDocument();

    const rowA1 = screen.getByText("Task A1").closest("[data-list-row]") as HTMLElement;
    const rowA2 = screen.getByText("Task A2").closest("[data-list-row]") as HTMLElement;
    expect(rowA1.className).not.toContain("ring-2");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(rowA1.className).toContain("ring-2");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(rowA2.className).toContain("ring-2");
    expect(rowA1.className).not.toContain("ring-2");

    // Two more ArrowDown presses: Project B's tasks are excluded from the
    // cycle entirely, so focus clamps on Task A2 instead of moving into them.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(rowA2.className).toContain("ring-2");

    // Enter opens the focused task — it expands to reveal its subtask composer.
    expect(screen.queryByPlaceholderText("New subtask...")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(await screen.findByPlaceholderText("New subtask...")).toBeInTheDocument();
  });
});

// Item 2 (extra finding) — ReceiptPreview is the same shape of hazard as the
// Projects peek panel: a fixed, full-screen overlay with no role="dialog",
// opened while the row list stays mounted underneath it. Income and
// Expenses both wire useListNavigation unconditionally, so ArrowDown/Enter/
// Space kept acting on the hidden list while the receipt preview was open.
describe("IncomePage arrow-key navigation — receipt preview overlay", () => {
  const income = {
    id: 1,
    reference: "INC-0001",
    source: "Freelance gig",
    description: "",
    category: "other",
    date: "2026-01-10",
    amount: 100,
    receipt_path: "/tmp/receipt.jpg",
    notes: "",
    created_at: "",
    updated_at: "",
  };

  function renderIncomePage() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <IncomePage />
      </QueryClientProvider>
    );
  }

  it("does not move the focus ring while the receipt preview is open", async () => {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM income")) return [income];
      return [];
    });

    renderIncomePage();

    const row = (await screen.findByText("Freelance gig")).closest("[data-list-row]") as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: /^view$/i }));

    // Preview overlay open — its header shows the reference.
    await screen.findByRole("heading", { name: "INC-0001" });
    expect(row.className).not.toContain("ring-2");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(row.className).not.toContain("ring-2");
  });
});

describe("ExpensesPage arrow-key navigation — receipt preview overlay", () => {
  const expense = {
    id: 1,
    reference: "EXP-0001",
    supplier: "ACME",
    category_code: "FA",
    invoice_date: "2026-01-10",
    due_date: null,
    amount: 42,
    paid_date: null,
    receipt_path: "/tmp/receipt.jpg",
    notes: "",
    created_at: "",
    updated_at: "",
  };

  function renderExpensesPage() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <ExpensesPage />
      </QueryClientProvider>
    );
  }

  it("does not move the focus ring while the receipt preview is open", async () => {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM expenses")) return [expense];
      return [];
    });

    renderExpensesPage();

    const row = (await screen.findByText("ACME")).closest("[data-list-row]") as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: /^view$/i }));

    await screen.findByRole("heading", { name: "EXP-0001" });
    expect(row.className).not.toContain("ring-2");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(row.className).not.toContain("ring-2");
  });
});
