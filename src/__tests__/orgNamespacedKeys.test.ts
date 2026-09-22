import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "../stores/tab-store";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";

beforeEach(() => { localStorage.clear(); useOrgStore.setState({ activeId: "o1" }); });

describe("organisation-namespaced localStorage", () => {
  it("tabs persist under open-tabs:<id> and reload per organisation", () => {
    useTabStore.getState().reloadForOrg();
    useTabStore.getState().openTab("/clients", "Clients");
    expect(localStorage.getItem("open-tabs:o1")).toContain("/clients");
    expect(localStorage.getItem("open-tabs")).toBeNull();
    useOrgStore.setState({ activeId: "o2" });
    useTabStore.getState().reloadForOrg();
    expect(useTabStore.getState().tabs.filter((t) => t.path === "/clients")).toHaveLength(0);
  });

  it("closeAllTabs leaves only the dashboard tab", () => {
    useTabStore.getState().reloadForOrg();
    useTabStore.getState().openTab("/clients", "Clients");
    useTabStore.getState().closeAllTabs();
    expect(useTabStore.getState().tabs.map((t) => t.path)).toEqual(["/"]);
  });

  it("timer persists under activeTimer:<id>", () => {
    useAppStore.getState().startTimer(1, 2, "P");
    expect(localStorage.getItem("activeTimer:o1")).not.toBeNull();
    useOrgStore.setState({ activeId: "o2" });
    useAppStore.getState().reloadTimerForOrg();
    expect(useAppStore.getState().activeTimer).toBeNull();
  });
});
