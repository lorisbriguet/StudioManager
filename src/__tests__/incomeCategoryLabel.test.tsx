import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IncomePage } from "../pages/IncomePage";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";
import { getDb } from "../db";
import { setSelectHandler, clearExecutedStatements } from "../__mocks__/tauri-sql";

// The edit form used to render category codes via `c.replace(/_/g, " ")`
// while the filter bar's category options used the i18n lookup — the two
// disagreed on the same value. Both must go through one shared expression.

const INCOME_CATEGORIES = ["side_income", "grant", "refund", "interest", "other"];

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
  useAppStore.setState({ language: "EN" });
  setSelectHandler(() => []);
  clearExecutedStatements();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("Income category labels", () => {
  it("renders the edit form's category options through the same i18n lookup as the filter bar", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /new income/i }));

    const select = (await screen.findByLabelText(uiLabels.EN.category)) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);

    const t = uiLabels.EN as unknown as Record<string, string>;
    const expected = INCOME_CATEGORIES.map((c) => t[c] ?? c);
    expect(optionLabels).toEqual(expected);

    // Underscore-replaced text ("side income") must no longer appear — that
    // was the edit-form-only rendering that disagreed with the filter bar.
    expect(optionLabels).not.toContain("side income");
  });
});
