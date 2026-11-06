import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuickCreatePopup } from "../pages/CalendarPage";
import { InvoiceStatusIcon } from "../components/dashboard/InvoiceWidgets";
import { PriorityDot } from "../components/dashboard/widgetParts";
import { useAppStore } from "../stores/app-store";
import { formatDisplayDate } from "../utils/formatDate";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

// U6: dates follow the Settings format, and status is never colour alone.

beforeEach(async () => {
  await getDb();
  setSelectHandler(() => []);
  useAppStore.setState({ language: "EN", dateFormat: "dd.MM.yyyy" });
});

afterEach(() => {
  setSelectHandler(null);
  cleanup();
});

function renderPopup(props: Partial<Parameters<typeof QuickCreatePopup>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <QuickCreatePopup
        pos={{ top: 100, left: 300 }}
        date="2026-11-05"
        startTime={null}
        projects={[{ id: 7, name: "Brand Identity Refresh" }]}
        onSubmit={() => {}}
        onClose={() => {}}
        {...props}
      />
    </QueryClientProvider>
  );
}

describe("formatDisplayDate", () => {
  it("follows the Settings date format", () => {
    expect(formatDisplayDate("2026-11-05")).toBe("05.11.2026");
    expect(formatDisplayDate("2026-11-05", "MM/dd/yyyy")).toBe("11/05/2026");
  });

  it("drops the time of an ISO timestamp", () => {
    expect(formatDisplayDate("2026-11-05T10:00:00")).toBe("05.11.2026");
  });
});

describe("QuickCreatePopup header", () => {
  it("shows the date in the Settings format, not ISO", () => {
    renderPopup();
    expect(screen.getByText(/05\.11\.2026/)).toBeTruthy();
    expect(screen.queryByText(/2026-11-05/)).toBeNull();
  });

  it("shows a dragged range of days and times", () => {
    renderPopup({ endDate: "2026-11-07" });
    expect(screen.getByText(/05\.11\.2026 – 07\.11\.2026/)).toBeTruthy();
    cleanup();
    renderPopup({ startTime: "09:00", endTime: "11:30" });
    expect(screen.getByText(/09:00 – 11:30/)).toBeTruthy();
  });
});

describe("status labels", () => {
  it("names the invoice status next to its icon", () => {
    render(<InvoiceStatusIcon status="overdue" />);
    expect(screen.getByRole("img", { name: "Overdue" })).toBeTruthy();
  });

  it("names the priority of a dot", () => {
    render(<PriorityDot priority="high" />);
    expect(screen.getByRole("img", { name: "Priority: High" })).toBeTruthy();
  });

  it("follows the app language", () => {
    useAppStore.setState({ language: "FR" });
    render(<InvoiceStatusIcon status="paid" />);
    expect(screen.getByRole("img", { name: "Payée" })).toBeTruthy();
  });
});
