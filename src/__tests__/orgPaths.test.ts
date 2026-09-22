import { describe, it, expect, beforeEach } from "vitest";
import { orgPaths } from "../lib/orgPaths";
import { useOrgStore } from "../stores/org-store";

describe("orgPaths", () => {
  beforeEach(() => useOrgStore.setState({ activeId: "" }));
  it("uses the organisation folder when one is active", async () => {
    useOrgStore.setState({ activeId: "k3f9a2" });
    expect(await orgPaths()).toEqual({
      root: "/tmp/test-app-data/orgs/k3f9a2",
      invoicesDir: "/tmp/test-app-data/orgs/k3f9a2/invoices",
      receiptsDir: "/tmp/test-app-data/orgs/k3f9a2/receipts",
    });
  });
  it("falls back to the app data folder before load", async () => {
    expect((await orgPaths()).invoicesDir).toBe("/tmp/test-app-data/invoices");
  });
});
