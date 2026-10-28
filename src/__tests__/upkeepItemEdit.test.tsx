import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { uiLabels } from "../i18n/ui";
import type { UpkeepItem } from "../types/upkeep";

const updateItem = vi.fn();
vi.mock("../db/hooks/useUpkeep", () => ({
  useUpdateUpkeepItem: () => ({ mutate: updateItem }),
  useCreateUpkeepItem: () => ({ mutate: vi.fn() }),
}));
vi.mock("../hooks/useUnsavedChangesWarning", () => ({ useUnsavedChangesWarning: () => {} }));

import { getDb } from "../db";
import { updateUpkeepItem } from "../db/queries/upkeepItems";
import { UpkeepItemForm } from "../components/upkeep/UpkeepItemForm";
import { executedStatements, clearExecutedStatements, setSelectHandler } from "../__mocks__/tauri-sql";

const t = uiLabels.EN;

/** Never done, every 3 months from 2026-07-20: due 2026-10-20 (overdue on 10-28). */
function item(over: Partial<UpkeepItem> = {}): UpkeepItem {
  return {
    id: 7, machine_id: 3, title: "Clean nozzle", notes: null, schedule: "interval",
    interval_n: 3, interval_unit: "month", anchor_day: 20, usage_metric: null, usage_every: null,
    last_done_on: null, last_done_reading: null, next_due_on: "2026-10-20", snooze_until: null,
    in_calendar: 1, alert: "default", calendar_event_id: null, calendar_event_date: null,
    overdue_notified_for: null, archived: 0, created_at: "", updated_at: "",
    ...over,
  };
}

const update = () => executedStatements.find((s) => s.sql.includes("UPDATE upkeep_items"));

describe("updateUpkeepItem on a never-done interval item", () => {
  beforeAll(async () => {
    await getDb();
  });
  beforeEach(() => {
    clearExecutedStatements();
    setSelectHandler((sql) => (sql.includes("FROM upkeep_items") ? [item()] : []));
  });

  it("renaming an overdue item leaves its due date alone (schedule fields resent unchanged)", async () => {
    await updateUpkeepItem(7, {
      title: "Clean the nozzle", notes: null, schedule: "interval",
      interval_n: 3, interval_unit: "month", usage_metric: null, usage_every: null,
    });
    expect(update()!.sql).not.toContain("next_due_on");
    expect(update()!.params).toContain("Clean the nozzle");
  });

  it("a changed interval counts from the item's original start, never from today", async () => {
    await updateUpkeepItem(7, { interval_n: 1 });
    // Started 2026-07-20 (10-20 minus 3 months) → every month → 2026-08-20.
    const u = update()!;
    expect(u.sql).toContain("next_due_on");
    expect(u.params).toContain("2026-08-20");
  });

  it("a changed unit also counts from the original start", async () => {
    await updateUpkeepItem(7, { interval_n: 6, interval_unit: "week" });
    // 2026-07-20 + 6 weeks = 2026-08-31.
    expect(update()!.params).toContain("2026-08-31");
  });

  it("a done item still counts from its last service", async () => {
    setSelectHandler((sql) =>
      sql.includes("FROM upkeep_items") ? [item({ last_done_on: "2026-09-01", next_due_on: "2026-12-01", anchor_day: 1 })] : []);
    await updateUpkeepItem(7, { interval_n: 1 });
    expect(update()!.params).toContain("2026-10-01");
  });
});

describe("UpkeepItemForm (edit)", () => {
  beforeEach(() => updateItem.mockClear());

  it("sends only the fields that changed", () => {
    render(<UpkeepItemForm open onClose={() => {}} machineId={3} item={item()} allowUsage={false} />);
    fireEvent.change(screen.getByDisplayValue("Clean nozzle"), { target: { value: "Clean the nozzle" } });
    fireEvent.click(screen.getByText(t.save));
    expect(updateItem).toHaveBeenCalledWith({ id: 7, data: { title: "Clean the nozzle" } });
  });

  it("sends the schedule when the interval changed", () => {
    render(<UpkeepItemForm open onClose={() => {}} machineId={3} item={item()} allowUsage={false} />);
    fireEvent.change(screen.getByDisplayValue("3"), { target: { value: "2" } });
    fireEvent.click(screen.getByText(t.save));
    expect(updateItem).toHaveBeenCalledWith({ id: 7, data: { interval_n: 2 } });
  });
});
