import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { OrganisationsCard } from "../components/settings/OrganisationsCard";
import { useOrgStore } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

const reg = { version: 1, activeId: "o1", organisations: [
  { id: "o1", name: "Studio", createdAt: "", prefs: null },
  { id: "o2", name: "Label", createdAt: "", prefs: null },
] };

beforeEach(() => {
  clearInvokedCommands();
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
});
