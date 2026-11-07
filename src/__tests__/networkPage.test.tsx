import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor, renderHook, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAppStore } from "../stores/app-store";
import type { Machine, MachineFile, UpkeepItem } from "../types/upkeep";
import { buildUpkeepOverview, type UpkeepOverview } from "../lib/upkeep/overview";
import type { CheckResult } from "../lib/network/commands";

let machines: Machine[] = [];
let links: MachineFile[] = [];
const emptyOverview = (): UpkeepOverview => ({ due: [], lowStock: [], endingSoon: [], replacements: [], overdueCount: 0 });
let overview: UpkeepOverview = emptyOverview();
let tm: { enabled: boolean; lastBackupAt: string | null; lastResult: number | null; running: boolean } | null = null;
const networkCheck = vi.fn(async (_t: { key: string }[]): Promise<CheckResult[]> => []);
const notifySpy = vi.fn();
const openRemoteLink = vi.fn(async (_id: number) => {});

const q = <T,>(data: T) => ({ data, isPending: false, isError: false, isFetching: false, refetch: vi.fn() });
vi.mock("../db/hooks/useUpkeep", () => ({
  useMachines: () => q(machines),
  useMachineLinks: () => q(links),
  useUpkeepOverview: () => overview,
  useActiveUpkeepItems: () => q([]),
  useMarkUpkeepDone: () => ({ mutate: vi.fn() }),
  useSnoozeUpkeep: () => ({ mutate: vi.fn() }),
}));
vi.mock("../db/hooks/useConnections", () => ({ useEquipmentConnections: () => q([]), useLatestMetricsFor: () => [] }));
vi.mock("../hooks/useTimeMachine", () => ({ useTimeMachine: () => q(tm) }));
vi.mock("../hooks/useTailscale", () => ({ useTailscale: () => q(null) }));
vi.mock("../lib/network/commands", () => ({
  networkCheck: (t: { key: string }[]) => networkCheck(t),
  openRemoteLink: (id: number) => openRemoteLink(id),
}));
vi.mock("../lib/upkeep/openAttachment", () => ({ openMachineAttachment: vi.fn() }));
vi.mock("../lib/notify", async (orig) => ({
  ...(await orig<typeof import("../lib/notify")>()),
  notify: new Proxy({}, { get: () => notifySpy }),
}));

import { NetworkPage } from "../pages/NetworkPage";
import { useNetworkChecks } from "../hooks/useNetworkChecks";

const m = (id: number, name: string) => ({ id, name, kind: "server", status: "working", connection_id: null }) as Machine;
const l = (id: number, machine_id: number, label: string, url: string) =>
  ({ id, machine_id, label, kind: "link", path_or_url: url }) as MachineFile;
const item = (id: number, machine_id: number, title: string, next_due_on: string) =>
  ({ id, machine_id, title, schedule: "interval", interval_n: 1, interval_unit: "month", next_due_on, snooze_until: null, archived: 0 }) as UpkeepItem;
/** The overview the Upkeep page and its sidebar badge read, built by the real code. */
const overviewOf = (items: UpkeepItem[]) =>
  buildUpkeepOverview({
    items,
    machines,
    consumables: [],
    subscriptions: [],
    todayISO: "2026-11-07",
    soonDays: 7,
    warrantyWindowDays: 30,
    renewalWindowDays: 14,
  });

const renderPage = () => render(<MemoryRouter><NetworkPage /></MemoryRouter>);

beforeEach(() => {
  useAppStore.setState({ language: "EN", testMode: false, presentationMode: false });
  machines = [m(1, "Server A"), m(2, "Server B")];
  links = [l(1, 1, "Files", "https://files.example.test"), l(2, 1, "Wiki", "https://wiki.example.test"), l(3, 2, "Feeds", "https://feeds.example.test")];
  overview = emptyOverview();
  tm = null;
  networkCheck.mockReset();
  networkCheck.mockImplementation(async () => []);
  notifySpy.mockReset();
  openRemoteLink.mockReset();
  openRemoteLink.mockImplementation(async () => {});
});
afterEach(cleanup);

describe("NetworkPage", () => {
  it("shows one card per machine with its services", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Server A" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Server B" })).toBeTruthy();
    for (const label of ["Files", "Wiki", "Feeds"]) expect(screen.getByText(label)).toBeTruthy();
  });

  it("shows Unreachable and Error 502 from check results", async () => {
    networkCheck.mockImplementation(async () => [
      { key: "link:1", state: "unreachable", reason: null },
      { key: "link:2", state: "error", reason: "http_502" },
      { key: "link:3", state: "up", reason: null },
    ]);
    renderPage();
    expect(await screen.findByText("Unreachable")).toBeTruthy();
    expect(screen.getByText("Error 502")).toBeTruthy();
  });

  it("shows the empty state when no card", () => {
    links = [];
    renderPage();
    expect(screen.getByText(/Nothing to show yet/)).toBeTruthy();
    expect(screen.queryByText("Upkeep due")).toBeNull();
  });

  it("shows the Backups card, not the empty state, when only Time Machine is on", () => {
    links = [];
    tm = { enabled: true, lastBackupAt: new Date().toISOString(), lastResult: 0, running: false };
    renderPage();
    expect(screen.queryByText(/Nothing to show yet/)).toBeNull();
    expect(screen.getByText("Time Machine")).toBeTruthy();
  });

  it("renders without dots in presentation mode", async () => {
    useAppStore.setState({ presentationMode: true });
    const { container } = renderPage();
    await new Promise((r) => setTimeout(r, 20));
    expect(networkCheck).not.toHaveBeenCalled();
    expect(container.querySelector(".dot-sm.bg-success")).toBeNull();
  });

  it("does not notify when everything is unreachable", async () => {
    networkCheck.mockImplementation(async (ts) => ts.map((t) => ({ key: t.key, state: "unreachable" as const, reason: null })));
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Unreachable").length).toBe(3));
    expect(notifySpy).not.toHaveBeenCalled();
  });

  // R4U: the card used to keep only machines with a Network card, so an overdue item on a
  // machine without links showed "Nothing due" while the Upkeep badge said 1.
  describe("Upkeep due agrees with the Upkeep badge", () => {
    const printer = m(3, "Printer");
    const rowsIn = () => {
      const card = screen.getByText("Upkeep due").closest("section") as HTMLElement;
      return { card, overdue: within(card).queryAllByText("Overdue").length, soon: within(card).queryAllByText("Due soon").length };
    };
    beforeEach(() => {
      machines = [...machines, printer];
    });

    it("overdue: lists the item, even on a machine without a Network card", () => {
      overview = overviewOf([item(1, printer.id, "Lubricate rods", "2026-11-02")]);
      renderPage();
      const { card, overdue, soon } = rowsIn();
      expect(overview.overdueCount).toBe(1);
      expect(overdue).toBe(overview.overdueCount);
      expect(soon).toBe(0);
      expect(within(card).getByText("Lubricate rods")).toBeTruthy();
    });

    it("due soon: lists the item, the badge stays at 0", () => {
      overview = overviewOf([item(1, 1, "Swap the drive", "2026-11-10")]);
      renderPage();
      const { card, overdue, soon } = rowsIn();
      expect(overview.overdueCount).toBe(0);
      expect(overdue).toBe(0);
      expect(soon).toBe(1);
      expect(within(card).getByText("Swap the drive")).toBeTruthy();
    });

    it("none: says Nothing due when nothing is overdue or due soon", () => {
      overview = overviewOf([item(1, printer.id, "Dust the fan", "2026-12-31")]);
      renderPage();
      const { card, overdue, soon } = rowsIn();
      expect(overview.overdueCount).toBe(0);
      expect(overdue + soon).toBe(0);
      expect(within(card).getByText("Nothing due")).toBeTruthy();
      expect(within(card).queryByText("Dust the fan")).toBeNull();
    });
  });
});

describe("Remote block", () => {
  beforeEach(() => {
    links = [
      l(10, 1, "Screen Sharing", "vnc://mini.local"),
      l(11, 1, "Jump Desktop", "jump://mini.local"),
      l(12, 2, "Screen Sharing", "jump://other.local"),
    ];
  });

  it("shows Online and one button per remote link", async () => {
    networkCheck.mockImplementation(async () => [{ key: "machine:1", state: "up", reason: null }]);
    renderPage();
    expect(await screen.findByText("Online")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Screen Sharing|Jump Desktop/ })).toHaveLength(3);
    const keys = networkCheck.mock.calls[0][0].map((x) => x.key);
    expect(keys).toEqual(["machine:1"]);
  });

  it("shows Unreachable when the machine does not answer, and no state without a vnc link", async () => {
    networkCheck.mockImplementation(async () => [{ key: "machine:1", state: "unreachable", reason: null }]);
    renderPage();
    expect(await screen.findAllByText("Unreachable")).toHaveLength(1);
  });

  it("clicking a remote button calls openRemoteLink with the file id", async () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Jump Desktop" })[0]);
    await waitFor(() => expect(openRemoteLink).toHaveBeenCalledWith(11));
  });

  it("reports a failed open", async () => {
    openRemoteLink.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Jump Desktop" })[0]);
    await waitFor(() => expect(notifySpy).toHaveBeenCalled());
  });
});

describe("useNetworkChecks", () => {
  it("re-runs with the new targets when they change during an in-flight check", async () => {
    let release: () => void = () => {};
    networkCheck.mockImplementationOnce(() => new Promise((res) => { release = () => res([]); }));
    const t = (key: string) => ({ key, kind: "http" as const, url: "https://example.test" });
    const { rerender } = renderHook(({ targets }) => useNetworkChecks(targets), { initialProps: { targets: [t("link:1")] } });
    await waitFor(() => expect(networkCheck).toHaveBeenCalledTimes(1));
    rerender({ targets: [t("link:1"), t("link:2")] });
    expect(networkCheck).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(networkCheck).toHaveBeenCalledTimes(2));
    expect(networkCheck.mock.calls[1][0].map((x) => x.key)).toEqual(["link:1", "link:2"]);
  });
});
