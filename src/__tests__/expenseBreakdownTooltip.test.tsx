import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { renderWidget } from "../components/dashboard/widgets";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

// Capture the props recharts receives instead of rendering real SVG —
// happy-dom has no layout, so ResponsiveContainer would render nothing.
const captured: { tooltip?: Record<string, unknown>; pie?: Record<string, unknown> } = {};
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pie: (props: Record<string, unknown>) => {
    captured.pie = props;
    return <div>{props.children as ReactNode}</div>;
  },
  Cell: () => null,
  Tooltip: (props: Record<string, unknown>) => {
    captured.tooltip = props;
    return null;
  },
  // Imported by other widgets in the same module; never rendered here.
  BarChart: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  LineChart: () => null,
  Line: () => null,
  Legend: () => null,
}));

const YEAR = new Date().getFullYear();

function renderExpenseBreakdown() {
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("FROM expenses")) {
      return [
        { id: 1, invoice_date: `${YEAR}-03-10`, amount: 4686.5, category_code: "SW" },
      ];
    }
    if (flat.includes("FROM expense_categories")) {
      return [{ code: "SW", name_en: "Software", name_fr: "Logiciels" }];
    }
    return [];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{renderWidget("expense-breakdown")}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  captured.tooltip = undefined;
  captured.pie = undefined;
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

describe("expense breakdown widget", () => {
  it("keeps the category name in the tooltip (no blanked-out name)", async () => {
    renderExpenseBreakdown();
    await waitFor(() => expect(captured.tooltip?.formatter).toBeDefined());

    const formatter = captured.tooltip!.formatter as (v: unknown, n: unknown) => unknown;
    // Returning a plain string lets recharts keep the slice name — the
    // previous [value, ""] tuple blanked it, rendering ": CHF 4686.50".
    expect(formatter(4686.5, "Logiciels")).toBe("CHF 4686.50");
  });

  it("labels slices with name_fr like the Expenses page", async () => {
    renderExpenseBreakdown();
    await waitFor(() => expect(captured.pie?.data).toBeDefined());

    expect(captured.pie!.data).toEqual([{ code: "SW", name: "Logiciels", value: 4686.5 }]);
  });
});
