import { describe, it, expect, vi, beforeEach } from "vitest";
// notify is the one module that talks to sonner, so its own test spies on sonner.
// eslint-disable-next-line no-restricted-imports -- testing notify itself
import { toast } from "sonner";
import { notify, TOAST_DURATION, resetNotifyDedupe } from "../lib/notify";
import { logError } from "../lib/log";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => "tid"),
    dismiss: vi.fn(),
  });
  return { toast };
});
vi.mock("../lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(), logDebug: vi.fn() }));

const t = uiLabels.EN;
type Opts = { duration?: number; id?: string; action?: { label: string; onClick: () => unknown } };
const lastOpts = (fn: unknown) => {
  const calls = vi.mocked(fn as (...a: unknown[]) => unknown).mock.calls;
  return calls[calls.length - 1][1] as Opts;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetNotifyDedupe();
  useAppStore.setState({ language: "EN" });
});

describe("notify", () => {
  it("shows each kind with its duration", () => {
    notify.success("Invoice saved");
    notify.info("No recurring invoices due");
    notify.warning("2 receipts skipped");
    expect(toast.success).toHaveBeenCalledWith("Invoice saved", expect.objectContaining({ duration: TOAST_DURATION.success }));
    expect(toast.info).toHaveBeenCalledWith("No recurring invoices due", expect.objectContaining({ duration: 4000 }));
    expect(toast.warning).toHaveBeenCalledWith("2 receipts skipped", expect.objectContaining({ duration: 8000 }));
  });

  it("error shows the label, never the raw error, and logs the raw error", () => {
    notify.error(t.error_save_invoice, new Error("SQLITE_BUSY: database is locked"));
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message, opts] = vi.mocked(toast.error).mock.calls[0] as [string, Opts];
    expect(message).toBe("Couldn't save the invoice");
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls[0])).not.toContain("SQLITE_BUSY");
    expect(opts.duration).toBe(10_000);
    expect(logError).toHaveBeenCalledWith(t.error_save_invoice, expect.stringContaining("SQLITE_BUSY"));
  });

  it("the Details action copies the raw error", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    notify.error(t.error_save_invoice, new Error("boom"));
    const opts = lastOpts(toast.error);
    expect(opts.action?.label).toBe(t.copy_details);
    opts.action!.onClick();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  it("an error without a cause has no Details action", () => {
    notify.error(t.toast_category_in_use);
    expect(lastOpts(toast.error).action).toBeUndefined();
  });

  it("an identical error (same label, same cause) shows once while its toast is up, but is always logged", () => {
    notify.error(t.calendar_sync_failed, new Error("calendar not found"));
    notify.error(t.calendar_sync_failed, new Error("calendar not found"));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(2);
  });

  // Review A5: hooks rely on the MutationCache backstop, which reports every
  // failed save with the same generic label. Two different failures must both
  // show, or the second row reverts without a word.
  it("two different errors with the same label both show", () => {
    notify.error(t.operation_failed, new Error("UNIQUE constraint failed: clients.name"));
    notify.error(t.operation_failed, new Error("database is locked"));
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it("the same error shows again once its toast is gone", () => {
    vi.useFakeTimers();
    try {
      notify.error(t.operation_failed, new Error("database is locked"));
      vi.advanceTimersByTime(TOAST_DURATION.error + 1);
      notify.error(t.operation_failed, new Error("database is locked"));
      expect(toast.error).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("undo shows the message 8 s with Undo; clicking runs onUndo then says so", async () => {
    const onUndo = vi.fn();
    notify.undo("Expense deleted", onUndo);
    expect(toast).toHaveBeenCalledWith("Expense deleted", expect.objectContaining({ duration: 8000 }));
    const opts = lastOpts(toast);
    expect(opts.action?.label).toBe(t.undo);
    await opts.action!.onClick();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(t.action_undone, expect.anything());
  });

  it("a failed undo is reported", async () => {
    notify.undo("Expense deleted", () => {
      throw new Error("nope");
    });
    await lastOpts(toast).action!.onClick();
    expect(toast.error).toHaveBeenCalledWith(t.failed_to_undo, expect.anything());
  });

  describe("progress", () => {
    it("shows the label, then the success message in the same toast", async () => {
      const update = vi.fn();
      const result = await notify.progress(
        "Generating PDF…",
        async (u) => {
          u("Exporting 2 of 2…");
          update();
          return 2;
        },
        { success: (n) => `${n} exported`, error: t.failed_to_generate_pdf }
      );
      expect(result).toBe(2);
      expect(toast.loading).toHaveBeenCalledWith("Generating PDF…");
      expect(toast.loading).toHaveBeenCalledWith("Exporting 2 of 2…", { id: "tid" });
      expect(toast.success).toHaveBeenCalledWith("2 exported", expect.objectContaining({ id: "tid" }));
    });

    it("null closes the toast; { warning } shows a warning", async () => {
      await notify.progress("…", Promise.resolve(1), { success: null, error: "x" });
      expect(toast.dismiss).toHaveBeenCalledWith("tid");
      await notify.progress("…", Promise.resolve(1), { success: { warning: "1 of 2" }, error: "x" });
      expect(toast.warning).toHaveBeenCalledWith("1 of 2", expect.objectContaining({ id: "tid" }));
    });

    it("a failure shows the error label (not the raw text), logs it and resolves undefined", async () => {
      const result = await notify.progress("…", Promise.reject(new Error("disk full")), {
        success: "done",
        error: t.failed_to_generate_pdf,
      });
      expect(result).toBeUndefined();
      const [message, opts] = vi.mocked(toast.error).mock.calls[0] as [string, Opts];
      expect(message).toBe(t.failed_to_generate_pdf);
      expect(opts.id).toBe("tid");
      expect(opts.action?.label).toBe(t.copy_details);
      expect(logError).toHaveBeenCalledWith(t.failed_to_generate_pdf, expect.stringContaining("disk full"));
    });
  });
});
