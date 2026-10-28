import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { uiLabels } from "../i18n/ui";

const syncNow = vi.fn();
const remove = vi.fn();
let connections: unknown[] = [];
vi.mock("../db/hooks/useConnections", () => ({
  useConnections: () => ({ data: connections }),
  useSyncNow: () => ({ mutate: syncNow, isPending: false }),
  useDeleteConnection: () => ({ mutate: remove, isPending: false }),
  useCreateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/useUnsavedChangesWarning", () => ({ useUnsavedChangesWarning: () => {} }));

import { ConnectionsCard } from "../components/upkeep/ConnectionsCard";

const t = uiLabels.EN;

beforeEach(() => {
  vi.clearAllMocks();
  connections = [];
});

describe("ConnectionsCard", () => {
  it("says there are none and offers to add one", () => {
    render(<ConnectionsCard />);
    expect(screen.getByText(t.upkeep_connections_empty)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_connection_add }));
    // Each kind has its setup form.
    expect(screen.getByText(t.upkeep_syno_account_note)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t.upkeep_connection_kind), { target: { value: "bambu_cloud" } });
    expect(screen.getByText(t.upkeep_bambu_note)).toBeInTheDocument();
  });

  it("lists a connection with its last sync, error and Sync now", () => {
    connections = [{
      id: 4, kind: "bambu_cloud", label: "Bambu", last_sync_at: "2026-10-28T08:00:00.000Z",
      last_error: "unsupported connection kind: bambu_cloud", failing_since: "2026-10-28",
    }];
    render(<ConnectionsCard />);
    expect(screen.getByText(`Bambu · ${t.upkeep_connection_kind_bambu_cloud}`)).toBeInTheDocument();
    expect(screen.getByText(/unsupported connection kind/)).toBeInTheDocument();
    expect(screen.getByText(t.upkeep_connection_failing)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_sync_now }));
    expect(syncNow).toHaveBeenCalledWith(4);
  });

  it("shows a readable error and offers Reconnect on the same connection", () => {
    connections = [{
      id: 5, kind: "synology", label: "Office NAS", host: "nas.local", port: 5001, account: "studio",
      last_sync_at: "2026-10-28T08:00:00.000Z", last_error: "otp_required", failing_since: "2026-10-28",
    }];
    render(<ConnectionsCard />);
    expect(screen.getByText(new RegExp(t.upkeep_err_otp.slice(0, 20)))).toBeInTheDocument();
    expect(screen.queryByText(/otp_required/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_connection_reconnect }));
    expect(screen.getByDisplayValue("nas.local")).toBeInTheDocument();
  });
});
