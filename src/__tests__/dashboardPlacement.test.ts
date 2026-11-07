import { describe, it, expect } from "vitest";
import type { LayoutItem } from "react-grid-layout";
import { findFreeSpot, fitLayoutToCatalog, WIDGET_CATALOG } from "../stores/dashboard-store";

describe("findFreeSpot", () => {
  it("fills the row beside existing widgets before going below", () => {
    const layout: LayoutItem[] = [{ i: "a", x: 0, y: 0, w: 3, h: 3 }];
    expect(findFreeSpot(layout, 3, 3)).toEqual({ x: 3, y: 0 });
  });

  it("places a run of new widgets side by side, not in one column", () => {
    let layout: LayoutItem[] = [];
    for (let n = 0; n < 5; n++) {
      const { x, y } = findFreeSpot(layout, 3, 3);
      layout = [...layout, { i: String(n), x, y, w: 3, h: 3 }];
    }
    expect(layout.map((l) => [l.x, l.y])).toEqual([[0, 0], [3, 0], [6, 0], [9, 0], [0, 3]]);
  });

  it("uses a gap left between widgets when the widget fits in it", () => {
    const layout: LayoutItem[] = [
      { i: "a", x: 0, y: 0, w: 12, h: 2 },
      { i: "b", x: 0, y: 2, w: 8, h: 4 },
      { i: "c", x: 0, y: 6, w: 12, h: 2 },
    ];
    expect(findFreeSpot(layout, 4, 4)).toEqual({ x: 8, y: 2 });
    // Too tall for the gap: goes below everything.
    expect(findFreeSpot(layout, 4, 5)).toEqual({ x: 0, y: 8 });
  });

  it("starts at the top of an empty dashboard", () => {
    expect(findFreeSpot([], 4, 4)).toEqual({ x: 0, y: 0 });
  });
});

describe("fitLayoutToCatalog", () => {
  it("grows a saved widget to its catalog minimum and leaves others alone", () => {
    const widgets = [
      { id: "w-busy", type: "busiest-day" as const },
      { id: "w-kpi", type: "kpi-net" as const },
    ];
    const layout: LayoutItem[] = [
      { i: "w-busy", x: 0, y: 0, w: 3, h: 2, minW: 3, minH: 2 },
      { i: "w-kpi", x: 3, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
    ];
    const minH = WIDGET_CATALOG.find((c) => c.type === "busiest-day")!.minH;
    const [busy, kpi] = fitLayoutToCatalog(widgets, layout);
    expect(busy).toMatchObject({ h: minH, minH });
    expect(kpi).toEqual(layout[1]);
  });
});
