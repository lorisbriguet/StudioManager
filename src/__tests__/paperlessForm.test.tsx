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
vi.mock("../lib/notify", async (orig) => ({
  ...(await orig<typeof import("../lib/notify")>()),
  ...(await import("../__mocks__/notify")).notifyMockModule(),
}));

import { PaperlessForm } from "../components/upkeep/PaperlessForm";
import { CONNECTION_FORMS, CONNECTION_KINDS } from "../components/upkeep/connectionForms";
import { notify } from "../lib/notify";

const t = uiLabels.EN;

beforeEach(() => {
  vi.resetAllMocks();
  create.mockResolvedValue(9);
  update.mockResolvedValue(undefined);
  getConnection.mockImplementation((id: number) => Promise.resolve({ id, kind: "paperless" }));
});

describe("PaperlessForm", () => {
  it("is registered for the paperless kind", () => {
    expect(CONNECTION_FORMS.paperless).toBe(PaperlessForm);
    expect(CONNECTION_KINDS).toContain("paperless");
  });

  it("shows host, port and token and never renders the token back after save", async () => {
    testConnection.mockResolvedValue([]);
    const onDone = vi.fn();
    const { container } = render(<PaperlessForm onDone={onDone} onCancel={vi.fn()} />);
    const address = screen.getByLabelText(/^Paperless address/);
    expect(address).toHaveValue("");
    expect(address).toHaveAttribute("placeholder", "paperless.example.ts.net");
    fireEvent.change(address, { target: { value: "nas.example.ts.net" } });
    expect(screen.getByLabelText(/^HTTPS port/)).toHaveValue(8443);
    const token = screen.getByLabelText(/^API token/) as HTMLInputElement;
    expect(token.type).toBe("password");
    fireEvent.change(token, { target: { value: "s3cret-token" } });
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_paperless_connect }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(notify.success).toHaveBeenCalledWith(t.upkeep_connection_test_ok_paperless);
    const { data, secret } = create.mock.calls[0][0];
    expect(data).toMatchObject({ kind: "paperless", host: "nas.example.ts.net", port: 8443 });
    expect(JSON.stringify(data)).not.toContain("s3cret-token");
    expect(secret).toBe("s3cret-token");
    // The token only lives in the password input the user typed it into, never as text.
    expect(container.textContent).not.toContain("s3cret-token");
  });

  it("requires a token for a new connection", () => {
    render(<PaperlessForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_paperless_connect }));
    expect(screen.getByText(t.upkeep_paperless_required)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("shows the Rust error text", async () => {
    testConnection.mockRejectedValue("Paperless refused the token (401). Reconnect it in Settings.");
    render(<PaperlessForm onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Paperless address/), { target: { value: "nas.example.ts.net" } });
    fireEvent.change(screen.getByLabelText(/^API token/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_paperless_connect }));
    expect(await screen.findByText(/Paperless refused the token/)).toBeInTheDocument();
  });

  it("reconnect: a changed host with an empty token is refused without saving or testing", () => {
    const conn = { id: 4, kind: "paperless", label: "Mine", host: "h.example", port: 443 } as never;
    render(<PaperlessForm onDone={vi.fn()} onCancel={vi.fn()} connection={conn} />);
    fireEvent.change(screen.getByLabelText(/^Paperless address/), { target: { value: "other.example" } });
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_paperless_connect }));
    expect(screen.getByText(t.upkeep_paperless_reenter_token)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(testConnection).not.toHaveBeenCalled();
  });

  it("reconnect: prefilled, empty token keeps the stored one", async () => {
    testConnection.mockResolvedValue([]);
    const onDone = vi.fn();
    const conn = { id: 4, kind: "paperless", label: "Mine", host: "h.example", port: 443 } as never;
    render(<PaperlessForm onDone={onDone} onCancel={vi.fn()} connection={conn} />);
    expect(screen.getByLabelText(/^Paperless address/)).toHaveValue("h.example");
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_paperless_connect }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(update.mock.calls[0][0].secret).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});
