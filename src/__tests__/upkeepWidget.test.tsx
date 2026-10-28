import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAppStore } from "../stores/app-store";
import type { UpkeepOverview } from "../lib/upkeep/overview";
import type { Machine, UpkeepItem } from "../types/upkeep";

let overview: UpkeepOverview;
let pending: { id: number; name: string; amount: number; currency: string; renewed_on: string }[] = [];
const syncAll = vi.fn(async () => 0);

vi.mock("../db/hooks/useUpkeep", () => ({
  useUpkeepOverview: () => overview,
  usePendingRenewals: () => ({ data: pending }),
  useMarkUpkeepDone: () => ({ mutate: vi.fn() }),
  useSnoozeUpkeep: () => ({ mutate: vi.fn() }),
}));
vi.mock("../lib/upkeep/calendar", () => ({ syncAllUpkeepEvents: () => syncAll() }));

import { UpkeepWidget } from "../components/upkeep/UpkeepWidget";
import { UpkeepSettingsCard } from "../components/settings/UpkeepSettingsCard";

const machine = (id: number, name: string) => ({ id, name } as Machine);
const item = (id: number, title: string) => ({ id, title, schedule: "interval" } as UpkeepItem);
const empty: UpkeepOverview = { due: [], lowStock: [], endingSoon: [], replacements: [], overdueCount: 0 };

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
  localStorage.clear();
  pending = [];
  overview = empty;
  syncAll.mockClear();
});
afterEach(cleanup);

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("UpkeepWidget", () => {
  it("lists overdue first and hides empty sections", () => {
    overview = {
      ...empty,
      due: [
        { item: item(1, "Late job"), machine: machine(1, "Prusa"), due: "2026-10-01", state: "overdue" },
        { item: item(2, "Soon job"), machine: machine(1, "Prusa"), due: "2026-11-01", state: "soon" },
      ],
      overdueCount: 1,
    };
    wrap(<UpkeepWidget />);
    const rows = screen.getAllByText(/job/).map((e) => e.textContent);
    expect(rows).toEqual(["Late job", "Soon job"]);
    expect(screen.queryByText("Low stock")).toBeNull();
    expect(screen.queryByText("Warranty and renewals")).toBeNull();
    expect(screen.queryByText("Renewals to confirm")).toBeNull();
  });

  it("shows one quiet line when everything is empty", () => {
    wrap(<UpkeepWidget />);
    expect(screen.getByText("Nothing needs attention.")).toBeInTheDocument();
  });

  it("links a pending renewal to the subscriptions tab", () => {
    pending = [{ id: 5, name: "Adobe", amount: 60, currency: "CHF", renewed_on: "2026-10-20" }];
    wrap(<UpkeepWidget />);
    const link = screen.getByRole("link", { name: /Adobe/ });
    expect(link).toHaveAttribute("href", "/upkeep?tab=subscriptions");
  });

  it("collapses a section from its chevron header", () => {
    overview = { ...empty, endingSoon: [{ kind: "renewal", name: "Figma", date: "2026-11-02" }] };
    wrap(<UpkeepWidget />);
    expect(screen.getByText("Figma")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Warranty and renewals/ }));
    expect(screen.queryByText("Figma")).toBeNull();
  });
});

describe("UpkeepSettingsCard", () => {
  it("writes upkeepAlertDefault and re-syncs existing calendar events", () => {
    useAppStore.setState({ upkeepAlertDefault: "day_9am" });
    render(<UpkeepSettingsCard />);
    fireEvent.change(screen.getByLabelText("Calendar alert"), { target: { value: "week_before" } });
    expect(useAppStore.getState().upkeepAlertDefault).toBe("week_before");
    expect(syncAll).toHaveBeenCalledTimes(1);
  });

  it("writes the look-ahead windows", () => {
    render(<UpkeepSettingsCard />);
    fireEvent.change(screen.getByLabelText("Renewal window (days)"), { target: { value: "30" } });
    expect(useAppStore.getState().renewalWindowDays).toBe(30);
  });
});
