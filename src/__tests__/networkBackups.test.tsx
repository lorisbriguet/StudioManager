import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";
import type { Connection, Machine, UpkeepItem } from "../types/upkeep";
import type { NetworkCard } from "../lib/network/model";
import type { TimeMachineStatus } from "../lib/network/commands";

let tm: TimeMachineStatus | null = null;
let metrics: { metric: string; value: number }[] = [];
let items: UpkeepItem[] = [];
const createItem = vi.fn();
const q = <T,>(data: T) => ({ data, isPending: false, isError: false });
vi.mock("../hooks/useTimeMachine", () => ({ useTimeMachine: () => q(tm) }));
vi.mock("../db/hooks/useConnections", () => ({
  useLatestMetricsFor: (ids: number[]) => ids.map(() => q(metrics)),
}));
vi.mock("../db/hooks/useUpkeep", () => ({
  useActiveUpkeepItems: () => q(items),
  useCreateUpkeepItem: () => ({ mutate: createItem }),
  useUpdateUpkeepItem: () => ({ mutate: vi.fn() }),
}));
vi.mock("../hooks/useUnsavedChangesWarning", () => ({ useUnsavedChangesWarning: () => {} }));

import { timeMachineState } from "../lib/network/backups";
import { BackupsCard } from "../components/network/BackupsCard";
import { UpkeepItemForm } from "../components/upkeep/UpkeepItemForm";

const t = uiLabels.EN;
const NOW = new Date("2026-11-02T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const status = (over: Partial<TimeMachineStatus> = {}): TimeMachineStatus => ({
  enabled: true, lastBackupAt: ago(1), lastResult: 0, running: false, ...over,
});

describe("timeMachineState", () => {
  it("is success after 1 day", () => {
    expect(timeMachineState(status(), NOW)).toEqual({ show: true, tone: "success", label: "last" });
  });
  it("is a warning after 3 days", () => {
    expect(timeMachineState(status({ lastBackupAt: ago(3) }), NOW).tone).toBe("warning");
  });
  it("is danger after 8 days", () => {
    expect(timeMachineState(status({ lastBackupAt: ago(8) }), NOW).tone).toBe("danger");
  });
  it("is danger when the last result is an error and nothing runs", () => {
    expect(timeMachineState(status({ lastResult: 21 }), NOW).tone).toBe("danger");
  });
  it("running without a backup yet is a warning labelled running", () => {
    expect(timeMachineState(status({ lastBackupAt: null, lastResult: null, running: true }), NOW)).toEqual({
      show: true, tone: "warning", label: "running",
    });
  });
  it("running keeps the tone of the previous backup", () => {
    expect(timeMachineState(status({ lastBackupAt: ago(3), lastResult: 21, running: true }), NOW)).toEqual({
      show: true, tone: "warning", label: "running",
    });
  });
  it("no backup yet and not running is a warning labelled never", () => {
    expect(timeMachineState(status({ lastBackupAt: null }), NOW)).toEqual({ show: true, tone: "warning", label: "never" });
  });
  it("is hidden when disabled or unknown", () => {
    expect(timeMachineState(status({ enabled: false }), NOW).show).toBe(false);
    expect(timeMachineState(null, NOW).show).toBe(false);
  });
});

const nasCard = (): NetworkCard => ({
  machine: { id: 1, name: "Server A", kind: "nas" } as Machine,
  services: [],
  remote: [],
  nas: { id: 9 } as Connection,
});
const backupItem = (over: Partial<UpkeepItem> = {}) =>
  ({
    id: 5, machine_id: 1, title: "Refresh the HDD copy", is_backup: 1, archived: 0, schedule: "interval",
    last_done_on: "2026-10-20", next_due_on: "2026-11-20", snooze_until: null, ...over,
  }) as UpkeepItem;
const renderCard = (cards: NetworkCard[] = [nasCard()]) => render(<BackupsCard cards={cards} now={NOW.getTime()} />);

beforeEach(() => {
  useAppStore.setState({ language: "EN", dateFormat: "dd/MM/yyyy", upkeepSoonDays: 7 });
  tm = null;
  metrics = [];
  items = [];
  createItem.mockReset();
});
afterEach(cleanup);

describe("BackupsCard", () => {
  it("hides sources that are not set up", () => {
    tm = status({ enabled: false });
    renderCard();
    expect(screen.queryByText(t.net_time_machine)).toBeNull();
    expect(screen.queryByText(t.net_nas_snapshots)).toBeNull();
    expect(screen.getByText(t.net_backups_none)).toBeTruthy();
  });

  it("shows Time Machine and the NAS's newest snapshot", () => {
    tm = status({ lastBackupAt: "2026-11-01T09:30:00Z" });
    metrics = [
      { metric: "snapshot_latest_at:docs", value: Date.parse("2026-10-31T03:00:00Z") / 1000 },
      { metric: "snapshot_latest_at:photos", value: Date.parse("2026-10-30T03:00:00Z") / 1000 },
    ];
    renderCard();
    expect(screen.getByText(t.net_time_machine)).toBeTruthy();
    expect(screen.getByText("Last 01/11/2026")).toBeTruthy();
    expect(screen.getByText(t.net_nas_snapshots)).toBeTruthy();
  });

  it("says Running while a backup runs", () => {
    tm = status({ running: true });
    renderCard();
    expect(screen.getByText(t.net_backup_running)).toBeTruthy();
  });

  it("lists upkeep items marked as backups with their last done date", () => {
    items = [backupItem(), backupItem({ id: 6, title: "Not a backup", is_backup: 0 }), backupItem({ id: 7, title: "Offsite copy", last_done_on: null })];
    renderCard();
    expect(screen.getByText("Refresh the HDD copy")).toBeTruthy();
    expect(screen.getByText("Last 20/10/2026")).toBeTruthy();
    expect(screen.getByText("Offsite copy")).toBeTruthy();
    expect(screen.getByText(t.net_backup_never_done)).toBeTruthy();
    expect(screen.queryByText("Not a backup")).toBeNull();
  });
});

describe("UpkeepItemForm", () => {
  it("saves the backup checkbox", () => {
    render(<UpkeepItemForm open onClose={() => {}} machineId={3} allowUsage={false} />);
    fireEvent.change(screen.getByRole("textbox", { name: t.upkeep_item_title }), { target: { value: "Refresh the HDD copy" } });
    fireEvent.click(screen.getByLabelText(t.upkeep_is_backup));
    fireEvent.click(screen.getByText(t.save));
    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({ title: "Refresh the HDD copy", is_backup: 1 }));
  });
});
