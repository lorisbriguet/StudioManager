import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { LayoutItem } from "react-grid-layout";

vi.mock("../lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }));

// The real grid needs layout measurements jsdom does not have. The stand-in
// keeps the props so a test can play the grid's part: report a squeezed
// layout, or end a drag.
const grid = vi.hoisted(() => ({ width: 1400, props: null as null | Record<string, (...a: unknown[]) => void> }));
vi.mock("react-grid-layout", () => ({
  ResponsiveGridLayout: (p: Record<string, (...a: unknown[]) => void>) => { grid.props = p; return null; },
  useContainerWidth: () => ({ width: grid.width, containerRef: { current: null }, mounted: true }),
  verticalCompactor: {},
}));
vi.mock("react-grid-layout/css/styles.css", () => ({}));
vi.mock("../db/hooks/useClients", () => ({ useClients: () => ({ data: [{ id: 1 }] }) }));
vi.mock("../components/dashboard/widgets", () => ({ renderWidget: () => null }));
vi.mock("../db/hooks/useDashboardPresets", () => {
  const mut = () => ({ mutate: () => {}, mutateAsync: async () => 0, isPending: false });
  return { useDashboardPresets: () => ({ data: [] }), useCreateDashboardPreset: mut, useUpdateDashboardPreset: mut, useDeleteDashboardPreset: mut };
});

import { useDashboardStore, isFullWidthLayout } from "../stores/dashboard-store";
import { useOrgStore } from "../stores/org-store";
import { DashboardPage } from "../pages/DashboardPage";
import { setInvokeHandler } from "../__mocks__/tauri-api";
import type { Registry } from "../lib/orgs";

const wide: LayoutItem[] = [
  { i: "w-kpi-invoiced", x: 0, y: 0, w: 3, h: 2 },
  { i: "w-kpi-balance", x: 3, y: 0, w: 3, h: 2 },
];
// What the grid reports for the same widgets in a 4-column window.
const squeezed: LayoutItem[] = [
  { i: "w-kpi-invoiced", x: 0, y: 0, w: 4, h: 2 },
  { i: "w-kpi-balance", x: 0, y: 2, w: 4, h: 2 },
];

function switchTo(id: string) {
  useOrgStore.setState({ activeId: id });
}

beforeEach(() => {
  localStorage.clear();
  switchTo("o1");
  useDashboardStore.getState().reloadForOrg();
  useDashboardStore.getState().setLayout(wide);
  grid.props = null;
});
afterEach(() => { cleanup(); setInvokeHandler(null); });

function renderPage(width: number) {
  grid.width = width;
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
  if (!grid.props) throw new Error("grid not rendered");
  return grid.props;
}

describe("dashboard layout saving", () => {
  it("uses react-grid-layout's rule for the full-width layout", () => {
    expect(isFullWidthLayout(1201)).toBe(true);
    expect(isFullWidthLayout(1200)).toBe(false);
  });

  it("never saves the layout the grid squeezes for a narrow window", () => {
    const props = renderPage(700);
    props.onLayoutChange?.(squeezed, {});
    props.onDragStop(squeezed);
    props.onResizeStop(squeezed);
    expect(JSON.parse(localStorage.getItem("dashboard-layout:o1")!)).toEqual(wide);
    expect(useDashboardStore.getState().layout).toEqual(wide);
  });

  it("is view-only below full width and editable at full width", () => {
    type Config = { enabled: boolean };
    const narrow = renderPage(1000) as unknown as { dragConfig: Config; resizeConfig: Config };
    expect(narrow.dragConfig.enabled).toBe(false);
    expect(narrow.resizeConfig.enabled).toBe(false);
    cleanup();
    const full = renderPage(1400) as unknown as { dragConfig: Config; resizeConfig: Config };
    expect(full.dragConfig.enabled).toBe(true);
    expect(full.resizeConfig.enabled).toBe(true);
  });

  it("saves a drag or resize at full width", () => {
    const props = renderPage(1400);
    const moved = [{ ...wide[0], x: 6 }, wide[1]];
    props.onDragStop(moved);
    expect(JSON.parse(localStorage.getItem("dashboard-layout:o1")!)).toEqual(moved);
    const resized = [{ ...wide[0], x: 6, w: 6 }, wide[1]];
    props.onResizeStop(resized);
    expect(useDashboardStore.getState().layout).toEqual(resized);
  });
});

describe("dashboard per organisation", () => {
  it("keeps a separate dashboard per organisation and reloads it on a switch", () => {
    useDashboardStore.getState().addWidget("upkeep");
    useDashboardStore.getState().setPinnedNotes("o1 notes");
    useDashboardStore.getState().setActivePreset(3, "Finance", useDashboardStore.getState().widgets, wide);

    switchTo("o2");
    const s = useDashboardStore.getState();
    expect(s.pinnedNotes).toBe("");
    expect(s.activePresetId).toBeNull();
    expect(s.widgets.some((w) => w.type === "upkeep" && w.id !== "w-upkeep")).toBe(false);

    switchTo("o1");
    expect(useDashboardStore.getState().pinnedNotes).toBe("o1 notes");
    expect(useDashboardStore.getState().activePresetId).toBe(3);
    expect(localStorage.getItem("dashboard-layout")).toBeNull();
  });

  it("stores no preset name when no preset is active", () => {
    useDashboardStore.getState().setActivePreset(3, "Finance", [], wide);
    useDashboardStore.getState().resetDashboard();
    expect(localStorage.getItem("dashboard-preset-name:o1")).toBeNull();
    expect(localStorage.getItem("dashboard-preset-id:o1")).toBeNull();
    expect(useDashboardStore.getState().activePresetName).toBe("");
  });

  it("moves the old global dashboard to the open organisation on launch", async () => {
    // An organisation upgraded by an earlier build: prefs already set, so
    // the first-launch rename has run, but the dashboard keys were global.
    const registry: Registry = {
      version: 1,
      activeId: "o3",
      organisations: [
        { id: "o3", name: "Studio", createdAt: "2026-09-22T00:00:00Z", prefs: { showIncome: false, showTasksPage: true, showTimeOverview: false, calendarSync: false, calendarName: "", backupPath: "", exportLanguage: "FR" } },
        { id: "o4", name: "Other", createdAt: "2026-09-22T00:00:00Z", prefs: null },
      ],
    };
    localStorage.setItem("dashboard-layout", JSON.stringify(squeezed));
    localStorage.setItem("dashboard-pinned-notes", "old notes");
    localStorage.setItem("open-tabs", "untouched");
    setInvokeHandler((cmd) => (cmd === "list_organisations" ? registry : null));

    await useOrgStore.getState().load();

    expect(localStorage.getItem("dashboard-layout")).toBeNull();
    expect(localStorage.getItem("dashboard-pinned-notes:o3")).toBe("old notes");
    expect(useDashboardStore.getState().layout).toEqual(squeezed);
    expect(useDashboardStore.getState().pinnedNotes).toBe("old notes");
    // Only the dashboard keys move on an already-upgraded organisation.
    expect(localStorage.getItem("open-tabs")).toBe("untouched");

    switchTo("o4");
    expect(useDashboardStore.getState().pinnedNotes).toBe("");
  });
});
