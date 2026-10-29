import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TasksPage } from "../pages/TasksPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

// First run: "New task" on the empty state asks for a project and shows that
// project's empty group (its add-task row). That placeholder must not stick
// once a filter is active or once a task exists.

const project = {
  id: 1, client_id: "c1", name: "Brand Refresh", description: "", status: "active",
  start_date: null, deadline: null, notes: "", layout_config: null, folder_path: null, created_at: "", updated_at: "",
};
const task = {
  id: 1, project_id: 1, title: "Kickoff call", description: "", status: "todo", priority: "low",
  due_date: null, end_date: null, start_time: null, end_time: null, reminder: null,
  scheduled_start: null, scheduled_end: null, calendar_event_id: null, notes: "", planned_minutes: null,
  tracked_minutes: 0, workload_cells: "{}", workload_sort_order: 0, sort_order: 0, created_at: "", updated_at: "",
};

let tasks: (typeof task)[] = [];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return qc;
}

async function pickStartProject() {
  fireEvent.click(await screen.findByRole("button", { name: "New task..." }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Brand Refresh" }));
  return screen.findByPlaceholderText("New task...");
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  tasks = [];
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM tasks t")) return tasks;
    if (flat.includes("FROM projects")) return [project];
    return [];
  });
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("TasksPage first-run project group", () => {
  it("shows the picked project's empty group, and drops it while a search is active", async () => {
    renderPage();
    await pickStartProject();
    fireEvent.change(screen.getByPlaceholderText("Search tasks..."), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.queryByPlaceholderText("New task...")).toBeNull());
  });

  it("is reset once the first task exists: a filter that hides it shows 'no matching tasks'", async () => {
    const qc = renderPage();
    await pickStartProject();
    tasks = [task];
    await qc.invalidateQueries();
    await screen.findByText("Kickoff call");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("No matching tasks")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("New task...")).toBeNull();
  });
});
