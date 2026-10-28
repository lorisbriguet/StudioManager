import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { buildUpkeepOverview } from "../lib/upkeep/overview";
import type { UpkeepOverview } from "../lib/upkeep/overview";
import type { Machine, UpkeepItem } from "../types/upkeep";

let overview: UpkeepOverview;
let pending: { id: number; name: string; amount: number; currency: string; renewed_on: string }[] = [];
const syncAll = vi.fn(async () => 0);

vi.mock("../db/hooks/useConnections", () => {
  const m = () => ({ mutate: () => {}, mutateAsync: async () => 0, isPending: false });
  return {
    useConnections: () => ({ data: [] }),
    useMachineDisks: () => ({ data: [] }),
    useCurrentReading: () => ({ data: null }),
    useLinkMachine: m, useRecordManualReading: m, useSyncNow: m,
    useCreateConnection: m, useUpdateConnection: m, useDeleteConnection: m,
  };
});
vi.mock("../db/hooks/useUpkeep", () => ({
  useUpkeepOverview: () => overview,
  usePendingRenewals: () => ({ data: pending }),
  useMarkUpkeepDone: () => ({ mutate: vi.fn() }),
  useSnoozeUpkeep: () => ({ mutate: vi.fn() }),
}));
vi.mock("../lib/upkeep/calendar", () => ({ syncAllUpkeepEvents: () => Promise.resolve(syncAll()) }));

import { UpkeepWidget } from "../components/upkeep/UpkeepWidget";
import { UpkeepSettingsCard } from "../components/settings/UpkeepSettingsCard";

const empty: UpkeepOverview = { due: [], lowStock: [], endingSoon: [], replacements: [], overdueCount: 0 };

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
  localStorage.clear();
  pending = [];
  overview = empty;
  syncAll.mockClear();
  useOrgStore.setState({ activeId: "o1", savePrefs: vi.fn(async () => {}) });
});
afterEach(cleanup);

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("UpkeepWidget", () => {
  it("lists overdue first and hides empty sections", () => {
    const it = (id: number, title: string, next: string) =>
      ({ id, machine_id: 1, title, schedule: "interval", interval_n: 1, interval_unit: "month",
        next_due_on: next, snooze_until: null, archived: 0, usage_metric: null } as unknown as UpkeepItem);
    // Soon row listed first on purpose: the overview must sort overdue ahead of it.
    overview = buildUpkeepOverview({
      items: [it(2, "Soon job", "2026-11-01"), it(1, "Late job", "2026-10-01")],
      machines: [{ id: 1, name: "Prusa", status: "working" } as Machine],
      consumables: [], subscriptions: [], todayISO: "2026-10-28",
      soonDays: 14, warrantyWindowDays: 60, renewalWindowDays: 14,
    });
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

describe("CollapsibleSection persistence", () => {
  it("keys the collapse state by organisation and survives a remount", () => {
    useOrgStore.setState({ activeId: "o1" });
    overview = { ...empty, endingSoon: [{ kind: "renewal", name: "Figma", date: "2026-11-02" }] };
    const first = wrap(<UpkeepWidget />);
    fireEvent.click(screen.getByRole("button", { name: /Warranty and renewals/ }));
    expect(localStorage.getItem("upkeep-collapsed:widget-ending:o1")).toBe("1");
    first.unmount();
    wrap(<UpkeepWidget />);
    expect(screen.queryByText("Figma")).toBeNull();
    cleanup();
    useOrgStore.setState({ activeId: "o2" });
    wrap(<UpkeepWidget />);
    expect(screen.getByText("Figma")).toBeInTheDocument();
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

  it("lets the days field be cleared and retyped", () => {
    useAppStore.setState({ renewalWindowDays: 14 });
    render(<UpkeepSettingsCard />);
    const input = screen.getByLabelText("Renewal window (days)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    expect(useAppStore.getState().renewalWindowDays).toBe(14);
    fireEvent.change(input, { target: { value: "21" } });
    expect(useAppStore.getState().renewalWindowDays).toBe(21);
    expect(input.value).toBe("21");
  });

  it("writes the look-ahead windows", () => {
    render(<UpkeepSettingsCard />);
    fireEvent.change(screen.getByLabelText("Renewal window (days)"), { target: { value: "30" } });
    expect(useAppStore.getState().renewalWindowDays).toBe(30);
  });
});
