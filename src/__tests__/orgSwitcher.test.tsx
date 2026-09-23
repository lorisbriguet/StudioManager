import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgSwitcher } from "../components/layout/OrgSwitcher";
import { useOrgStore } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

const registry = { version: 1, activeId: "o1", organisations: [
  { id: "o1", name: "Studio", createdAt: "", prefs: null },
  { id: "o2", name: "Label", createdAt: "", prefs: null },
] };

function mount(onCreate = vi.fn()) {
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><MemoryRouter><OrgSwitcher collapsed={false} onCreate={onCreate} /></MemoryRouter></QueryClientProvider>);
  return onCreate;
}

beforeEach(() => {
  clearInvokedCommands();
  useAppStore.setState({ language: "EN", testMode: false, presentationMode: false, activeTimer: null });
  useOrgStore.getState().applyRegistry(registry);
  setInvokeHandler((cmd, args) => (cmd === "switch_organisation" ? { ...registry, activeId: args.id } : null));
});
afterEach(() => { setInvokeHandler(null); cleanup(); });

describe("OrgSwitcher", () => {
  it("shows the active name and lists the others on click", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /studio/i }));
    expect(screen.getByRole("menuitem", { name: /label/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /new organisation/i })).toBeInTheDocument();
  });

  it("switches when another organisation is chosen", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /studio/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /label/i }));
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "switch_organisation" && c.args.id === "o2")).toBe(true));
    await waitFor(() => expect(useOrgStore.getState().activeId).toBe("o2"));
  });

  it("opens the create dialog callback", () => {
    const onCreate = mount();
    fireEvent.click(screen.getByRole("button", { name: /studio/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /new organisation/i }));
    expect(onCreate).toHaveBeenCalled();
  });

  it("opens on the Cmd+Shift+O window event", async () => {
    mount();
    window.dispatchEvent(new CustomEvent("sm:open-org-switcher"));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /label/i })).toBeInTheDocument());
  });
});
