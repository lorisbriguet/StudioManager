import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

// plugin-log needs the real Tauri bridge — unmocked it surfaces unhandled
// rejections ("Cannot read properties of undefined (reading 'invoke')").
// Same workaround as src/__tests__/orgStore.test.ts.
vi.mock("../lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

import { OrgGate } from "../components/OrgGate";
import { useOrgStore } from "../stores/org-store";
import { setInvokeHandler } from "../__mocks__/tauri-api";

beforeEach(() => useOrgStore.setState({ organisations: [], activeId: "", loaded: false }));
afterEach(() => { setInvokeHandler(null); cleanup(); });

describe("OrgGate", () => {
  it("renders children only after the registry loaded", async () => {
    let resolve!: (v: unknown) => void;
    setInvokeHandler((cmd) => (cmd === "list_organisations" ? new Promise((r) => { resolve = r; }) : null));
    render(<OrgGate><div>app</div></OrgGate>);
    expect(screen.queryByText("app")).toBeNull();
    resolve({ version: 1, activeId: "o1", organisations: [{ id: "o1", name: "S", createdAt: "", prefs: null }] });
    await waitFor(() => expect(screen.getByText("app")).toBeInTheDocument());
  });
});
