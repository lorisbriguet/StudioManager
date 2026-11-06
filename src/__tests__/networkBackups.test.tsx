import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";
import type { Connection, Machine, UpkeepItem } from "../types/upkeep";
import type { NetworkCard } from "../lib/network/model";
import type { TimeMachineStatus } from "../lib/network/commands";

let tm: TimeMachineStatus | null = null;
let metrics: { metric: string; value: number }[] = [];
let items: UpkeepItem[] = [];
let pending = false;
let failed = false;
const refetch = vi.fn();
const createItem = vi.fn();
const q = <T,>(data: T) => ({ data: pending || failed ? undefined : data, isPending: pending, isError: failed, isFetching: false, refetch });
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

import { timeMachineState, timeMachineRows, ageTone } from "../lib/network/backups";
import { BackupsCard } from "../components/network/BackupsCard";
import { UpkeepItemForm } from "../components/upkeep/UpkeepItemForm";

const t = uiLabels.EN;
const NOW = new Date("2026-11-02T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const status = (over: Partial<TimeMachineStatus> = {}): TimeMachineStatus => ({
  enabled: true, lastBackupAt: ago(1), lastResult: 0, running: false, computerName: "Studio MacBook", ...over,
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

describe("ageTone", () => {
  it("is success up to 2 days, warning up to 7, danger beyond", () => {
    expect(ageTone(ago(1), NOW)).toBe("success");
    expect(ageTone(ago(3), NOW)).toBe("warning");
    expect(ageTone(ago(8), NOW)).toBe("danger");
  });
});

const sec = (iso: string) => Date.parse(iso) / 1000;

describe("timeMachineRows", () => {
  it("keeps the plain local row when the NAS holds no backup", () => {
    const rows = timeMachineRows(status(), [], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "tm", name: null, isThisMac: true, tone: "success" });
  });

  it("merges this Mac's bundle with the local reading, apostrophes aside, and lists the others", () => {
    const rows = timeMachineRows(
      status({ computerName: "Loris’s MacBook Pro", lastBackupAt: ago(1) }),
      [
        { computer: "Loris's MacBook Pro", at: sec(ago(2)) },
        { computer: "Loris’s Mac mini", at: sec(ago(3)) },
      ],
      NOW
    );
    expect(rows.map((r) => r.name)).toEqual(["Loris’s MacBook Pro", "Loris’s Mac mini"]);
    expect(rows[0]).toMatchObject({ isThisMac: true, lastBackupAt: ago(1), tone: "success" });
    expect(rows[1]).toMatchObject({ isThisMac: false, tone: "warning", label: "last" });
  });

  it("takes the NAS date when it is newer than the local one", () => {
    const rows = timeMachineRows(status({ lastBackupAt: ago(9), lastResult: 21 }), [{ computer: "Studio MacBook", at: sec(ago(1)) }], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tone: "success", lastBackupAt: ago(1) });
  });

  it("still lists the NAS backups when Time Machine is off on this Mac", () => {
    const rows = timeMachineRows(status({ enabled: false }), [{ computer: "Studio Mac mini", at: sec(ago(8)) }], NOW);
    expect(rows).toEqual([
      { key: "tm-nas:Studio Mac mini", name: "Studio Mac mini", isThisMac: false, tone: "danger", label: "last", lastBackupAt: ago(8) },
    ]);
  });

  it("shows a computer backed up to two NASes once, with its newest backup", () => {
    const rows = timeMachineRows(null, [
      { computer: "Mini", at: sec(ago(5)) },
      { computer: "Mini", at: sec(ago(1)) },
    ], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].lastBackupAt).toBe(ago(1));
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
  pending = false;
  failed = false;
  refetch.mockReset();
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

  it("lists one tooltip entry per share", () => {
    vi.useFakeTimers();
    try {
      metrics = [
        { metric: "snapshot_latest_at:docs", value: Date.parse("2026-10-31T03:00:00Z") / 1000 },
        { metric: "snapshot_latest_at:photos", value: Date.parse("2026-10-30T03:00:00Z") / 1000 },
      ];
      renderCard();
      fireEvent.mouseEnter(screen.getByText("Last 31/10/2026"));
      act(() => { vi.advanceTimersByTime(500); });
      const entries = screen.getAllByTestId("snapshot-share").map((e) => e.textContent);
      expect(entries).toEqual(["docs: 31/10/2026", "photos: 30/10/2026"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("colours the NAS snapshot by age like Time Machine", () => {
    const at = (d: number) => Date.parse(ago(d)) / 1000;
    for (const [days, cls] of [[1, "bg-success"], [3, "bg-warning"], [8, "bg-danger"]] as const) {
      metrics = [{ metric: "snapshot_latest_at:docs", value: at(days) }];
      const { container, unmount } = renderCard();
      expect(container.querySelector(`li .${cls}`)).not.toBeNull();
      unmount();
    }
  });

  it("shows a skeleton, not the empty text, while loading", () => {
    pending = true;
    renderCard();
    expect(screen.queryByText(t.net_backups_none)).toBeNull();
  });

  it("shows a danger callout with Retry when a read fails", () => {
    failed = true;
    renderCard();
    expect(screen.queryByText(t.net_backups_none)).toBeNull();
    fireEvent.click(screen.getByText(t.retry));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows one Time Machine row per Mac when the NAS keeps their backups", () => {
    tm = status({ computerName: "Studio MacBook", lastBackupAt: "2026-11-02T09:00:00Z" });
    metrics = [
      { metric: "time_machine_latest_at:Studio MacBook", value: sec("2026-11-01T09:00:00Z") },
      { metric: "time_machine_latest_at:Studio Mac mini", value: sec("2026-10-31T09:00:00Z") },
    ];
    renderCard();
    expect(screen.getByText(`${t.net_time_machine} · Studio MacBook`)).toBeTruthy();
    expect(screen.getByText("Last 02/11/2026")).toBeTruthy();
    expect(screen.getByText(`${t.net_time_machine} · Studio Mac mini`)).toBeTruthy();
    expect(screen.getByText("Last 31/10/2026")).toBeTruthy();
    expect(screen.queryByText(t.net_time_machine)).toBeNull();
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
