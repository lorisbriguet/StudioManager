import { beforeEach, describe, expect, it } from "vitest";
import type { LayoutItem } from "react-grid-layout";
import {
  DEFAULT_LAYOUT,
  presetJson,
  presetLayout,
  spreadSqueezedLayout,
  useDashboardStore,
} from "../stores/dashboard-store";
import { useOrgStore } from "../stores/org-store";

// The default dashboard as v3.4.0 saved it from a window under 1200px: the
// grid's 6-column copy (stat tiles in two columns, charts on the left).
const SAVED_BY_340_SM: LayoutItem[] = [
  { i: "w-kpi-invoiced", x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-kpi-balance", x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-kpi-expenses", x: 3, y: 2, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-kpi-net", x: 3, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-chart-revenue", x: 0, y: 6, w: 6, h: 5, minW: 4, minH: 4 },
  { i: "w-recent-invoices", x: 2, y: 11, w: 4, h: 5, minW: 3, minH: 3 },
  { i: "w-today-tasks", x: 0, y: 16, w: 6, h: 4, minW: 3, minH: 3 },
];
// The same, from the 10-column (md) copy.
const SAVED_BY_340_MD: LayoutItem[] = [
  { i: "w-kpi-invoiced", x: 0, y: 0, w: 3, h: 2 },
  { i: "w-kpi-balance", x: 3, y: 0, w: 3, h: 2 },
  { i: "w-kpi-expenses", x: 6, y: 0, w: 3, h: 2 },
  { i: "w-kpi-net", x: 7, y: 2, w: 3, h: 2 },
  { i: "w-chart-revenue", x: 0, y: 4, w: 8, h: 5 },
  { i: "w-recent-invoices", x: 6, y: 9, w: 4, h: 5 },
];

// The demo's dashboard in Rerun 6 (R6-D-01/02): the 6-column copy on the left, and
// three widgets added since, which findFreeSpot put in the empty right half at the top.
// Its first row already reaches column 12, so the per-row rule stretched nothing.
const SQUEEZED_WITH_RIGHT_HALF: LayoutItem[] = [
  { i: "w-kpi-invoiced", x: 0, y: 0, w: 3, h: 2 },
  { i: "w-kpi-balance", x: 3, y: 0, w: 3, h: 2 },
  { i: "w-kpi-monthly-1", x: 0, y: 2, w: 3, h: 2 },
  { i: "w-kpi-expenses", x: 3, y: 2, w: 3, h: 2 },
  { i: "w-kpi-net", x: 3, y: 4, w: 3, h: 2 },
  { i: "w-chart-revenue", x: 0, y: 6, w: 6, h: 5 },
  { i: "w-recent-invoices", x: 2, y: 11, w: 4, h: 5 },
  { i: "w-today-tasks", x: 0, y: 16, w: 6, h: 4 },
  { i: "w-overdue-tasks", x: 0, y: 20, w: 6, h: 4 },
  { i: "w-upkeep", x: 0, y: 24, w: 4, h: 4 },
  { i: "w-busiest-day-1", x: 6, y: 0, w: 3, h: 3 },
  { i: "w-quick-create-1", x: 9, y: 0, w: 3, h: 3 },
  { i: "w-project-time-1", x: 6, y: 3, w: 4, h: 4 },
];

const right = (l: LayoutItem[]) => Math.max(...l.map((i) => i.x + i.w));
const overlap = (a: LayoutItem, b: LayoutItem) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function expectNoOverlap(layout: LayoutItem[]) {
  for (const a of layout) for (const b of layout) if (a !== b) expect(overlap(a, b), `${a.i} / ${b.i}`).toBe(false);
}

describe("spreadSqueezedLayout", () => {
  it.each([["6 columns", SAVED_BY_340_SM], ["10 columns", SAVED_BY_340_MD]])(
    "stretches a 3.4.0 layout saved at %s over the 12 columns",
    (_, saved) => {
      const spread = spreadSqueezedLayout(saved);
      expect(right(spread)).toBe(12);
      expect(spread.every((i) => i.x >= 0 && i.x + i.w <= 12)).toBe(true);
      expectNoOverlap(spread);
      // Rows and heights are kept.
      expect(spread.map((i) => [i.i, i.y, i.h])).toEqual(saved.map((i) => [i.i, i.y, i.h]));
    },
  );

  it("doubles a 6-column layout", () => {
    const spread = spreadSqueezedLayout(SAVED_BY_340_SM);
    expect(spread.find((i) => i.i === "w-kpi-balance")).toMatchObject({ x: 6, w: 6 });
    expect(spread.find((i) => i.i === "w-chart-revenue")).toMatchObject({ x: 0, w: 12 });
  });

  it("stretches the squeezed rows when a widget added since reaches column 12", () => {
    // Added at full width after the upgrade: below the old widgets, and one to the right.
    const added: LayoutItem[] = [
      { i: "w-upkeep", x: 0, y: 20, w: 12, h: 4 },
      { i: "w-overdue-tasks", x: 8, y: 16, w: 4, h: 4 },
    ];
    const spread = spreadSqueezedLayout([...SAVED_BY_340_SM, ...added]);
    expect(spread.find((i) => i.i === "w-kpi-balance")).toMatchObject({ x: 6, w: 6 });
    expect(spread.find((i) => i.i === "w-chart-revenue")).toMatchObject({ x: 0, w: 12 });
    // The widgets placed at full width don't move, nor does the old one in their row.
    expect(spread.find((i) => i.i === "w-upkeep")).toEqual(added[0]);
    expect(spread.find((i) => i.i === "w-overdue-tasks")).toEqual(added[1]);
    expect(spread.find((i) => i.i === "w-today-tasks")).toMatchObject({ x: 0, w: 6 });
    expectNoOverlap(spread);
  });

  it("stretches a 3.4.0 layout whose added widgets filled the right half (Rerun 6, the demo)", () => {
    const spread = spreadSqueezedLayout(SQUEEZED_WITH_RIGHT_HALF);
    expect(right(spread)).toBe(12);
    expect(spread.every((i) => i.x >= 0 && i.x + i.w <= 12)).toBe(true);
    expectNoOverlap(spread);
    const at = (id: string) => spread.find((i) => i.i === id)!;
    // The old 6-column part is doubled.
    expect(at("w-kpi-balance")).toMatchObject({ x: 6, w: 6, y: 0 });
    expect(at("w-chart-revenue")).toMatchObject({ x: 0, w: 12 });
    expect(at("w-upkeep")).toMatchObject({ x: 0, w: 8 });
    // The widgets of the right half come just below the stat tiles, in their order and size.
    expect(at("w-busiest-day-1")).toMatchObject({ x: 0, y: 6, w: 3, h: 3 });
    expect(at("w-quick-create-1")).toMatchObject({ x: 3, y: 6, w: 3, h: 3 });
    expect(at("w-project-time-1")).toMatchObject({ x: 6, y: 6, w: 4, h: 4 });
    // The rest moves down by what they take, in the same order.
    expect(at("w-chart-revenue").y).toBe(10);
    const order = (l: LayoutItem[]) => [...l].sort((a, b) => a.y - b.y || a.x - b.x).map((i) => i.i);
    expect(order(spread).slice(-5)).toEqual(["w-chart-revenue", "w-recent-invoices", "w-today-tasks", "w-overdue-tasks", "w-upkeep"]);
  });

  it("also when a widget was dragged from the left to the right half since (Today, Rerun 6)", () => {
    const dragged = SQUEEZED_WITH_RIGHT_HALF.map((i) =>
      i.i === "w-today-tasks" ? { ...i, x: 6, y: 7, w: 6 } : i.i === "w-overdue-tasks" ? { ...i, y: 16 } : i,
    );
    const spread = spreadSqueezedLayout(dragged);
    expect(right(spread)).toBe(12);
    expectNoOverlap(spread);
    expect(spread.find((i) => i.i === "w-today-tasks")!.y).toBeLessThan(spread.find((i) => i.i === "w-chart-revenue")!.y);
    expect(spread.find((i) => i.i === "w-chart-revenue")).toMatchObject({ x: 0, w: 12 });
  });

  it("leaves a two-half layout alone when the stat tiles are not all on the left", () => {
    const halves: LayoutItem[] = [
      { i: "w-kpi-invoiced", x: 0, y: 0, w: 6, h: 2 },
      { i: "w-kpi-balance", x: 6, y: 0, w: 6, h: 2 },
      { i: "w-chart-revenue", x: 0, y: 2, w: 6, h: 5 },
      { i: "w-recent-invoices", x: 6, y: 2, w: 6, h: 5 },
    ];
    expect(spreadSqueezedLayout(halves)).toBe(halves);
  });

  it("leaves a full-width layout alone", () => {
    expect(spreadSqueezedLayout(DEFAULT_LAYOUT)).toBe(DEFAULT_LAYOUT);
    expect(spreadSqueezedLayout([])).toEqual([]);
  });
});

describe("saved layout on load", () => {
  beforeEach(() => {
    localStorage.clear();
    useOrgStore.setState({ activeId: "other" });
  });

  it("is spread once and saved", () => {
    localStorage.setItem("dashboard-layout:o1", JSON.stringify(SAVED_BY_340_SM));
    useOrgStore.setState({ activeId: "o1" }); // the switch reloads the dashboard
    expect(right(useDashboardStore.getState().layout)).toBe(12);
    expect(right(JSON.parse(localStorage.getItem("dashboard-layout:o1") ?? "[]"))).toBe(12);
  });

  it("is checked again when an earlier build already marked it checked", () => {
    localStorage.setItem("dashboard-layout:o1", JSON.stringify([...SAVED_BY_340_SM, { i: "w-upkeep", x: 0, y: 20, w: 12, h: 4 }]));
    localStorage.setItem("dashboard-layout-spread:o1", "1");
    useOrgStore.setState({ activeId: "o1" });
    expect(useDashboardStore.getState().layout.find((i) => i.i === "w-chart-revenue")).toMatchObject({ x: 0, w: 12 });
    expect(localStorage.getItem("dashboard-layout-spread:o1")).toBeNull();
  });

  it("spreads the demo's layout once more after the '-2' check missed it (Rerun 6)", () => {
    localStorage.setItem("dashboard-layout:o1", JSON.stringify(SQUEEZED_WITH_RIGHT_HALF));
    localStorage.setItem("dashboard-layout-spread-2:o1", "1");
    useOrgStore.setState({ activeId: "o1" });
    const layout = useDashboardStore.getState().layout;
    expect(layout.find((i) => i.i === "w-chart-revenue")).toMatchObject({ x: 0, w: 12 });
    expect(JSON.parse(localStorage.getItem("dashboard-layout:o1") ?? "[]")).toEqual(layout);
    expect(localStorage.getItem("dashboard-layout-spread-3:o1")).toBe("1");
    expect(localStorage.getItem("dashboard-layout-spread-2:o1")).toBeNull();
  });

  it("keeps a layout the '-2' check already saw when it is not the right-half shape", () => {
    // Narrow top rows above a full row: the per-row rule would stretch them, but the
    // '-2' check left them (arranged since), so the '-3' check must too.
    const arranged: LayoutItem[] = [
      { i: "w-kpi-invoiced", x: 0, y: 0, w: 3, h: 2 },
      { i: "w-kpi-balance", x: 3, y: 0, w: 3, h: 2 },
      { i: "w-chart-revenue", x: 0, y: 2, w: 12, h: 5 },
    ];
    localStorage.setItem("dashboard-layout:o1", JSON.stringify(arranged));
    localStorage.setItem("dashboard-layout-spread-2:o1", "1");
    useOrgStore.setState({ activeId: "o1" });
    expect(useDashboardStore.getState().layout).toEqual(arranged);
  });

  it("is not stretched again once checked (a layout left narrow on purpose)", () => {
    localStorage.setItem("dashboard-layout:o1", JSON.stringify(DEFAULT_LAYOUT));
    useOrgStore.setState({ activeId: "o1" });
    const narrow = [{ i: "w-kpi-invoiced", x: 0, y: 0, w: 3, h: 2 }];
    useDashboardStore.getState().setLayout(narrow);
    useDashboardStore.getState().reloadForOrg();
    expect(useDashboardStore.getState().layout).toEqual(narrow);
  });
});

describe("presets", () => {
  it("spreads a preset saved before the column count was stored", () => {
    expect(right(presetLayout({ layout: SAVED_BY_340_SM }))).toBe(12);
  });

  it("keeps a preset saved now as is", () => {
    const narrow = [{ i: "w-kpi-invoiced", x: 0, y: 0, w: 3, h: 2 }];
    const saved = JSON.parse(presetJson([], narrow)) as { layout: LayoutItem[]; cols: number };
    expect(presetLayout(saved)).toEqual(narrow);
  });
});
