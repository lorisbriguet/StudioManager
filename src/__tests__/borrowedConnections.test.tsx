import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { uiLabels } from "../i18n/ui";
import type { Connection, Machine } from "../types/upkeep";

let borrowing = false;
let own: Connection[] = [];
let lender: Connection[] = [];
const idle = { mutate: vi.fn(), isPending: false };
vi.mock("../db/hooks/useBorrowedEquipment", () => ({ useBorrowedEquipment: () => borrowing }));
vi.mock("../db/hooks/useConnections", () => ({
  useConnections: () => ({ data: own }),
  useEquipmentConnections: () => ({ data: lender }),
  useCurrentReading: () => ({ data: null }),
  useMachineDisks: () => ({ data: [] }),
  useLinkMachine: () => idle,
  useRecordManualReading: () => idle,
  useSyncNow: () => idle,
  useDeleteConnection: () => idle,
}));
vi.mock("../lib/upkeep/connections", () => ({
  testConnection: vi.fn(),
  connectionErrorText: (e: unknown) => String(e),
  connectionStatusText: (c: Connection) => `status of ${c.label}`,
}));

import { ReadingsSection } from "../components/upkeep/ReadingsSection";
import { ConnectionsCard } from "../components/upkeep/ConnectionsCard";

const t = uiLabels.EN;

function conn(over: Partial<Connection>): Connection {
  return {
    id: 2, kind: "bambu_cloud", label: "Bambu", host: null, port: null, region: "global",
    account: "me@example.com", cert_fingerprint: null, last_sync_at: "2026-10-28T08:00:00.000Z", last_ok_at: null,
    last_error: null, failing_since: null, failing_notified: 0, created_at: "", updated_at: "", ...over,
  };
}

const machine = {
  id: 1, name: "P2S", kind: "generic", status: "working", template_key: null, connection_id: 2, device_id: "x",
  reading_baseline: null, linked_at: null,
} as unknown as Machine;

beforeEach(() => {
  borrowing = false;
  own = [conn({ id: 9, label: "Mine" })];
  lender = [conn({ id: 2, label: "Lender NAS" })];
});

describe("a borrowing organisation", () => {
  it("shows the lender's connection and last sync on the machine, without Sync now or Unlink", () => {
    borrowing = true;
    render(<ReadingsSection machine={machine} items={[]} />);
    expect(screen.getByText("Connected to Lender NAS")).toBeInTheDocument();
    expect(screen.getByText("status of Lender NAS")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.upkeep_sync_now })).toBeNull();
    expect(screen.queryByRole("button", { name: t.upkeep_unlink })).toBeNull();
  });

  it("keeps Sync now and Unlink for an organisation with its own machines", () => {
    render(<ReadingsSection machine={machine} items={[]} />);
    expect(screen.getByRole("button", { name: t.upkeep_sync_now })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.upkeep_unlink })).toBeInTheDocument();
  });

  it("lists the lender's connections in settings without Sync now, Reconnect, Remove or Add", () => {
    borrowing = true;
    render(<ConnectionsCard />);
    expect(screen.getByText(`Lender NAS · ${t.upkeep_connection_kind_bambu_cloud}`)).toBeInTheDocument();
    expect(screen.queryByText(/Mine/)).toBeNull();
    for (const name of [t.upkeep_sync_now, t.upkeep_connection_test, t.upkeep_connection_reconnect, t.remove, t.upkeep_connection_add]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });
});
