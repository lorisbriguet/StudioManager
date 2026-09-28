import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ClientsPage } from "../pages/ClientsPage";
import { ProjectsPage } from "../pages/ProjectsPage";
import { TasksPage } from "../pages/TasksPage";
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
