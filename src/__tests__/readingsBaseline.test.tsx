import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { uiLabels } from "../i18n/ui";
import type { Connection, Machine } from "../types/upkeep";

const testConnection = vi.fn();
const linkMutate = vi.fn();
let connections: Connection[] = [];
const idle = { mutate: vi.fn(), isPending: false };
vi.mock("../db/hooks/useConnections", () => ({
  useConnections: () => ({ data: connections }),
  useCurrentReading: () => ({ data: null }),
  useMachineDisks: () => ({ data: [] }),
  useLinkMachine: () => ({ mutate: linkMutate, isPending: false }),
  useRecordManualReading: () => idle,
  useSyncNow: () => idle,
}));
vi.mock("../lib/upkeep/connections", () => ({
  testConnection: (c: unknown) => testConnection(c),
  connectionErrorText: (e: unknown) => String(e),
  connectionStatusText: () => "",
}));

import { ReadingsSection } from "../components/upkeep/ReadingsSection";

const t = uiLabels.EN;

function conn(over: Partial<Connection>): Connection {
  return {
    id: 2, kind: "bambu_cloud", label: "Bambu", host: null, port: null, region: "global",
    account: "me@example.com", cert_fingerprint: null, last_sync_at: null, last_ok_at: null,
    last_error: null, failing_since: null, failing_notified: 0, created_at: "", updated_at: "", ...over,
  };
}

const machine: Machine = {
  id: 1, name: "P2S", kind: "generic", maker: null, model: null, serial: null,
  location: null, status: "working", lent_to: null, lent_until: null,
  purchase_date: null, supplier: null, price: null, currency: null, expense_id: null,
  warranty_until: null, warranty_notified_for: null, lifespan_years: null, photo_path: null,
  notes: null, template_key: null, connection_id: null, device_id: null,
  reading_baseline: null, linked_at: null, created_at: "", updated_at: "",
};

async function findDevices(connId: number) {
  fireEvent.change(screen.getByLabelText(t.upkeep_link_connection), { target: { value: String(connId) } });
  fireEvent.click(screen.getByRole("button", { name: t.upkeep_find_devices }));
  await screen.findByLabelText(t.upkeep_device);
}

beforeEach(() => {
  vi.resetAllMocks();
  testConnection.mockResolvedValue([{ device_id: "01P", name: "Studio P2S", model: "P2S" }]);
});

describe("linking a machine to a device", () => {
  it("a Bambu printer asks for its hour counter today, with a one-line explanation", async () => {
    connections = [conn({})];
    render(<ReadingsSection machine={machine} items={[]} />);
    await findDevices(2);
    expect(screen.getByText(t.upkeep_reading_baseline_desc)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t.upkeep_reading_baseline), { target: { value: "412.5" } });
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_link }));
    expect(linkMutate).toHaveBeenCalledWith({
      id: 1, connection_id: 2, device_id: "01P", reading_baseline: 412.5, linked_at: expect.any(String),
    });
    // Linked now, as an ISO UTC time: prints count from here.
    const at = Date.parse(linkMutate.mock.calls[0][0].linked_at);
    expect(Math.abs(Date.now() - at)).toBeLessThan(60_000);
    expect(linkMutate.mock.calls[0][0].linked_at).toMatch(/Z$/);
  });

  it("unlinking clears the link time", () => {
    connections = [conn({})];
    render(<ReadingsSection
      machine={{ ...machine, connection_id: 2, device_id: "01P", reading_baseline: 400, linked_at: "2026-09-04T00:00:00Z" }}
      items={[]} />);
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_unlink }));
    expect(linkMutate).toHaveBeenCalledWith({
      id: 1, connection_id: null, device_id: null, reading_baseline: 400, linked_at: null,
    });
  });

  it("a NAS without usage items doesn't ask for one", async () => {
    connections = [conn({ id: 3, kind: "synology", label: "NAS", region: null })];
    render(<ReadingsSection machine={machine} items={[]} />);
    await findDevices(3);
    expect(screen.queryByLabelText(t.upkeep_reading_baseline)).toBeNull();
  });
});
