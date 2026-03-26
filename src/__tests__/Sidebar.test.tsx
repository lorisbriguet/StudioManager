import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "../components/layout/Sidebar";
import { useAppStore } from "../stores/app-store";

// Mock the notification hook to avoid DB calls
vi.mock("../db/hooks/useNotifications", () => ({
  useUnreadNotificationCount: () => ({ data: 3 }),
}));

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    useAppStore.setState({ sidebarCollapsed: false, showTasksPage: true });
  });

  it("renders the app name", () => {
    renderSidebar();
    expect(screen.getByText("StudioManager")).toBeInTheDocument();
  });

  it("renders all main navigation links", () => {
    renderSidebar();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Clients")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Invoices")).toBeInTheDocument();
    expect(screen.getByText("Expenses")).toBeInTheDocument();
  });

  it("shows notification badge with unread count", () => {
    renderSidebar();
    // The badge shows "3" (from our mock)
    const badges = screen.getAllByText("3");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("hides labels when collapsed", () => {
    useAppStore.setState({ sidebarCollapsed: true });
    renderSidebar();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("StudioManager")).not.toBeInTheDocument();
  });

  it("hides Tasks link when showTasksPage is false", () => {
    useAppStore.setState({ showTasksPage: false });
    renderSidebar();
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
  });

  it("shows Tasks link when showTasksPage is true", () => {
    useAppStore.setState({ showTasksPage: true });
    renderSidebar();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });
});
