import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

const start = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../hooks/useStartAgentOn", async () => {
  const { useAppStore } = await import("../stores/app-store");
  return { useStartAgentOn: () => ({ enabled: useAppStore((s) => s.agentsEnabled), start }) };
});

import { TasksPage } from "../pages/TasksPage";
import { ProjectsPage } from "../pages/ProjectsPage";
import { ProjectTasksSection } from "../components/project/ProjectTasksSection";

const project = {
  id: 1, client_id: "c1", name: "Brand Refresh", description: "", status: "active",
  start_date: null, deadline: null, notes: "", layout_config: null, folder_path: null, created_at: "", updated_at: "",
};
const task = {
  id: 7, project_id: 1, title: "Kickoff call", description: "", status: "todo", priority: "low",
  due_date: null, end_date: null, start_time: null, end_time: null, reminder: null,
  scheduled_start: null, scheduled_end: null, calendar_event_id: null, notes: "", planned_minutes: null,
  tracked_minutes: 0, workload_cells: "{}", workload_sort_order: 0, sort_order: 0, created_at: "", updated_at: "",
};
const subtask = {
  id: 9, task_id: 7, title: "Book the room", status: "todo", due_date: null, end_date: null, start_time: null,
  end_time: null, reminder: null, calendar_event_id: null, sort_order: 0, created_at: "", updated_at: "",
};

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const ITEM = "Start work with agent";

beforeEach(async () => {
  await getDb();
  start.mockClear();
  useAppStore.setState({ language: "EN", agentsEnabled: true });
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM tasks t")) return [task];
    if (flat.includes("FROM subtasks")) return [subtask];
    if (flat.includes("FROM projects")) return [project];
    return [];
  });
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("Start work with agent in menus", () => {
  it("Tasks page: a task row's menu starts an agent on the task", async () => {
    wrap(<TasksPage />);
    fireEvent.contextMenu(await screen.findByText("Kickoff call"));
    fireEvent.click(await screen.findByRole("menuitem", { name: ITEM }));
    expect(start).toHaveBeenCalledWith({ kind: "task", id: 7 });
  });

  it("Tasks page: the project header's menu starts an agent on the project", async () => {
    wrap(<TasksPage />);
    await screen.findByText("Kickoff call");
    // The group header is the first "Brand Refresh" on the page.
    fireEvent.contextMenu(screen.getAllByText("Brand Refresh")[0]);
    fireEvent.click(await screen.findByRole("menuitem", { name: ITEM }));
    expect(start).toHaveBeenCalledWith({ kind: "project", id: 1 });
  });

  it("Tasks page: no item while agents are off", async () => {
    useAppStore.setState({ agentsEnabled: false });
    wrap(<TasksPage />);
    fireEvent.contextMenu(await screen.findByText("Kickoff call"));
    await screen.findAllByRole("menuitem");
    expect(screen.queryByRole("menuitem", { name: ITEM })).toBeNull();
  });

  it("Projects page: a project row's menu starts an agent on the project", async () => {
    wrap(<ProjectsPage />);
    fireEvent.contextMenu(await screen.findByText("Brand Refresh"));
    fireEvent.click(await screen.findByRole("menuitem", { name: ITEM }));
    expect(start).toHaveBeenCalledWith({ kind: "project", id: 1 });
  });

  it("Project Tasks section: task and subtask rows get the item", async () => {
    wrap(
      <ProjectTasksSection projectId={1} project={{ name: "Brand Refresh" }} tasks={[task as never]} allSubtasks={[subtask as never]} />,
    );
    fireEvent.contextMenu(screen.getByText("Kickoff call"));
    fireEvent.click(await screen.findByRole("menuitem", { name: ITEM }));
    expect(start).toHaveBeenCalledWith({ kind: "task", id: 7 });

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.contextMenu(await screen.findByText("Book the room"));
    fireEvent.click(await screen.findByRole("menuitem", { name: ITEM }));
    expect(start).toHaveBeenCalledWith({ kind: "subtask", id: 9 });
  });

  it("Project Tasks section: no menu while agents are off", async () => {
    useAppStore.setState({ agentsEnabled: false });
    wrap(<ProjectTasksSection projectId={1} project={{ name: "Brand Refresh" }} tasks={[task as never]} allSubtasks={[]} />);
    fireEvent.contextMenu(screen.getByText("Kickoff call"));
    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});
