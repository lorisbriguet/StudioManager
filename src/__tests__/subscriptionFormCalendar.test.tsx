import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { uiLabels } from "../i18n/ui";
import { useAppStore } from "../stores/app-store";
import { pickOption } from "./fixtures/dropdown";

const create = vi.fn();
vi.mock("../db/hooks/useUpkeep", () => ({
  useCreateSubscription: () => ({ mutate: create }),
  useUpdateSubscription: () => ({ mutate: vi.fn() }),
}));
vi.mock("../hooks/useUnsavedChangesWarning", () => ({ useUnsavedChangesWarning: () => {} }));

import { SubscriptionForm } from "../components/upkeep/SubscriptionForm";

const t = uiLabels.EN;
const trigger = () => screen.getByLabelText(t.upkeep_in_calendar);

describe("SubscriptionForm: In calendar", () => {
  beforeEach(() => create.mockReset());

  it("is a dropdown of Not in calendar and the organisation's calendar, saved as the 0/1 flag", () => {
    useAppStore.setState({ calendarName: "Studio" });
    render(<SubscriptionForm onClose={vi.fn()} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(trigger()).toHaveTextContent("Studio");
    pickOption(trigger(), t.upkeep_not_in_calendar);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Figma" } });
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(create.mock.calls[0][0]).toMatchObject({ in_calendar: 0 });
  });

  it("shows only Not in calendar and a hint when no calendar is set up", () => {
    useAppStore.setState({ calendarName: "" });
    render(<SubscriptionForm onClose={vi.fn()} />);
    fireEvent.click(trigger());
    const names = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual([t.upkeep_not_in_calendar, t.upkeep_calendar_setup_hint]);
  });
});
