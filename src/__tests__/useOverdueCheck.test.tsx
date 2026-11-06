import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  markOverdueInvoices: vi.fn(),
  createNotification: vi.fn(),
  warning: vi.fn(),
  sendNativeNotification: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../db/queries/invoices", () => ({ markOverdueInvoices: h.markOverdueInvoices }));
vi.mock("../db/queries/notifications", () => ({ createNotification: h.createNotification }));
vi.mock("../lib/nativeNotification", () => ({ sendNativeNotification: h.sendNativeNotification }));
vi.mock("../lib/log", () => ({ logError: h.logError, logWarn: vi.fn(), logInfo: vi.fn(), logDebug: vi.fn() }));
vi.mock("../lib/notify", async (orig) => {
  const real = await orig<typeof import("../lib/notify")>();
  return { ...real, notify: { ...real.notify, warning: h.warning } };
});

import { useOverdueCheck } from "../hooks/useOverdueCheck";
import { useOrgStore } from "../stores/org-store";

function render() {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { ...renderHook(() => useOverdueCheck(), { wrapper }), invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.createNotification.mockResolvedValue(1);
  useOrgStore.setState({ activeId: "org-a" });
});

describe("useOverdueCheck", () => {
  it("warns once, stores a notification and refreshes the lists when invoices turn overdue", async () => {
    h.markOverdueInvoices.mockResolvedValue([{ reference: "2026-001" }, { reference: "2026-004" }]);

    const { invalidate, rerender } = render();
    await waitFor(() => expect(h.sendNativeNotification).toHaveBeenCalled());
    rerender();

    expect(h.markOverdueInvoices).toHaveBeenCalledTimes(1);
    expect(h.warning).toHaveBeenCalledTimes(1);
    expect(h.warning.mock.calls[0][1]).toEqual({ description: "2026-001, 2026-004" });
    expect(h.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "overdue", message: "2026-001, 2026-004", read: 0, link: "/invoices" })
    );
    expect(h.sendNativeNotification).toHaveBeenCalledWith(h.warning.mock.calls[0][0], "2026-001, 2026-004");
    expect(invalidate).toHaveBeenCalled();
  });

  it("stays quiet when nothing is overdue", async () => {
    h.markOverdueInvoices.mockResolvedValue([]);

    const { invalidate } = render();
    await waitFor(() => expect(h.markOverdueInvoices).toHaveBeenCalled());
    await Promise.resolve();

    expect(h.warning).not.toHaveBeenCalled();
    expect(h.createNotification).not.toHaveBeenCalled();
    expect(h.sendNativeNotification).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("writes nothing when the organisation changed while the check ran", async () => {
    let resolve!: (v: unknown[]) => void;
    h.markOverdueInvoices.mockReturnValue(new Promise((r) => (resolve = r)));

    render();
    useOrgStore.setState({ activeId: "org-b" });
    resolve([{ reference: "2026-001" }]);
    await new Promise((r) => setTimeout(r, 0));

    expect(h.warning).not.toHaveBeenCalled();
    expect(h.createNotification).not.toHaveBeenCalled();
    expect(h.sendNativeNotification).not.toHaveBeenCalled();
  });

  it("logs a failed check instead of throwing", async () => {
    h.markOverdueInvoices.mockRejectedValue(new Error("db locked"));

    render();
    await waitFor(() => expect(h.logError).toHaveBeenCalledWith("Overdue check failed:", expect.any(Error)));
    expect(h.warning).not.toHaveBeenCalled();
  });
});
