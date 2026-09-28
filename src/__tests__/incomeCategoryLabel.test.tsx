import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IncomePage } from "../pages/IncomePage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler, clearExecutedStatements } from "../__mocks__/tauri-sql";

// Item 1 regression: the row badge (around line 313) rendered the raw
// category code, and the edit form's `(t as Record<string,string>)[c] ?? c`
// lookup missed too (the codes were never in ui.ts), so it also fell back
// to the raw code. Both sites must show the same translated label and
// never the raw `side_income`-style code.

const income = {
  id: 1,
  reference: "INC-0001",
  source: "Freelance gig",
  description: "",
  category: "side_income",
  date: "2026-01-10",
  amount: 250,
  receipt_path: null,
  notes: "",
  created_at: "",
  updated_at: "",
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IncomePage />
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await getDb();
  setSelectHandler((sql) => (sql.replace(/\s+/g, " ").includes("FROM income") ? [income] : []));
  clearExecutedStatements();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("Income category labels", () => {
  it("shows the translated label on the row badge and in the edit form, agreeing with each other (EN)", async () => {
    useAppStore.setState({ language: "EN" });
    renderPage();

    const row = (await screen.findByText("Freelance gig")).closest("tr")!;
    expect(within(row).getByText("Side income")).toBeInTheDocument();
    expect(within(row).queryByText("side_income")).not.toBeInTheDocument();

    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: /edit/i }));

    const select = (await screen.findByDisplayValue("Side income")) as HTMLSelectElement;
    expect(select.value).toBe("side_income");
    expect(screen.queryByText("side_income")).not.toBeInTheDocument();
  });

  it("shows the translated label in FR", async () => {
    useAppStore.setState({ language: "FR" });
    renderPage();

    const row = (await screen.findByText("Freelance gig")).closest("tr")!;
    expect(within(row).getByText("Revenu accessoire")).toBeInTheDocument();

    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("menuitem", { name: /modifier|edit/i }));

    expect(await screen.findByDisplayValue("Revenu accessoire")).toBeInTheDocument();
  });
});
