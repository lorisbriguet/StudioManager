import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { WorkloadColumnEditor } from "../components/workload/WorkloadColumnEditor";
import { ClientDetailPage } from "../pages/ClientDetailPage";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

// Enter-to-save sweep: every small form should submit on Enter, matching the
// pattern used by NamedTable / SavedFilterBar / ClientDetailPage contacts.

function renderEditor(onSave = vi.fn(), onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <WorkloadColumnEditor column={null} onSave={onSave} onClose={onClose} />
    </QueryClientProvider>
  );
  return { onSave, onClose };
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

describe("WorkloadColumnEditor Enter-to-save", () => {
  it("saves on Enter in the column name input", () => {
    const { onSave, onClose } = renderEditor();
    const nameInput = screen.getAllByRole("textbox")[0];
    fireEvent.change(nameInput, { target: { value: "My Col" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My Col", key: "my_col" })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("saves on Enter in the formula input", () => {
    const { onSave } = renderEditor();
    const nameInput = screen.getAllByRole("textbox")[0];
    fireEvent.change(nameInput, { target: { value: "Calc" } });
    const typeSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(typeSelect, { target: { value: "formula" } });
    const formulaInput = screen.getByPlaceholderText(/og_scope/);
    fireEvent.change(formulaInput, { target: { value: "1 + 2" } });
    fireEvent.keyDown(formulaInput, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Calc", type: "formula", formula: "1 + 2" })
    );
  });
});

describe("ClientDetailPage Enter-to-save", () => {
  const clientRow = {
    id: "c1",
    name: "ACME SA",
    language: "FR",
    has_discount: 0,
    email: "",
    phone: "",
    notes: "",
  };
  const addressRow = {
    id: 1,
    client_id: "c1",
    label: "HQ",
    billing_name: "ACME SA",
    address_line1: "Rue 1",
    address_line2: "",
    postal_city: "1000 Lausanne",
  };

  function renderPage() {
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("FROM client_addresses")) return [addressRow];
      if (flat.includes("FROM client_contacts")) return [];
      if (flat.includes("FROM clients")) return [clientRow];
      return [];
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/clients/c1"]}>
          <Routes>
            <Route path="/clients/:id" element={<ClientDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("commits a details field on Enter", async () => {
    renderPage();
    const nameInput = await screen.findByDisplayValue("ACME SA");
    fireEvent.change(nameInput, { target: { value: "ACME Renamed" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });
    await waitFor(() => {
      const upd = executedStatements.find((s) => s.sql.includes("UPDATE clients"));
      expect(upd).toBeDefined();
      expect(upd!.params).toContain("ACME Renamed");
    });
  });

  it("saves an address edit on Enter", async () => {
    renderPage();
    await screen.findByText("Rue 1");
    fireEvent.click(screen.getAllByLabelText("Edit")[0]);
    const labelInput = await screen.findByDisplayValue("HQ");
    fireEvent.change(labelInput, { target: { value: "New HQ" } });
    fireEvent.keyDown(labelInput, { key: "Enter" });
    await waitFor(() => {
      const upd = executedStatements.find((s) => s.sql.includes("UPDATE client_addresses"));
      expect(upd).toBeDefined();
      expect(upd!.params).toContain("New HQ");
    });
  });
});
