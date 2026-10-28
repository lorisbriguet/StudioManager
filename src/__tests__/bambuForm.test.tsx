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
const getConnection = vi.fn();
vi.mock("../db/queries/connections", () => ({
  getConnection: (id: number) => getConnection(id),
}));
vi.mock("../lib/upkeep/connections", () => ({
  testConnection: (c: unknown) => testConnection(c),
  saveConnectionSecret: (id: number, s: string) => saveConnectionSecret(id, s),
}));
vi.mock("../hooks/useUnsavedChangesWarning", () => ({ useUnsavedChangesWarning: () => {} }));

import { BambuForm } from "../components/upkeep/BambuForm";
import { CONNECTION_FORMS } from "../components/upkeep/connectionForms";

const t = uiLabels.EN;

function fill(password = "pw") {
  fireEvent.change(screen.getByLabelText(/^Bambu account email/), { target: { value: " me@example.com " } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: t.upkeep_bambu_sign_in }));
}

beforeEach(() => {
  vi.resetAllMocks();
  create.mockResolvedValue(9);
  update.mockResolvedValue(undefined);
  saveConnectionSecret.mockResolvedValue(undefined);
  getConnection.mockImplementation((id: number) => Promise.resolve({ id, kind: "bambu_cloud" }));
});

describe("BambuForm", () => {
  it("is the form of the bambu_cloud kind", () => {
    expect(CONNECTION_FORMS.bambu_cloud).toBe(BambuForm);
  });

  it("says the API is unofficial and requires the email and password", () => {
    render(<BambuForm onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(t.upkeep_bambu_note)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_bambu_sign_in }));
    expect(screen.getByText(t.upkeep_bambu_required)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the connection with the region and email, the password only in the one-time secret", async () => {
    testConnection.mockResolvedValue([{ device_id: "01P", name: "P2S", model: "P2S" }]);
    const onDone = vi.fn();
    render(<BambuForm onDone={onDone} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Region/), { target: { value: "china" } });
    fill();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const { data, secret } = create.mock.calls[0][0];
    expect(data).toMatchObject({ kind: "bambu_cloud", region: "china", account: "me@example.com" });
    expect(JSON.stringify(data)).not.toContain("pw");
    expect(JSON.parse(secret)).toEqual({ password: "pw" });
  });

  it("asks for the emailed code and signs in with it alone", async () => {
    testConnection.mockRejectedValueOnce("code_required").mockResolvedValueOnce([]);
    const onDone = vi.fn();
    render(<BambuForm onDone={onDone} onCancel={vi.fn()} />);
    fill();
    expect(await screen.findByText(t.upkeep_bambu_code_desc)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Code from the email/), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_bambu_sign_in }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(saveConnectionSecret).toHaveBeenCalledWith(9, JSON.stringify({ code: "123456" }));
  });

  it("says when the code was wrong and lets the user type another", async () => {
    testConnection.mockRejectedValueOnce("code_required").mockRejectedValueOnce("code_invalid");
    render(<BambuForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fill();
    fireEvent.change(await screen.findByLabelText(/^Code from the email/), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_bambu_sign_in }));
    expect(await screen.findByText(t.upkeep_bambu_code_invalid)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Code from the email/)).toHaveValue("");
  });

  it("a retry sends the password again (it is never kept after a sign-in)", async () => {
    testConnection.mockRejectedValueOnce("password_invalid").mockResolvedValueOnce([]);
    const onDone = vi.fn();
    render(<BambuForm onDone={onDone} onCancel={vi.fn()} />);
    fill("wrong");
    expect(await screen.findByText(t.upkeep_bambu_password_invalid)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "right" } });
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_bambu_sign_in }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.parse(update.mock.calls[0][0].secret)).toEqual({ password: "right" });
  });

  it("says plainly that authenticator-app accounts aren't supported", async () => {
    testConnection.mockRejectedValueOnce("tfa_unsupported");
    render(<BambuForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fill();
    expect(await screen.findByText(t.upkeep_err_bambu_tfa)).toBeInTheDocument();
  });

  it("wipes the one-time password when no sign-in ran (the app refused the call)", async () => {
    testConnection.mockRejectedValueOnce("organisation changed: call was for 6kun0b, active is other1");
    render(<BambuForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fill();
    await waitFor(() => expect(saveConnectionSecret).toHaveBeenCalledWith(9, "{}"));
  });

  it("wipes the one-time password when the saved connection is gone before the test", async () => {
    getConnection.mockResolvedValue(undefined);
    render(<BambuForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fill();
    await waitFor(() => expect(saveConnectionSecret).toHaveBeenCalledWith(9, "{}"));
    expect(testConnection).not.toHaveBeenCalled();
  });

  it("leaves the secret to Rust once a sign-in ran", async () => {
    testConnection.mockRejectedValueOnce("password_invalid");
    render(<BambuForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fill();
    await screen.findByText(t.upkeep_bambu_password_invalid);
    expect(saveConnectionSecret).not.toHaveBeenCalled();
  });

  it("removes the half-made connection when closed before it works", async () => {
    testConnection.mockRejectedValue("code_required");
    const { unmount } = render(<BambuForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fill();
    await screen.findByText(t.upkeep_bambu_code_desc);
    unmount();
    expect(remove).toHaveBeenCalledWith(9);
  });

  describe("Reconnect (existing connection)", () => {
    const existing = {
      id: 4, kind: "bambu_cloud" as const, label: "Bambu", host: null, port: null, region: "global",
      account: "me@example.com", cert_fingerprint: null, last_sync_at: null, last_ok_at: null,
      last_error: "token_expired", failing_since: null, failing_notified: 0,
      created_at: "2026-09-01 08:00:00", updated_at: "",
    };

    it("signs in again on the same connection and never removes it", async () => {
      testConnection.mockResolvedValueOnce([]);
      const onDone = vi.fn();
      const { unmount } = render(<BambuForm connection={existing} onDone={onDone} onCancel={vi.fn()} />);
      expect(screen.getByDisplayValue("me@example.com")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "pw2" } });
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_bambu_sign_in }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(create).not.toHaveBeenCalled();
      expect(update.mock.calls[0][0]).toMatchObject({ id: 4 });
      expect(JSON.parse(update.mock.calls[0][0].secret)).toEqual({ password: "pw2" });
      unmount();
      expect(remove).not.toHaveBeenCalled();
    });

    it("a changed account email needs the password", () => {
      render(<BambuForm connection={existing} onDone={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByLabelText(/^Bambu account email/), { target: { value: "other@example.com" } });
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_bambu_sign_in }));
      expect(screen.getByText(t.upkeep_bambu_required)).toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
    });

    it("an expired sign-in without a password asks for it", async () => {
      testConnection.mockRejectedValueOnce("token_expired");
      render(<BambuForm connection={existing} onDone={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: t.upkeep_bambu_sign_in }));
      expect(await screen.findByText(t.upkeep_bambu_signin_again)).toBeInTheDocument();
      expect(update.mock.calls[0][0].secret).toBeUndefined();
    });
  });
});
