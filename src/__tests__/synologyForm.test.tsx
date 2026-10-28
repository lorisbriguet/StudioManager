import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { uiLabels } from "../i18n/ui";

const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const testConnection = vi.fn();
const saveConnectionSecret = vi.fn();
vi.mock("../db/hooks/useConnections", () => ({
  useCreateConnection: () => ({ mutateAsync: create }),
  useUpdateConnection: () => ({ mutateAsync: update }),
  useDeleteConnection: () => ({ mutate: remove }),
}));
vi.mock("../db/queries/connections", () => ({
  getConnection: (id: number) => Promise.resolve({ id, kind: "synology" }),
}));
vi.mock("../lib/upkeep/connections", () => ({
  testConnection: (c: unknown) => testConnection(c),
  saveConnectionSecret: (id: number, s: string) => saveConnectionSecret(id, s),
}));
vi.mock("../hooks/useUnsavedChangesWarning", () => ({ useUnsavedChangesWarning: () => {} }));

import { SynologyForm } from "../components/upkeep/SynologyForm";

const t = uiLabels.EN;
const FP = "ab".repeat(32);

function fill() {
  fireEvent.change(screen.getByLabelText(/^NAS address/), { target: { value: "https://nas.local:5001/" } });
  fireEvent.change(screen.getByLabelText(/^DSM account/), { target: { value: "studio" } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
}

beforeEach(() => {
  vi.resetAllMocks();
  create.mockResolvedValue(7);
  update.mockResolvedValue(undefined);
  saveConnectionSecret.mockResolvedValue(undefined);
});

describe("SynologyForm", () => {
  it("says a dedicated admin account is needed and requires the fields", () => {
    render(<SynologyForm onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(t.upkeep_syno_account_note)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
    expect(screen.getByText(t.upkeep_syno_required)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the connection with the password in the secret, never in the row", async () => {
    testConnection.mockResolvedValue([{ device_id: "SN", name: null, model: null }]);
    const onDone = vi.fn();
    render(<SynologyForm onDone={onDone} onCancel={vi.fn()} />);
    fill();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const { data, secret } = create.mock.calls[0][0];
    expect(data).toMatchObject({ kind: "synology", host: "nas.local", port: 5001, account: "studio" });
    expect(JSON.stringify(data)).not.toContain("pw");
    expect(JSON.parse(secret)).toEqual({ password: "pw" });
  });

  it("shows an untrusted certificate and pins it on confirm", async () => {
    testConnection.mockRejectedValueOnce(`untrusted_cert:${FP}`).mockResolvedValueOnce([]);
    const onDone = vi.fn();
    render(<SynologyForm onDone={onDone} onCancel={vi.fn()} />);
    fill();
    expect(await screen.findByText(/^AB:AB:AB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_cert_trust }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith({ id: 7, data: { cert_fingerprint: FP } });
  });

  it("asks for the 2-step code and retries with it", async () => {
    testConnection.mockRejectedValueOnce("otp_required").mockResolvedValueOnce([]);
    const onDone = vi.fn();
    render(<SynologyForm onDone={onDone} onCancel={vi.fn()} />);
    fill();
    const code = await screen.findByLabelText(/^2-step verification code/);
    fireEvent.change(code, { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(saveConnectionSecret).toHaveBeenCalledWith(7, JSON.stringify({ password: "pw", otp_code: "123456" }));
  });

  it("a retry keeps the stored secret (and its device token) when the password didn't change", async () => {
    testConnection.mockRejectedValueOnce("the NAS answered HTTP 502").mockResolvedValueOnce([]);
    const onDone = vi.fn();
    render(<SynologyForm onDone={onDone} onCancel={vi.fn()} />);
    fill();
    expect(await screen.findByText("the NAS answered HTTP 502")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].secret).toBeUndefined();
  });

  it("the certificate step says to use the name the certificate was issued for", async () => {
    testConnection.mockRejectedValueOnce(`untrusted_cert:${FP}`);
    render(<SynologyForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fill();
    expect(await screen.findByText(t.upkeep_syno_cert_host_hint)).toBeInTheDocument();
  });

  describe("Reconnect (existing connection)", () => {
    const existing = {
      id: 4, kind: "synology" as const, label: "Office NAS", host: "nas.local", port: 5001, region: null,
      account: "studio", cert_fingerprint: "cd".repeat(32), last_sync_at: null, last_ok_at: null,
      last_error: "otp_required", failing_since: null, failing_notified: 0, created_at: "", updated_at: "",
    };

    it("re-pins a changed certificate on the same connection, keeping the stored password", async () => {
      testConnection.mockRejectedValueOnce(`untrusted_cert:${FP}`).mockResolvedValueOnce([]);
      const onDone = vi.fn();
      const { unmount } = render(<SynologyForm connection={existing} onDone={onDone} onCancel={vi.fn()} />);
      expect(screen.getByDisplayValue("nas.local")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
      fireEvent.click(await screen.findByRole("button", { name: t.upkeep_syno_cert_trust }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(create).not.toHaveBeenCalled();
      expect(update.mock.calls[0][0]).toMatchObject({ id: 4, secret: undefined });
      expect(update).toHaveBeenCalledWith({ id: 4, data: { cert_fingerprint: FP } });
      unmount();
      expect(remove).not.toHaveBeenCalled();
    });

    it("asks for the code, and the password when none was typed", async () => {
      testConnection.mockRejectedValueOnce("otp_required").mockResolvedValueOnce([]);
      const onDone = vi.fn();
      render(<SynologyForm connection={existing} onDone={onDone} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
      fireEvent.change(await screen.findByLabelText(/^2-step verification code/), { target: { value: "222333" } });
      fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "pw2" } });
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(saveConnectionSecret).toHaveBeenCalledWith(4, JSON.stringify({ password: "pw2", otp_code: "222333" }));
    });

    it("closing it never removes the connection", () => {
      const { unmount } = render(<SynologyForm connection={existing} onDone={vi.fn()} onCancel={vi.fn()} />);
      unmount();
      expect(remove).not.toHaveBeenCalled();
    });
  });

  it("removes the half-made connection when closed before it works", async () => {
    testConnection.mockRejectedValue("DSM refused the account name or password");
    const { unmount } = render(<SynologyForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fill();
    expect(await screen.findByText("DSM refused the account name or password")).toBeInTheDocument();
    unmount();
    expect(remove).toHaveBeenCalledWith(7);
  });
});
