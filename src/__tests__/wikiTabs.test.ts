import { describe, it, expect } from "vitest";
import { openInTabs, closeTab, singleView, openInView, leaveGraph, closeView, type TabsState } from "../lib/wikiTabs";

const empty = { tabs: [], active: null };

describe("wiki tabs", () => {
  it("navigates inside the active tab and keeps its history", () => {
    let s = openInTabs(empty, 1, false);
    s = openInTabs(s, 2, false);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ kind: "article", history: [1, 2], pos: 1 });
  });

  it("drops forward history when navigating after going back", () => {
    let s = openInTabs(openInTabs(openInTabs(empty, 1, false), 2, false), 3, false);
    s = { ...s, tabs: [{ ...s.tabs[0], pos: 0 } as (typeof s.tabs)[number]] };
    s = openInTabs(s, 4, false);
    expect(s.tabs[0]).toMatchObject({ history: [1, 4], pos: 1 });
  });

  it("opens a new tab, or switches to one already showing the article", () => {
    let s = openInTabs(empty, 1, false);
    s = openInTabs(s, 2, true);
    expect(s.tabs).toHaveLength(2);
    const second = s.active;
    s = openInTabs({ ...s, active: s.tabs[0].key }, 2, true);
    expect(s.tabs).toHaveLength(2);
    expect(s.active).toBe(second);
  });

  it("activates the neighbour when the active tab closes", () => {
    let s = openInTabs(openInTabs(openInTabs(empty, 1, true), 2, true), 3, true);
    const [a, b, c] = s.tabs.map((t) => t.key);
    s = closeTab({ ...s, active: b }, b);
    expect(s.tabs.map((t) => t.key)).toEqual([a, c]);
    expect(s.active).toBe(c);
    expect(closeTab(closeTab(s, a), c)).toEqual({ tabs: [], active: null });
  });
});

describe("one view at a time (no tab strip)", () => {
  const graph = { key: "graph", kind: "graph" } as const;

  it("opens from the graph into the article view, adding to its history", () => {
    let s: TabsState = openInView(empty, 1);
    s = { tabs: [...s.tabs, graph], active: "graph" };
    s = openInView(s, 2);
    expect(s.tabs.filter((t) => t.kind === "article")).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ history: [1, 2], pos: 1 });
    expect(s.active).toBe(s.tabs[0].key);
  });

  it("keeps one article tab from a state saved with several", () => {
    let s = openInTabs(openInTabs(empty, 1, false), 2, true);
    s = { tabs: [...s.tabs, graph], active: s.tabs[1].key };
    const one = singleView(s);
    expect(one.tabs.map((t) => t.key)).toEqual([s.tabs[1].key, "graph"]);
    expect(one.active).toBe(s.tabs[1].key);
    expect(singleView(one)).toBe(one);
  });

  it("leaves the graph for the article, and closing the article never lands on the graph", () => {
    let s: TabsState = openInView(empty, 1);
    const key = s.tabs[0].key;
    s = { tabs: [...s.tabs, graph], active: "graph" };
    expect(leaveGraph(s).active).toBe(key);
    expect(leaveGraph({ tabs: [graph], active: "graph" }).active).toBeNull();
    expect(closeView({ ...s, active: key }, key)).toEqual({ tabs: [graph], active: null });
  });
});
