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

const switchDb = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../db", async () => {
  const actual = await vi.importActual<typeof import("../db")>("../db");
  return { ...actual, switchDb };
});

import { OrgGate } from "../components/OrgGate";
import { useOrgStore } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

const registry = { version: 1, activeId: "o1", organisations: [{ id: "o1", name: "S", createdAt: "", prefs: null }] };

beforeEach(() => {
  clearInvokedCommands();
  switchDb.mockClear();
  useOrgStore.setState({ organisations: [], activeId: "", loaded: false });
  useAppStore.setState({ testMode: false, presentationMode: false });
});
afterEach(() => {
  setInvokeHandler(null);
  cleanup();
  document.querySelectorAll("[role=alert]").forEach((el) => el.remove());
});

describe("OrgGate", () => {
  it("renders children only after the registry loaded", async () => {
    let resolve!: (v: unknown) => void;
    const pending = new Promise((r) => { resolve = r; });
    setInvokeHandler((cmd) => (cmd === "list_organisations" ? pending : null));
    render(<OrgGate><div>app</div></OrgGate>);
    expect(screen.queryByText("app")).toBeNull();
    resolve(registry);
    await waitFor(() => expect(screen.getByText("app")).toBeInTheDocument());
  });

  it("shows the startup failure instead of loading anything when Rust reports one", async () => {
    setInvokeHandler((cmd) =>
      cmd === "get_init_error" ? "upgrade failed and was rolled back\n\nsnapshot: /tmp/studiomanager_upgrade_snapshot.db" : null
    );
    render(<OrgGate><div>app</div></OrgGate>);
    await waitFor(() =>
      expect(document.body.textContent).toContain("studiomanager_upgrade_snapshot.db")
    );
    expect(screen.queryByText("app")).toBeNull();
    // load() must never run: the registry does not exist on this path.
    expect(invokedCommands.map((c) => c.cmd)).not.toContain("list_organisations");
    expect(useOrgStore.getState().loaded).toBe(false);
  });

  it("clears stale mode flags when Rust is on the production database", async () => {
    useAppStore.setState({ testMode: true, presentationMode: false });
    setInvokeHandler((cmd) =>
      cmd === "list_organisations" ? registry : cmd === "get_active_db" ? "orgs/o1/studiomanager.db" : null
    );
    render(<OrgGate><div>app</div></OrgGate>);
    await waitFor(() => expect(screen.getByText("app")).toBeInTheDocument());
    expect(useAppStore.getState().testMode).toBe(false);
    expect(switchDb).toHaveBeenCalledWith("studiomanager.db");
  });

  it("leaves a genuine mode alone", async () => {
    useAppStore.setState({ testMode: true, presentationMode: false });
    setInvokeHandler((cmd) =>
      cmd === "list_organisations" ? registry : cmd === "get_active_db" ? "orgs/o1/studiomanager_test.db" : null
    );
    render(<OrgGate><div>app</div></OrgGate>);
    await waitFor(() => expect(screen.getByText("app")).toBeInTheDocument());
    expect(useAppStore.getState().testMode).toBe(true);
    expect(switchDb).not.toHaveBeenCalled();
  });
});
