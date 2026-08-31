import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("collapses and expands via the footer toggle", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    expect(screen.getByTestId("brand-mark")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand sidebar/i }));
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });

  it("renders the wordmark logo", () => {
    renderSidebar();
    expect(screen.getByRole("img", { name: "StudioManager" })).toBeInTheDocument();
    expect(screen.getByTestId("brand-wordmark")).toBeInTheDocument();
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

  it("shows the compact brand mark instead of the wordmark when collapsed", () => {
    useAppStore.setState({ sidebarCollapsed: true });
    renderSidebar();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByTestId("brand-wordmark")).not.toBeInTheDocument();
    expect(screen.getByTestId("brand-mark")).toBeInTheDocument();
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
