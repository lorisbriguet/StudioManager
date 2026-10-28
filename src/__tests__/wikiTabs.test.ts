import { describe, it, expect } from "vitest";
import { openInTabs, closeTab } from "../lib/wikiTabs";

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
