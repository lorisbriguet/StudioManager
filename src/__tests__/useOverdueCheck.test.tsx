import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  describe("when the app stays open across days", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(new Date(2026, 10, 7, 22, 0, 0)); // 22:00 local
      h.markOverdueInvoices.mockResolvedValue([]);
    });
    afterEach(() => vi.useRealTimers());

    function setVisibility(state: DocumentVisibilityState) {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    }

    it("runs again just after local midnight, and not before", () => {
      const { unmount } = render();
      expect(h.markOverdueInvoices).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1.5 * 3600_000); // 23:30
      expect(h.markOverdueInvoices).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(3600_000); // 00:30 the next day
      expect(h.markOverdueInvoices).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(24 * 3600_000); // and the night after
      expect(h.markOverdueInvoices).toHaveBeenCalledTimes(3);
      unmount();
    });

    it("runs when the window shows again on a new day, not on the same day", () => {
      const { unmount } = render();
      setVisibility("visible");

      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      expect(h.markOverdueInvoices).toHaveBeenCalledTimes(1);

      // The Mac slept through midnight: the clock moved, the timer has not fired.
      vi.setSystemTime(new Date(2026, 10, 8, 9, 0, 0));
      document.dispatchEvent(new Event("visibilitychange"));
      expect(h.markOverdueInvoices).toHaveBeenCalledTimes(2);

      window.dispatchEvent(new Event("focus"));
      expect(h.markOverdueInvoices).toHaveBeenCalledTimes(2);
      unmount();
    });

    it("runs on focus on a new day", () => {
      const { unmount } = render();
      vi.setSystemTime(new Date(2026, 10, 8, 9, 0, 0));
      window.dispatchEvent(new Event("focus"));
      expect(h.markOverdueInvoices).toHaveBeenCalledTimes(2);
      unmount();
    });

    it("stops after unmount", () => {
      const { unmount } = render();
      unmount();
      vi.setSystemTime(new Date(2026, 10, 8, 9, 0, 0));
      window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(48 * 3600_000);
      expect(h.markOverdueInvoices).toHaveBeenCalledTimes(1);
    });
  });

  it("logs a failed check instead of throwing", async () => {
    h.markOverdueInvoices.mockRejectedValue(new Error("db locked"));

    render();
    await waitFor(() => expect(h.logError).toHaveBeenCalledWith("Overdue check failed:", expect.any(Error)));
    expect(h.warning).not.toHaveBeenCalled();
  });
});
