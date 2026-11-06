import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";
import { pickOption } from "./fixtures/dropdown";

const t = uiLabels.EN;

const { getExchangeRate } = vi.hoisted(() => ({
  getExchangeRate: vi.fn(async (_c: string, _d?: string | null): Promise<number | null> => 1.25),
}));
vi.mock("../lib/exchangeRate", async (orig) => ({
  ...(await orig<typeof import("../lib/exchangeRate")>()),
  getExchangeRate: (c: string, d?: string | null) => getExchangeRate(c, d),
}));

let NewExpenseForm: typeof import("../pages/ExpensesPage").NewExpenseForm;

function renderForm(props: Partial<Parameters<typeof NewExpenseForm>[0]> = {}) {
  const onSave = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewExpenseForm
        categories={[{ code: "FA", name_fr: "Frais" }]}
        pastSuppliers={[]}
        prefill={null}
        onSave={onSave}
        onCancel={() => {}}
        {...props}
      />
    </QueryClientProvider>
  );
  return onSave;
}

describe("expense form currency", () => {
  beforeAll(async () => { ({ NewExpenseForm } = await import("../pages/ExpensesPage")); }, 30000);
  beforeEach(() => {
    useAppStore.setState({ language: "EN" });
    getExchangeRate.mockReset();
    getExchangeRate.mockResolvedValue(1.25);
  });

  it("a CHF expense saves its amount with no original", async () => {
    const onSave = renderForm({ prefill: { supplier: "Migros", amount: 20, invoice_date: "2026-11-01" } });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ amount: 20, currency: "CHF", exchange_rate: 1, original_amount: null });
    expect(getExchangeRate).not.toHaveBeenCalled();
  });

  it("a scanned EUR receipt opens in EUR at the rate of its date, editable, and saves CHF", async () => {
    const onSave = renderForm({ prefill: { supplier: "Hotel", amount: 125, currency: "EUR", invoice_date: "2026-11-01" } });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: t.currency })).toHaveTextContent("EUR");
    const rate = await within(dialog).findByDisplayValue("1.25");
    expect(getExchangeRate).toHaveBeenCalledWith("EUR", "2026-11-01");
    // Typed by hand: 1 CHF = 1.0 EUR.
    fireEvent.change(rate, { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ amount: 125, currency: "EUR", exchange_rate: 1, original_amount: 125 });
  });

  it("switching to USD converts at the fetched rate", async () => {
    const onSave = renderForm({ prefill: { supplier: "Figma", amount: 15, invoice_date: "2026-11-01" } });
    const dialog = await screen.findByRole("dialog");
    pickOption(within(dialog).getByRole("combobox", { name: t.currency }), "USD");
    await within(dialog).findByDisplayValue("1.25");
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ amount: 12, currency: "USD", exchange_rate: 1.25, original_amount: 15 });
  });

  it("a supplier booked in USD comes back in USD", async () => {
    renderForm({
      prefill: { supplier: "Figma", invoice_date: "2026-11-01" },
      pastSuppliers: [{ supplier: "Figma", category_code: "FA", amount: 12, currency: "USD", original_amount: 15 }],
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: t.currency })).toHaveTextContent("USD");
    expect(within(dialog).getByDisplayValue("15")).toBeInTheDocument();
  });
});
