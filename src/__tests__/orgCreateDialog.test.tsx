import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { OrgCreateDialog } from "../components/OrgCreateDialog";
import { useOrgStore } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";
import { notifyError } from "../lib/notifyError";
import { confirmIfDirty } from "../lib/dirty-guard";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("../lib/notifyError", () => ({
  notifyError: vi.fn(),
  getLabels: () => new Proxy({}, { get: (_t, k) => String(k) }),
}));

// Only confirmIfDirty is exercised through OrgCreateDialog -> switchOrganisation;
// defaults to accepting so the happy-path tests behave like a clean app state.
vi.mock("../lib/dirty-guard", () => ({
  confirmIfDirty: vi.fn(async () => true),
  isConfirming: () => false,
  registerDirtyGuard: () => () => {},
}));

const base = { version: 1, activeId: "o1", organisations: [{ id: "o1", name: "Studio", createdAt: "", prefs: null }] };

beforeEach(() => {
  clearInvokedCommands();
  vi.mocked(toast.success).mockClear();
  vi.mocked(notifyError).mockClear();
  vi.mocked(confirmIfDirty).mockClear();
  vi.mocked(confirmIfDirty).mockResolvedValue(true);
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

  it("closes without a switched toast when the user declines the switch", async () => {
    vi.mocked(confirmIfDirty).mockResolvedValueOnce(false);
    const onClose = mount();
    fireEvent.change(screen.getByLabelText(/organisation name/i), { target: { value: "Label" } });
    fireEvent.click(screen.getByRole("button", { name: /create organisation/i }));
    // The organisation is still created...
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "create_organisation")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(uiLabels.EN.organisation_created));
    // ...but the decline short-circuits switchOrganisation before it calls switch_organisation,
    // and the dialog still closes (the org exists and is selectable from the switcher).
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(invokedCommands.some((c) => c.cmd === "switch_organisation")).toBe(false);
    expect(toast.success).not.toHaveBeenCalledWith(uiLabels.EN.organisation_switched.replace("{name}", "Label"));
  });

  it("keeps the dialog open with the typed name when creation fails", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "create_organisation") throw new Error("create failed");
      return null;
    });
    mount();
    fireEvent.change(screen.getByLabelText(/organisation name/i), { target: { value: "Label" } });
    fireEvent.click(screen.getByRole("button", { name: /create organisation/i }));
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith(uiLabels.EN.organisation_create_failed, expect.any(Error)));
    expect(screen.getByLabelText(/organisation name/i)).toHaveValue("Label");
    expect(invokedCommands.some((c) => c.cmd === "switch_organisation")).toBe(false);
    // Still open and usable: the Create button is present and not stuck busy.
    expect(screen.getByRole("button", { name: /create organisation/i })).not.toBeDisabled();
  });

  it("submits only once for two rapid Enter presses", async () => {
    const onClose = mount();
    const input = screen.getByLabelText(/organisation name/i);
    fireEvent.change(input, { target: { value: "Label" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(invokedCommands.filter((c) => c.cmd === "create_organisation")).toHaveLength(1);
  });
});
