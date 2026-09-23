import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";

vi.mock("../lib/demoBuild", () => ({ isDemoBuild: vi.fn(() => false) }));
import { isDemoBuild } from "../lib/demoBuild";
import { SettingsPage } from "../pages/SettingsPage";

function renderPage() {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><MemoryRouter><SettingsPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
  useOrgStore.getState().applyRegistry({ version: 1, activeId: "o1", organisations: [{ id: "o1", name: "Atelier", createdAt: "", prefs: null }] });
});
afterEach(cleanup);

describe("Settings › Demo data category", () => {
  it("is absent in the real build", () => {
    vi.mocked(isDemoBuild).mockReturnValue(false);
    renderPage();
    expect(screen.queryByRole("button", { name: /demo data/i })).toBeNull();
  });

  it("is present in the demo build", () => {
    vi.mocked(isDemoBuild).mockReturnValue(true);
    renderPage();
    expect(screen.getByRole("button", { name: /demo data/i })).toBeInTheDocument();
  });
});
