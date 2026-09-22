import { describe, it, expect, beforeEach } from "vitest";
import { dbUrlFor } from "../db";
import { useOrgStore } from "../stores/org-store";

describe("database URL per organisation", () => {
  beforeEach(() => useOrgStore.setState({ activeId: "" }));
  it("falls back to the bare name before the registry is loaded", () => {
    expect(dbUrlFor("studiomanager.db")).toBe("sqlite:studiomanager.db");
  });
  it("points inside the active organisation folder", () => {
    useOrgStore.setState({ activeId: "k3f9a2" });
    expect(dbUrlFor("studiomanager.db")).toBe("sqlite:orgs/k3f9a2/studiomanager.db");
    expect(dbUrlFor("studiomanager_test.db")).toBe("sqlite:orgs/k3f9a2/studiomanager_test.db");
  });
});
