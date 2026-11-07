import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAppStore } from "../stores/app-store";
import { documentDisplayRef, statusLabel } from "../lib/documentDisplay";
import { getLabels } from "../lib/notify";

// 2-U3: an invoice shows its own currency (and its CHF equivalent), a
// translated status, and "Draft" instead of its internal DRAFT-<uuid>.

const data = vi.hoisted(() => ({ invoices: [] as unknown[] }));
vi.mock("../db/hooks/useInvoices", () => ({ useInvoices: () => ({ data: data.invoices }) }));
vi.mock("../db/hooks/useClients", () => ({ useClients: () => ({ data: [{ id: "c1", name: "ACME" }] }) }));

import { RecentInvoices, UnpaidInvoices } from "../components/dashboard/InvoiceWidgets";

const row = (over: Record<string, unknown>) => ({
  id: 1, reference: "2026-001", client_id: "c1", status: "sent", invoice_date: "2026-03-01",
  due_date: "2026-03-31", total: 1000, currency: "CHF", chf_equivalent: 1000, ...over,
});

beforeEach(() => useAppStore.setState({ language: "FR" }));
afterEach(cleanup);

describe("invoice widgets", () => {
  it("show a EUR invoice in EUR with its CHF equivalent, not as CHF", () => {
    data.invoices = [row({ currency: "EUR", chf_equivalent: 1250 })];
    render(<MemoryRouter><UnpaidInvoices /></MemoryRouter>);
    expect(screen.getByText(/EUR\s?1.000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/CHF\s?1.250\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/^CHF\s?1.000\.00$/)).not.toBeInTheDocument();
  });

  it("strike through a cancelled invoice's amount", () => {
    data.invoices = [row({ status: "cancelled" })];
    render(<MemoryRouter><RecentInvoices /></MemoryRouter>);
    expect(screen.getByText(/CHF\s?1.000\.00/)).toHaveClass("line-through");
  });
});

describe("document labels", () => {
  it("name a draft Draft, never DRAFT-<uuid>", () => {
    const t = getLabels();
    expect(documentDisplayRef({ reference: "DRAFT-9f2c", status: "draft" }, t)).toBe("Brouillon");
    expect(documentDisplayRef({ reference: "DRAFT-9f2c", status: "paid" }, t)).toBe("Brouillon");
    expect(documentDisplayRef({ reference: "2026-004", status: "paid" }, t)).toBe("2026-004");
  });

  it("translate status codes, and keep an unknown one as is", () => {
    const t = getLabels();
    expect(statusLabel("paid", t)).toBe("Payée");
    expect(statusLabel("on_hold", t)).toBe("En pause");
    expect(statusLabel("weird", t)).toBe("weird");
  });
});
