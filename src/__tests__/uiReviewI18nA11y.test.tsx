import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useId, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useAppStore, syncAppearanceFromStorage } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";
import { TasksPage } from "../pages/TasksPage";
import { SortableSubtaskRow } from "../components/project/SortableSubtaskRow";
import { TabItem, TabList, tabIds } from "../components/ui/TabItem";
import { MenuBarApp } from "../menubar/MenuBarApp";
import { formatMoney } from "../lib/upkeep/money";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorFallback } from "../components/ErrorFallback";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

vi.mock("../lib/log", () => ({ logError: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  cleanup();
  useAppStore.setState({ language: "EN" });
});

describe("document language", () => {
  it("follows setLanguage", () => {
    useAppStore.getState().setLanguage("FR");
    expect(document.documentElement.lang).toBe("fr");
    useAppStore.getState().setLanguage("EN");
    expect(document.documentElement.lang).toBe("en");
  });

  it("follows a language change picked up from storage (menu bar window)", () => {
    localStorage.setItem("appLanguage", "FR");
    syncAppearanceFromStorage();
    expect(document.documentElement.lang).toBe("fr");
    localStorage.setItem("appLanguage", "EN");
    syncAppearanceFromStorage();
    expect(document.documentElement.lang).toBe("en");
    localStorage.removeItem("appLanguage");
  });
});

describe("TasksPage project group count", () => {
  const project = {
    id: 1, client_id: "c1", name: "Brand Refresh", description: "", status: "active",
    start_date: null, deadline: null, notes: "", layout_config: null, folder_path: null, created_at: "", updated_at: "",
  };
  const taskRow = (id: number) => ({
    id, project_id: 1, project_name: "Brand Refresh", title: `Task ${id}`, description: "", status: "todo", priority: "low",
    due_date: null, end_date: null, start_time: null, end_time: null, reminder: null,
    scheduled_start: null, scheduled_end: null, calendar_event_id: null, notes: "", planned_minutes: null,
    tracked_minutes: 0, workload_cells: "{}", workload_sort_order: 0, sort_order: id, created_at: "", updated_at: "",
  });

  let tasks: ReturnType<typeof taskRow>[] = [];

  beforeEach(async () => {
    await getDb();
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM tasks t")) return tasks;
      if (flat.includes("FROM projects")) return [project];
      return [];
    });
  });
  afterEach(() => setSelectHandler(null));

  function renderPage() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TasksPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it.each([
    ["EN", 1, "1 task"],
    ["EN", 2, "2 tasks"],
    ["FR", 1, "1 tâche"],
    ["FR", 3, "3 tâches"],
  ] as const)("%s, %i task(s): %s", async (lang, n, text) => {
    useAppStore.setState({ language: lang });
    tasks = Array.from({ length: n }, (_, i) => taskRow(i + 1));
    renderPage();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});

describe("subtask drag handle", () => {
  it("is shown on keyboard focus even when the row isn't hovered", () => {
    render(
      <DndContext>
        <SortableContext items={[1]} strategy={verticalListSortingStrategy}>
          <SortableSubtaskRow id={1} hovered={false} onHoverChange={() => {}}>
            <span>subtask</span>
          </SortableSubtaskRow>
        </SortableContext>
      </DndContext>
    );
    const handle = screen.getByLabelText(/drag to reorder/i);
    expect(handle.className).toContain("opacity-0");
    expect(handle.className).toContain("focus-visible:opacity-100");
  });
});

describe("tab pattern", () => {
  function Tabs() {
    const base = useId();
    const [tab, setTab] = useState("a");
    const keys = ["a", "b", "c"];
    const panel = tabIds(base, tab);
    return (
      <>
        <TabList label="Things">
          {keys.map((k) => {
            const ids = tabIds(base, k);
            return <TabItem key={k} role="tab" id={ids.tab} controls={ids.panel} label={k.toUpperCase()} active={tab === k} onActivate={() => setTab(k)} />;
          })}
        </TabList>
        <div role="tabpanel" id={panel.panel} aria-labelledby={panel.tab}>
          panel {tab}
        </div>
      </>
    );
  }

  it("wires each tab to its panel and keeps one Tab stop", () => {
    render(<Tabs />);
    expect(screen.getByRole("tablist")).toHaveAccessibleName("Things");
    const a = screen.getByRole("tab", { name: "A" });
    const panel = screen.getByRole("tabpanel");
    expect(a).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", a.id);
    expect(panel).toHaveAccessibleName("A");
    expect(a).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves and activates with Left/Right/Home/End, wrapping", () => {
    render(<Tabs />);
    const tab = (name: string) => screen.getByRole("tab", { name });
    tab("A").focus();
    fireEvent.keyDown(tab("A"), { key: "ArrowRight" });
    expect(tab("B")).toHaveFocus();
    expect(tab("B")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel b");
    fireEvent.keyDown(tab("B"), { key: "End" });
    expect(tab("C")).toHaveFocus();
    fireEvent.keyDown(tab("C"), { key: "ArrowRight" });
    expect(tab("A")).toHaveFocus();
    fireEvent.keyDown(tab("A"), { key: "ArrowLeft" });
    expect(tab("C")).toHaveFocus();
    fireEvent.keyDown(tab("C"), { key: "Home" });
    expect(tab("A")).toHaveFocus();
    expect(tab("A")).toHaveAttribute("aria-selected", "true");
  });

  it("leaves a TabItem outside a TabList reachable by Tab", () => {
    render(
      <div role="tablist" aria-label="Legacy">
        <TabItem role="tab" label="One" active onActivate={() => {}} />
        <TabItem role="tab" label="Two" active={false} onActivate={() => {}} />
      </div>
    );
    expect(screen.getByRole("tab", { name: "Two" })).not.toHaveAttribute("tabindex");
  });

  it("is used by the menu bar panel", () => {
    localStorage.clear();
    render(<MenuBarApp />);
    const agents = screen.getByRole("tab", { name: "Agents" });
    const panel = screen.getByRole("tabpanel");
    expect(agents).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", agents.id);
    agents.focus();
    fireEvent.keyDown(agents, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Usage" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Usage");
  });
});

describe("formatMoney", () => {
  // Intl separates code and amount with a no-break space; compare on plain spaces.
  const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

  it("puts the ISO code first with Swiss grouping, in either language", () => {
    for (const lang of ["EN", "FR"] as const) {
      useAppStore.setState({ language: lang });
      expect(plain(formatMoney(840, "CHF"))).toBe("CHF 840.00");
      expect(plain(formatMoney(1234.5, "chf"))).toBe("CHF 1’234.50");
      expect(plain(formatMoney(120, "EUR"))).toBe("EUR 120.00");
    }
  });

  it("puts a minus sign on the number, not the code", () => {
    expect(plain(formatMoney(-5, "CHF"))).toBe("CHF -5.00");
  });

  it("gives the bare number without a currency, and keeps a non-ISO currency as typed", () => {
    expect(formatMoney(1234.5, null)).toBe("1’234.50");
    expect(formatMoney(3, "Fr.")).toBe("Fr. 3.00");
  });
});

describe("usage percent", () => {
  it("has a space (no-break) before % in French", () => {
    expect(uiLabels.FR.usage_percent.replace("{percent}", "42")).toBe("42\u00a0%");
    expect(uiLabels.EN.usage_percent.replace("{percent}", "42")).toBe("42%");
  });
});

describe("danger EmptyState", () => {
  it("is announced as an alert", () => {
    render(<EmptyState tone="danger" message="Broke" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Broke");
  });

  it("is not an alert in the default tone", () => {
    render(<EmptyState message="Nothing here" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("makes the page error fallback an alert", () => {
    render(<ErrorFallback error={new Error("x")} resetErrorBoundary={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });
});
