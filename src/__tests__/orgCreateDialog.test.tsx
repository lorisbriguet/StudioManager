import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgCreateDialog } from "../components/OrgCreateDialog";
import { useOrgStore } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

const base = { version: 1, activeId: "o1", organisations: [{ id: "o1", name: "Studio", createdAt: "", prefs: null }] };

beforeEach(() => {
  clearInvokedCommands();
  useAppStore.setState({ language: "EN", testMode: false, presentationMode: false, activeTimer: null });
  useOrgStore.getState().applyRegistry(base);
  setInvokeHandler((cmd, args) => {
    if (cmd === "create_organisation") return { ...base, organisations: [...base.organisations, { id: "o2", name: args.name, createdAt: "", prefs: args.prefs }] };
    if (cmd === "switch_organisation") return { ...base, activeId: "o2", organisations: [...base.organisations, { id: "o2", name: "Label", createdAt: "", prefs: null }] };
    return null;
  });
});
afterEach(() => { setInvokeHandler(null); cleanup(); });

function mount(onClose = vi.fn()) {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OrgCreateDialog open onClose={onClose} /></MemoryRouter></QueryClientProvider>);
  return onClose;
}

describe("OrgCreateDialog", () => {
  it("requires a name", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /create organisation/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
    expect(invokedCommands.some((c) => c.cmd === "create_organisation")).toBe(false);
  });

  it("creates with the chosen seeding option, switches, and closes", async () => {
    const onClose = mount();
    fireEvent.change(screen.getByLabelText(/organisation name/i), { target: { value: "Label" } });
    fireEvent.click(screen.getByLabelText(/start from the current/i));
    fireEvent.click(screen.getByRole("button", { name: /create organisation/i }));
    await waitFor(() => expect(invokedCommands.find((c) => c.cmd === "create_organisation")?.args).toMatchObject({ name: "Label", seedFromCurrent: true }));
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "switch_organisation" && c.args.id === "o2")).toBe(true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
