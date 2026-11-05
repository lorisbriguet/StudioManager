import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { useAppStore } from "../stores/app-store";
import type { TailscaleDevice, TailscaleStatus } from "../lib/network/commands";

let status: TailscaleStatus | null = null;
let pending = false;
const openExternal = vi.fn(async (_url: string) => {});

vi.mock("../hooks/useTailscale", () => ({
  useTailscale: () => ({ data: pending ? undefined : status, isPending: pending, isError: false, isFetching: false, refetch: vi.fn() }),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: (url: string) => openExternal(url) }));

import { TailscaleCard } from "../components/network/TailscaleCard";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const dev = (over: Partial<TailscaleDevice>): TailscaleDevice => ({
  name: "device", dnsName: null, os: null, ip: null, online: true, lastSeen: null, isSelf: false, ...over,
});

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
  pending = false;
  status = {
    running: true,
    tailnet: "studio.github",
    devices: [
      dev({ name: "Studio MacBook", ip: "100.1.1.1", isSelf: true }),
      dev({ name: "nas", ip: "100.1.1.3" }),
      dev({ name: "iphone-15", online: false, lastSeen: "2026-11-05T09:00:00Z" }),
      dev({ name: "ipad", online: false }),
    ],
  };
  openExternal.mockReset();
  openExternal.mockImplementation(async () => {});
});
afterEach(cleanup);

describe("TailscaleCard", () => {
  it("lists every device with its address, or when it was last seen", () => {
    render(<TailscaleCard now={NOW} />);
    const rows = screen.getAllByTestId("tailscale-device");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("Studio MacBook")).toBeTruthy();
    expect(within(rows[0]).getByText("This Mac")).toBeTruthy();
    expect(within(rows[0]).getByText("100.1.1.1")).toBeTruthy();
    expect(within(rows[2]).getByText("Seen 3 h ago")).toBeTruthy();
    expect(within(rows[3]).getAllByText("Offline").length).toBeGreaterThan(0);
  });

  it("opens the admin console", () => {
    render(<TailscaleCard now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Open the Tailscale console" }));
    expect(openExternal).toHaveBeenCalledWith("https://login.tailscale.com/admin/machines");
  });

  it("says so when Tailscale is off on this Mac, and keeps the console button", () => {
    status = { running: false, tailnet: null, devices: [dev({ name: "Studio MacBook", isSelf: true, online: false })] };
    render(<TailscaleCard now={NOW} />);
    expect(screen.getByText("Tailscale is off on this Mac")).toBeTruthy();
    expect(screen.queryAllByTestId("tailscale-device")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Open the Tailscale console" })).toBeTruthy();
  });

  it("is hidden when Tailscale isn't installed", () => {
    status = null;
    const { container } = render(<TailscaleCard now={NOW} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows a skeleton while reading", () => {
    pending = true;
    render(<TailscaleCard now={NOW} />);
    expect(screen.getByText("Tailscale")).toBeTruthy();
    expect(screen.queryAllByTestId("tailscale-device")).toHaveLength(0);
  });
});
