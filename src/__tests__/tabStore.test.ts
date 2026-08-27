import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore, predictNextActiveTab, type Tab } from "../stores/tab-store";

const tab = (id: string, path: string, pinned = false): Tab => ({
  id,
  path,
  label: path,
  pinned,
});

function seed(tabs: Tab[], activeTabId: string) {
  useTabStore.setState({ tabs, activeTabId, closedTabs: [] });
}

beforeEach(() => {
  localStorage.clear();
  seed([tab("a", "/a"), tab("b", "/b"), tab("c", "/c")], "b");
});

describe("predictNextActiveTab", () => {
  it("picks the same-index neighbor when closing in the middle", () => {
    const tabs = [tab("a", "/a"), tab("b", "/b"), tab("c", "/c")];
    expect(predictNextActiveTab(tabs, "b")!.id).toBe("c");
  });

  it("falls back to the previous tab when closing the last one", () => {
    const tabs = [tab("a", "/a"), tab("b", "/b")];
    expect(predictNextActiveTab(tabs, "b")!.id).toBe("a");
  });

  it("returns null for an unknown id", () => {
    expect(predictNextActiveTab([tab("a", "/a")], "zzz")).toBeNull();
  });
});

describe("tab store", () => {
  it("openTab reuses an existing tab with the same path", () => {
    const id = useTabStore.getState().openTab("/b", "B again");
    expect(id).toBe("b");
    expect(useTabStore.getState().tabs).toHaveLength(3);
    expect(useTabStore.getState().activeTabId).toBe("b");
  });

  it("closeTab activates the predicted neighbor and records the closed tab", () => {
    const next = useTabStore.getState().closeTab("b");
    expect(next).toBe("c");
    expect(useTabStore.getState().activeTabId).toBe("c");
    expect(useTabStore.getState().closedTabs[0].path).toBe("/b");
  });

  it("never closes the last remaining tab", () => {
    seed([tab("solo", "/x")], "solo");
    expect(useTabStore.getState().closeTab("solo")).toBeNull();
    expect(useTabStore.getState().tabs).toHaveLength(1);
  });

  it("refuses to close a pinned tab", () => {
    seed([tab("a", "/a", true), tab("b", "/b")], "a");
    expect(useTabStore.getState().closeTab("a")).toBeNull();
    expect(useTabStore.getState().tabs).toHaveLength(2);
  });

  it("reopenClosedTab restores the most recently closed tab", () => {
    useTabStore.getState().closeTab("b");
    const reopened = useTabStore.getState().reopenClosedTab();
    expect(reopened!.path).toBe("/b");
    expect(useTabStore.getState().tabs.map((t) => t.path)).toContain("/b");
    expect(useTabStore.getState().closedTabs).toHaveLength(0);
  });

  it("updateActiveTab keeps a custom label when the path is unchanged", () => {
    seed([{ id: "a", path: "/a", label: "My custom name", pinned: false }], "a");
    useTabStore.getState().updateActiveTab("/a", "Generic");
    expect(useTabStore.getState().tabs[0].label).toBe("My custom name");
    useTabStore.getState().updateActiveTab("/other", "Other");
    expect(useTabStore.getState().tabs[0].label).toBe("Other");
  });

  it("reorderTabs moves a tab and persists", () => {
    useTabStore.getState().reorderTabs(0, 2);
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(["b", "c", "a"]);
    const persisted = JSON.parse(localStorage.getItem("open-tabs")!);
    expect(persisted.tabs.map((t: Tab) => t.id)).toEqual(["b", "c", "a"]);
  });
});
