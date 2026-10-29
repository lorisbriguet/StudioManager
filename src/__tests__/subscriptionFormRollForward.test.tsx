import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { uiLabels } from "../i18n/ui";
import type { Subscription } from "../types/upkeep";

const create = vi.fn();
const update = vi.fn();
vi.mock("../db/hooks/useUpkeep", () => ({
  useCreateSubscription: () => ({ mutate: create }),
  useUpdateSubscription: () => ({ mutate: update }),
}));
vi.mock("../hooks/useUnsavedChangesWarning", () => ({ useUnsavedChangesWarning: () => {} }));

import { SubscriptionForm } from "../components/upkeep/SubscriptionForm";

const t = uiLabels.EN;

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: 1, name: "Figma", plan: null, vendor: null, url: null,
    renews_on: "2026-12-01", anchor_day: 1, period: "month", cost: 15, currency: "USD",
    status: "active", in_calendar: 1, alert: "default", calendar_event_id: null,
    coming_notified_for: null, notes: null, created_at: "", updated_at: "", ...over,
  };
}

function typeDate(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: t.upkeep_sub_renews_on }), { target: { value } });
}

describe("SubscriptionForm: a past 'renews on'", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 29, 12));
    create.mockReset();
    update.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("is saved as the next renewal from today, keeping the typed day as anchor", () => {
    render(<SubscriptionForm onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Figma" } });
    // A new subscription is yearly by default.
    typeDate("29.02.2024");
    expect(screen.getByText(t.upkeep_sub_renews_rolled.replace("{date}", "28.02.2027"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ renews_on: "2027-02-28", anchor_day: 29, period: "year" });
  });

  it("today or a future date is saved as typed, without a hint", () => {
    render(<SubscriptionForm onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Figma" } });
    typeDate("15.03.2027");
    expect(screen.queryByText(/This date is past/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(create.mock.calls[0][0]).toMatchObject({ renews_on: "2027-03-15" });
    expect(create.mock.calls[0][0].anchor_day).toBeUndefined();
  });

  it("editing a subscription to a past date rolls it too; an unrelated edit leaves the date alone", () => {
    // Monthly, from the original subscription date: the next 31st from today.
    const { unmount } = render(<SubscriptionForm onClose={vi.fn()} subscription={sub()} />);
    typeDate("31.01.2024");
    expect(screen.getByText(t.upkeep_sub_renews_rolled.replace("{date}", "31.10.2026"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(update.mock.calls[0][0].data).toMatchObject({ renews_on: "2026-10-31", anchor_day: 31 });
    unmount();
    render(<SubscriptionForm onClose={vi.fn()} subscription={sub({ renews_on: "2026-05-01" })} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Figma Pro" } });
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(update.mock.calls[1][0].data.renews_on).toBeUndefined();
  });
});
