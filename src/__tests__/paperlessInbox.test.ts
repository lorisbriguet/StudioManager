import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const getConnections = vi.fn();
vi.mock("../db/queries/connections", () => ({ getConnections: () => getConnections() }));
const getPaperlessLinks = vi.fn();
vi.mock("../db/queries/paperlessLinks", () => ({ getPaperlessLinks: (...a: unknown[]) => getPaperlessLinks(...a) }));

import { matchSupplier } from "../lib/paperless/inbox";
import { usePaperlessInbox } from "../db/hooks/usePaperlessInbox";

const conn = { id: 3, kind: "paperless", host: "nas.local", port: 8000, label: "P" };
const docs = [
  { id: 1, title: "A", correspondent: "Sunrise", created: "2026-10-01", original_file_name: null, amount: null },
  { id: 2, title: "B", correspondent: null, created: "2026-09-01", original_file_name: null, amount: null },
  { id: 3, title: "C", correspondent: "Swisscom", created: "2026-08-01", original_file_name: null, amount: 123.45 },
];

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  invoke.mockReset();
  getConnections.mockReset().mockResolvedValue([conn]);
  getPaperlessLinks.mockReset().mockResolvedValue(new Map());
});

describe("matchSupplier", () => {
  it('maps "sunrise " to "Sunrise"', () => {
    expect(matchSupplier("sunrise ", ["Swisscom", "Sunrise"])).toBe("Sunrise");
  });
  it("returns the raw name for an unknown supplier", () => {
    expect(matchSupplier(" Acme  ", ["Sunrise"])).toBe("Acme");
    expect(matchSupplier("  ", [])).toBeNull();
    expect(matchSupplier(null, [])).toBeNull();
  });
});

describe("usePaperlessInbox", () => {
  it("excludes linked docs and flags dismissed ones", async () => {
    invoke.mockResolvedValue(docs);
    getPaperlessLinks.mockResolvedValue(new Map([
      [1, { state: "linked", expense_id: 9 }],
      [2, { state: "dismissed", expense_id: null }],
    ]));
    const { result } = renderHook(() => usePaperlessInbox(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.map((i) => [i.docId, i.state])).toEqual([[2, "dismissed"], [3, "new"]]);
    expect(result.current.items[1]).toMatchObject({ connectionId: 3, supplier: "Swisscom", date: "2026-08-01", amount: 123.45 });
    expect(result.current.items[0].amount).toBeNull();
    expect(result.current.connection).toEqual({ id: 3, host: "nas.local", port: 8000 });
    expect(invoke).toHaveBeenCalledWith("paperless_inbox", expect.objectContaining({
      id: 3, config: expect.objectContaining({ host: "nas.local", port: 8000 }),
    }));
  });

  it("keeps last items when the command fails with a transport error", async () => {
    invoke.mockResolvedValueOnce(docs);
    const { result } = renderHook(() => usePaperlessInbox(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    invoke.mockRejectedValue("Paperless unreachable: timed out");
    result.current.refresh();
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.error).toBeNull();
  });

  it("sets the error and empties items when the token is refused", async () => {
    invoke.mockRejectedValue("Paperless refused the token (401). Reconnect it in Settings.");
    const { result } = renderHook(() => usePaperlessInbox(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.error).toContain("refused the token"));
    expect(result.current.offline).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it("does nothing without a Paperless connection", async () => {
    getConnections.mockResolvedValue([]);
    const { result } = renderHook(() => usePaperlessInbox(), { wrapper: wrapper() });
    await waitFor(() => expect(getConnections).toHaveBeenCalled());
    expect(result.current).toMatchObject({ items: [], offline: false, error: null, connection: null });
    expect(invoke).not.toHaveBeenCalled();
  });
});
