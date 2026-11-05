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

let overdueCount = 0;
vi.mock("../db/hooks/useUpkeep", () => ({
  useUpkeepOverview: () => ({ overdueCount }),
}));

let inboxStates: ("new" | "dismissed")[] = [];
vi.mock("../db/hooks/usePaperlessInbox", () => ({
  usePaperlessInbox: () => ({ items: inboxStates.map((state, docId) => ({ docId, state })) }),
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

  it("shows Agents only when the agents switch is on", () => {
    useAppStore.setState({ agentsEnabled: false });
    const { unmount } = renderSidebar();
    expect(screen.queryByText("Agents")).not.toBeInTheDocument();
    unmount();
    useAppStore.setState({ agentsEnabled: true });
    renderSidebar();
    expect(screen.getByText("Agents")).toBeInTheDocument();
    useAppStore.setState({ agentsEnabled: false });
  });

  it("hides Network when the switch is off", () => {
    useAppStore.setState({ showNetworkPage: false });
    renderSidebar();
    expect(screen.queryByText("Network")).toBeNull();
  });

  it("shows Network right after Agents when on", () => {
    useAppStore.setState({ agentsEnabled: true, showNetworkPage: true });
    renderSidebar();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.indexOf("/network")).toBe(hrefs.indexOf("/agents") + 1);
    useAppStore.setState({ agentsEnabled: false, showNetworkPage: false });
  });

  it("shows notification badge with unread count", () => {
    renderSidebar();
    // The badge shows "3" (from our mock)
    // Exactly one: on the icon, not repeated next to the label.
    expect(screen.getAllByText("3")).toHaveLength(1);
  });

  it("shows the overdue upkeep count on the Upkeep link and hides it at 0", () => {
    overdueCount = 2;
    const { unmount } = renderSidebar();
    const link = screen.getByRole("link", { name: /Upkeep/ });
    expect(link).toHaveAttribute("href", "/upkeep");
    expect(link).toHaveTextContent("2");
    unmount();
    overdueCount = 0;
    renderSidebar();
    expect(screen.getByRole("link", { name: /Upkeep/ })).not.toHaveTextContent(/\d/);
  });

  it("counts the Paperless documents waiting to be checked on the Expenses link", () => {
    inboxStates = ["new", "dismissed", "new"];
    const { unmount } = renderSidebar();
    expect(screen.getByRole("link", { name: /Expenses/ })).toHaveTextContent("2");
    unmount();
    inboxStates = ["dismissed"];
    renderSidebar();
    expect(screen.getByRole("link", { name: /Expenses/ })).not.toHaveTextContent(/\d/);
    inboxStates = [];
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
