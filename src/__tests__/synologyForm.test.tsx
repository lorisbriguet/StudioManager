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
  testConnection: (c: unknown, opts?: unknown) => testConnection(c, opts),
  saveConnectionSecret: (id: number, s: string) => saveConnectionSecret(id, s),
}));
vi.mock("../hooks/useUnsavedChangesWarning", () => ({ useUnsavedChangesWarning: () => {} }));

import { SynologyForm } from "../components/upkeep/SynologyForm";

const t = uiLabels.EN;
const FP = "ab".repeat(32);
/** The secret the form stores: the password bound to the NAS it is for. */
const blob = (password: string, cert: string | null, otp?: string, host = "nas.local", port = 5001) =>
  JSON.stringify({ password, host, port, cert_fingerprint: cert, ...(otp ? { otp_code: otp } : {}) });

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
    expect(secret).toBe(blob("pw", null));
  });

  it("shows an untrusted certificate and pins it on confirm", async () => {
    testConnection.mockRejectedValueOnce(`untrusted_cert:${FP}`).mockResolvedValueOnce([]);
    const onDone = vi.fn();
    render(<SynologyForm onDone={onDone} onCancel={vi.fn()} />);
    fill();
    expect(await screen.findByText(/^AB:AB:AB/)).toBeInTheDocument();
    // Where to compare it, before trusting.
    expect(screen.getByText(t.upkeep_syno_cert_compare)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_cert_trust }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // The pin goes into the row and, with the password, into the secret.
    expect(update).toHaveBeenCalledWith({ id: 7, data: { cert_fingerprint: FP }, secret: blob("pw", FP) });
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
    expect(saveConnectionSecret).toHaveBeenCalledWith(7, blob("pw", null, "123456"));
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

    const OLD = "cd".repeat(32);

    it("shows the certificate again, and an unchanged one is confirmed without the password", async () => {
      testConnection.mockRejectedValueOnce(`untrusted_cert:${OLD}`).mockResolvedValueOnce([]);
      const onDone = vi.fn();
      const { unmount } = render(<SynologyForm connection={existing} onDone={onDone} onCancel={vi.fn()} />);
      expect(screen.getByDisplayValue("nas.local")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
      expect(await screen.findByText(t.upkeep_syno_cert_same)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_cert_trust }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      // First test sets the old pin aside; the second uses it.
      expect(testConnection.mock.calls.map((c) => c[1])).toEqual([{ recheckCert: true }, { recheckCert: false }]);
      expect(create).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0][0]).toMatchObject({ id: 4, secret: undefined });
      unmount();
      expect(remove).not.toHaveBeenCalled();
    });

    it("a changed certificate is flagged and needs the password to be trusted", async () => {
      testConnection.mockRejectedValueOnce(`untrusted_cert:${FP}`).mockResolvedValueOnce([]);
      const onDone = vi.fn();
      render(<SynologyForm connection={existing} onDone={onDone} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
      expect(await screen.findByText(t.upkeep_syno_cert_changed)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_cert_trust }));
      expect(screen.getByText(t.upkeep_syno_reenter_password)).toBeInTheDocument();
      expect(update).toHaveBeenCalledTimes(1);
      fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "pw2" } });
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_cert_trust }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(update).toHaveBeenLastCalledWith({ id: 4, data: { cert_fingerprint: FP }, secret: blob("pw2", FP) });
    });

    it("a new address needs the password again", () => {
      render(<SynologyForm connection={existing} onDone={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByLabelText(/^NAS address/), { target: { value: "other.local" } });
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
      expect(screen.getByText(t.upkeep_syno_reenter_password)).toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
    });

    it("asks for the password again when Rust refuses to send the stored one", async () => {
      testConnection.mockRejectedValueOnce("reenter_password").mockResolvedValueOnce([]);
      const onDone = vi.fn();
      render(<SynologyForm connection={existing} onDone={onDone} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
      expect(await screen.findByText(t.upkeep_syno_reenter_password)).toBeInTheDocument();
      // An empty password no longer means "keep the stored one".
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
      expect(update).toHaveBeenCalledTimes(1);
      fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "pw2" } });
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(update.mock.calls[1][0].secret).toBe(blob("pw2", OLD));
    });

    it("opened on a 'type the password again' error, the password is required", () => {
      render(
        <SynologyForm connection={{ ...existing, last_error: "reenter_password" }} onDone={vi.fn()} onCancel={vi.fn()} />
      );
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_syno_connect }));
      expect(screen.getByText(t.upkeep_syno_reenter_password)).toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
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
      expect(saveConnectionSecret).toHaveBeenCalledWith(4, blob("pw2", OLD, "222333"));
    });

    it("closing it never removes the connection", () => {
      const { unmount } = render(<SynologyForm connection={existing} onDone={vi.fn()} onCancel={vi.fn()} />);
      unmount();
      expect(remove).not.toHaveBeenCalled();
    });
  });

  it("refuses a port outside 1 to 65535", () => {
    render(<SynologyForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^HTTPS port/), { target: { value: "70000" } });
    expect(screen.getByText(t.upkeep_syno_port_invalid)).toBeInTheDocument();
    fill();
    expect(create).not.toHaveBeenCalled();
  });

  it("closed while the first Connect is saving, it leaves no connection or secret behind", async () => {
    let resolve!: (id: number) => void;
    create.mockReturnValue(new Promise<number>((r) => { resolve = r; }));
    const { unmount } = render(<SynologyForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fill();
    await waitFor(() => expect(create).toHaveBeenCalled());
    unmount(); // Escape
    expect(remove).not.toHaveBeenCalled();
    resolve(7);
    await waitFor(() => expect(remove).toHaveBeenCalledWith(7));
    expect(testConnection).not.toHaveBeenCalled();
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
