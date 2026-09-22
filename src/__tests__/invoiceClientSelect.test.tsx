import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { InvoiceFormPage } from "../pages/InvoiceFormPage";
import { QuoteFormPage } from "../pages/QuoteFormPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler, clearExecutedStatements } from "../__mocks__/tauri-sql";
import { ask } from "@tauri-apps/plugin-dialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => false) }));

// Reported: picking a client on a new invoice or quote did not take the first
// time. WebKit fires `input` on a <select> before `change`; the form wrapper
// marked itself dirty on `input`, that first state flip re-rendered the form
// while the client was still empty, React re-applied the empty controlled
// value to the select, and the `change` that followed carried "" again.

function mountAt(path: string, element: React.ReactElement) {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM clients")) {
      return [
        { id: "C-001", name: "Atelier Noir", language: "FR", has_discount: 0, discount_rate: 0 },
        { id: "C-002", name: "Fondation Artvis", language: "FR", has_discount: 1, discount_rate: 0.1 },
      ];
    }
    if (flat.includes("FROM business_profile")) return [{ id: 1, owner_name: "Studio" }];
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Replays WebKit's event order for a native <select> pick: `input`, then `change`. */
async function pickLikeWebKit(select: HTMLSelectElement, value: string) {
  select.value = value;
  fireEvent.input(select);
  // Any state update caused by `input` has now rendered. WebKit dispatches
  // `change` with whatever the element holds at this point.
  expect(select.value, "select value survived the input event").toBe(value);
  fireEvent.change(select);
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  clearExecutedStatements();
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("client select — first pick must stick", () => {
  it("new invoice", async () => {
    mountAt("/invoices/new", <InvoiceFormPage />);
    const select = (await screen.findByLabelText(/client/i)) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
    await pickLikeWebKit(select, "C-002");
    expect((screen.getByLabelText(/client/i) as HTMLSelectElement).value).toBe("C-002");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("new quote", async () => {
    mountAt("/quotes/new", <QuoteFormPage />);
    const select = (await screen.findByLabelText(/client/i)) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
    await pickLikeWebKit(select, "C-002");
    expect((screen.getByLabelText(/client/i) as HTMLSelectElement).value).toBe("C-002");
  });

  it("new invoice still marks the form dirty when typing in a text field", async () => {
    mountAt("/invoices/new", <InvoiceFormPage />);
    await screen.findByLabelText(/client/i);
    const notes = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    fireEvent.change(notes, { target: { value: "x" } });
    // Dirty tracking is what the input listener existed for; removing it must
    // not silence text edits. Navigating back should now ask for confirmation.
    vi.mocked(ask).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(ask).toHaveBeenCalled());
  });
});
