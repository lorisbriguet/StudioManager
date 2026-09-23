import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { OrganisationsCard } from "../components/settings/OrganisationsCard";
import { useOrgStore } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";
import { notifyError } from "../lib/notifyError";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

vi.mock("../lib/notifyError", () => ({
  notifyError: vi.fn(),
  getLabels: () => new Proxy({}, { get: (_t, k) => String(k) }),
}));

const reg = { version: 1, activeId: "o1", organisations: [
  { id: "o1", name: "Studio", createdAt: "", prefs: null },
  { id: "o2", name: "Label", createdAt: "", prefs: null },
] };

beforeEach(() => {
  clearInvokedCommands();
  vi.mocked(notifyError).mockClear();
  useAppStore.setState({ language: "EN" });
  useOrgStore.getState().applyRegistry(reg);
  setInvokeHandler((cmd, args) => {
    if (cmd === "rename_organisation") return { ...reg, organisations: reg.organisations.map((o) => (o.id === args.id ? { ...o, name: args.name as string } : o)) };
    if (cmd === "delete_organisation") return { ...reg, organisations: reg.organisations.filter((o) => o.id !== args.id) };
    return null;
  });
});
afterEach(() => { setInvokeHandler(null); cleanup(); });

describe("OrganisationsCard", () => {
  it("renames inline on Enter", async () => {
    render(<OrganisationsCard />);
    fireEvent.click(screen.getAllByRole("button", { name: /rename/i })[1]);
    const input = screen.getByDisplayValue("Label");
    fireEvent.change(input, { target: { value: "Music Label" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(invokedCommands.find((c) => c.cmd === "rename_organisation")?.args).toEqual({ id: "o2", name: "Music Label" }));
    await waitFor(() => expect(screen.getByText("Music Label")).toBeInTheDocument());
  });

  it("disables delete on the active organisation and requires typing the name for others", async () => {
    render(<OrganisationsCard />);
    const deletes = screen.getAllByRole("button", { name: /delete organisation/i });
    expect(deletes[0]).toBeDisabled();
    fireEvent.click(deletes[1]);
    const confirmBtn = screen.getByRole("button", { name: /^delete$/i });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Label"), { target: { value: "Label" } });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "delete_organisation" && c.args.id === "o2")).toBe(true));
    await waitFor(() => expect(screen.queryByText("Label")).toBeNull());
  });

  it("shows a required message and does not invoke when the new name is blank", async () => {
    render(<OrganisationsCard />);
    fireEvent.click(screen.getAllByRole("button", { name: /rename/i })[1]);
    const input = screen.getByDisplayValue("Label");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(uiLabels.EN.organisation_name_required)).toBeInTheDocument();
    expect(invokedCommands.some((c) => c.cmd === "rename_organisation")).toBe(false);
    expect(input).toHaveValue("   ");
  });

  it("shows a taken message and does not invoke when the new name matches another organisation", async () => {
    render(<OrganisationsCard />);
    fireEvent.click(screen.getAllByRole("button", { name: /rename/i })[1]);
    const input = screen.getByDisplayValue("Label");
    fireEvent.change(input, { target: { value: "studio" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText(uiLabels.EN.organisation_name_taken)).toBeInTheDocument();
    expect(invokedCommands.some((c) => c.cmd === "rename_organisation")).toBe(false);
  });

  it("calls notifyError and keeps the edit open when the rename is rejected", async () => {
    setInvokeHandler((cmd) => {
      if (cmd === "rename_organisation") throw new Error("boom");
      return null;
    });
    render(<OrganisationsCard />);
    fireEvent.click(screen.getAllByRole("button", { name: /rename/i })[1]);
    const input = screen.getByDisplayValue("Label");
    fireEvent.change(input, { target: { value: "Music Label" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(notifyError).toHaveBeenCalledWith(uiLabels.EN.operation_failed, expect.any(Error)));
    expect(screen.getByDisplayValue("Music Label")).toBeInTheDocument();
  });
});
