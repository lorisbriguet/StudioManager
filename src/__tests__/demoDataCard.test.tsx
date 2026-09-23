import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DemoDataCard } from "../components/settings/DemoDataCard";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { setInvokeHandler } from "../__mocks__/tauri-api";
import { toast } from "sonner";

const ask = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => false);
// "@tauri-apps/plugin-dialog" and "../__mocks__/tauri-api" (imported below for
// setInvokeHandler) resolve to the same aliased file (vitest.config.ts), so a
// factory that returns only `{ ask }` would also replace invoke/setInvokeHandler
// for every other module resolving to that file. Spread the original mock so
// invoke keeps working and only `ask` is overridden.
vi.mock("@tauri-apps/plugin-dialog", async (importOriginal) => ({ ...(await importOriginal<object>()), ask: (...a: unknown[]) => ask(...a) }));
const seedPersona = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock("../db/seeds/personas", async (orig) => ({ ...(await orig<object>()), seedPersona: (...a: unknown[]) => seedPersona(...a) }));
vi.mock("../lib/notifyError", () => ({ notifyError: vi.fn(), getLabels: () => new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const reg = { version: 1, activeId: "o2", organisations: [
  { id: "o1", name: "Atelier", createdAt: "", prefs: null },
  { id: "o2", name: "Aurore", createdAt: "", prefs: null },
] };

function renderCard() {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><MemoryRouter><DemoDataCard /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  ask.mockReset().mockResolvedValue(false);
  seedPersona.mockClear();
  useAppStore.setState({ language: "EN", testMode: false, presentationMode: false, showIncome: false, showTasksPage: false });
  useOrgStore.getState().applyRegistry(reg);
  setInvokeHandler(() => reg);
});
afterEach(() => { setInvokeHandler(null); cleanup(); });

describe("DemoDataCard", () => {
  it("is disabled while test mode is on", () => {
    useAppStore.setState({ testMode: true });
    renderCard();
    const button = screen.getByRole("button", { name: /load into this organisation/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/exit test mode/i));
  });

  it("is disabled while presentation mode is on", () => {
    useAppStore.setState({ presentationMode: true });
    renderCard();
    const button = screen.getByRole("button", { name: /load into this organisation/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/exit presentation mode/i));
  });

  it("does nothing when the confirmation is declined", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /load into this organisation/i }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(String(ask.mock.calls[0][0])).toContain("Aurore");
    expect(seedPersona).not.toHaveBeenCalled();
  });

  it("loads the chosen persona with its configuration and applies its preferences", async () => {
    ask.mockResolvedValue(true);
    renderCard();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "music" } });
    fireEvent.click(screen.getByRole("button", { name: /load into this organisation/i }));
    await waitFor(() => expect(seedPersona).toHaveBeenCalledTimes(1));
    expect(seedPersona.mock.calls[0][1]).toBe("music");
    expect(seedPersona.mock.calls[0][2]).toEqual({ withConfig: true });
    await waitFor(() => expect(useAppStore.getState().showIncome).toBe(true));
    expect(useAppStore.getState().showTasksPage).toBe(true);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Aurore")));
  });
});
