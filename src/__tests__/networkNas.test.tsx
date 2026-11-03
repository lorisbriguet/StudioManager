import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAppStore } from "../stores/app-store";
import type { Connection, Machine, MachineDisk } from "../types/upkeep";
import type { NetworkCard } from "../lib/network/model";

let metrics: { metric: string; value: number; read_at: string }[] = [];
let disks: MachineDisk[] = [];
const q = <T,>(data: T) => ({ data, isPending: false, isError: false });
vi.mock("../db/hooks/useConnections", () => ({
  useLatestMetrics: (_id: number, prefix: string) => q(metrics.filter((r) => r.metric.startsWith(prefix))),
  useMachineDisks: () => q(disks),
}));

import { formatBytesShort } from "../lib/network/format";
import { volumesFrom, latestSnapshot } from "../lib/network/nas";
import { MachineCard } from "../components/network/MachineCard";

const row = (metric: string, value: number) => ({ metric, value, read_at: "2026-11-02T10:00:00Z" });
const disk = (slot: string, health: MachineDisk["health"]) => ({ slot, health }) as MachineDisk;
const NOW = Date.parse("2026-11-02T12:00:00Z");

const card = (): NetworkCard => ({
  machine: { id: 1, name: "Server A", kind: "server" } as Machine,
  services: [],
  remote: [],
  nas: { id: 9, last_sync_at: "2026-11-02T09:00:00Z", last_ok_at: "2026-11-02T09:00:00Z", failing_since: null } as Connection,
});
const renderCard = () =>
  render(<MemoryRouter><MachineCard card={card()} results={new Map()} now={NOW} /></MemoryRouter>);

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
  metrics = [row("volume_total_bytes:volume_1", 7e12), row("volume_used_bytes:volume_1", 4.8e12)];
  disks = [disk("Drive 1", "healthy"), disk("Drive 2", "healthy")];
});
afterEach(cleanup);

describe("formatBytesShort", () => {
  it("uses decimal units with at most one decimal", () => {
    expect(formatBytesShort(4.8e12)).toBe("4.8 TB");
    expect(formatBytesShort(7e12)).toBe("7 TB");
    expect(formatBytesShort(5.12e11)).toBe("512 GB");
    expect(formatBytesShort(999_960_000_000)).toBe("1 TB");
    expect(formatBytesShort(0)).toBe("0 B");
  });
});

describe("volumesFrom / latestSnapshot", () => {
  it("pairs used and total per volume", () => {
    const v = volumesFrom([
      row("volume_used_bytes:volume_2", 1), row("volume_total_bytes:volume_2", 10),
      row("volume_total_bytes:volume_1", 7e12), row("volume_used_bytes:volume_1", 4.8e12),
      row("volume_total_bytes:volume_3", 5),
    ]);
    expect(v).toEqual([
      { id: "volume_1", used: 4.8e12, total: 7e12 },
      { id: "volume_2", used: 1, total: 10 },
    ]);
  });

  it("picks the newest share", () => {
    const s = latestSnapshot([row("snapshot_latest_at:photos", 100), row("snapshot_latest_at:projects", 300)]);
    expect(s).toEqual({ at: 300, byShare: [{ share: "photos", at: 100 }, { share: "projects", at: 300 }] });
    expect(latestSnapshot([])).toBeNull();
  });
});

describe("NasHealth in MachineCard", () => {
  it("shows the volume line and when the NAS was last read", () => {
    renderCard();
    expect(screen.getByText("Volume 1 · 4.8 of 7 TB")).toBeInTheDocument();
    expect(screen.getByText("Updated 3 h ago")).toBeInTheDocument();
    expect(screen.getByRole("progressbar").firstElementChild!.className).not.toMatch(/warning|danger/);
  });

  it("dates the update from the last successful sync and flags a failing one", () => {
    const failing = { ...card(), nas: { ...card().nas!, last_sync_at: "2026-11-02T11:55:00Z", last_ok_at: "2026-10-30T09:00:00Z", failing_since: "2026-10-30T10:00:00Z" } as Connection };
    render(<MemoryRouter><MachineCard card={failing} results={new Map()} now={NOW} /></MemoryRouter>);
    expect(screen.getByText("Updated 3 d ago")).toBeInTheDocument();
    expect(screen.getByText("Sync failing")).toBeInTheDocument();
  });

  it("shows no update time when no sync ever succeeded", () => {
    const never = { ...card(), nas: { ...card().nas!, last_ok_at: null, failing_since: "2026-11-02T10:00:00Z" } as Connection };
    render(<MemoryRouter><MachineCard card={never} results={new Map()} now={NOW} /></MemoryRouter>);
    expect(screen.queryByText(/Updated/)).toBeNull();
    expect(screen.getByText("Sync failing")).toBeInTheDocument();
  });

  it("warns above 75%", () => {
    metrics = [row("volume_total_bytes:volume_1", 7e12), row("volume_used_bytes:volume_1", 6e12)];
    renderCard();
    expect(screen.getByRole("progressbar").firstElementChild!.className).toMatch(/warning/);
  });

  it("summarises the drives, or names the one that is not healthy", () => {
    renderCard();
    expect(screen.getByText("2 drives healthy")).toBeInTheDocument();
    cleanup();
    disks = [disk("Drive 1", "healthy"), disk("Drive 2", "warning")];
    renderCard();
    expect(screen.getByText(/Drive 2/)).toBeInTheDocument();
    expect(screen.queryByText(/drives healthy/)).toBeNull();
  });

  it("shows nothing for a machine without a NAS", () => {
    const c = { ...card(), nas: null };
    render(<MemoryRouter><MachineCard card={c} results={new Map()} now={NOW} /></MemoryRouter>);
    expect(screen.queryByText(/Updated/)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
