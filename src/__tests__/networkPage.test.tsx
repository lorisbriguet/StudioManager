import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, renderHook, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAppStore } from "../stores/app-store";
import type { Machine, MachineFile } from "../types/upkeep";
import type { DueRow } from "../lib/upkeep/overview";
import type { CheckResult } from "../lib/network/commands";

let machines: Machine[] = [];
let links: MachineFile[] = [];
let due: DueRow[] = [];
const networkCheck = vi.fn(async (_t: { key: string }[]): Promise<CheckResult[]> => []);
const notifySpy = vi.fn();
const openRemoteLink = vi.fn(async (_id: number) => {});

const q = <T,>(data: T) => ({ data, isPending: false, isError: false, isFetching: false, refetch: vi.fn() });
vi.mock("../db/hooks/useUpkeep", () => ({
  useMachines: () => q(machines),
  useMachineLinks: () => q(links),
  useUpkeepOverview: () => ({ due, lowStock: [], endingSoon: [], replacements: [], overdueCount: 0 }),
  useMarkUpkeepDone: () => ({ mutate: vi.fn() }),
  useSnoozeUpkeep: () => ({ mutate: vi.fn() }),
}));
vi.mock("../db/hooks/useConnections", () => ({ useEquipmentConnections: () => q([]) }));
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
const dueRow = (id: number, machine: Machine, title: string) =>
  ({ item: { id, title, machine_id: machine.id }, machine, due: "2026-10-01", state: "overdue" }) as unknown as DueRow;

const renderPage = () => render(<MemoryRouter><NetworkPage /></MemoryRouter>);

beforeEach(() => {
  useAppStore.setState({ language: "EN", testMode: false, presentationMode: false });
  machines = [m(1, "Server A"), m(2, "Server B")];
  links = [l(1, 1, "Files", "https://files.example.test"), l(2, 1, "Wiki", "https://wiki.example.test"), l(3, 2, "Feeds", "https://feeds.example.test")];
  due = [];
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

  it("Upkeep due lists only the due items of machines on the page", () => {
    const other = m(9, "Elsewhere");
    due = [dueRow(1, machines[0], "Swap the drive"), dueRow(2, other, "Dust the fan")];
    renderPage();
    expect(screen.getByText("Swap the drive")).toBeTruthy();
    expect(screen.queryByText("Dust the fan")).toBeNull();
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
