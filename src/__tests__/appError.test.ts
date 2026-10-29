import { describe, it, expect, vi, beforeEach } from "vitest";
// eslint-disable-next-line no-restricted-imports -- spying on what notify sends to sonner
import { toast } from "sonner";
import { notify, resetNotifyDedupe } from "../lib/notify";
import { AppError } from "../lib/errors";
import { logError } from "../lib/log";
import { queryClient } from "../lib/queryClient";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";
import { setSelectHandler } from "../__mocks__/tauri-sql";
import { deleteExpenseCategory } from "../db/queries/expenses";
import { deleteInvoiceTemplate } from "../db/queries/invoiceTemplates";

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

beforeEach(() => {
  vi.clearAllMocks();
  resetNotifyDedupe();
  useAppStore.setState({ language: "EN" });
  setSelectHandler(null);
});

describe("AppError: a failure with a reason the user should read", () => {
  it("notify.error shows the error's own label, in the app language, and logs the raw error", () => {
    useAppStore.setState({ language: "FR" });
    notify.error(uiLabels.FR.operation_failed, new AppError("toast_category_in_use", "in use"));
    expect(toast.error).toHaveBeenCalledWith(uiLabels.FR.toast_category_in_use, expect.anything());
    expect(logError).toHaveBeenCalledWith(uiLabels.FR.toast_category_in_use, expect.stringContaining("in use"));
  });

  it("a plain error still shows the generic label", () => {
    notify.error(uiLabels.EN.operation_failed, new Error("boom"));
    expect(toast.error).toHaveBeenCalledWith(uiLabels.EN.operation_failed, expect.anything());
  });

  it("notify.error passes a description through", () => {
    notify.error(uiLabels.EN.toast_restore_failed, new Error("x"), { description: uiLabels.EN.restore_no_changes });
    expect(toast.error).toHaveBeenCalledWith(
      uiLabels.EN.toast_restore_failed,
      expect.objectContaining({ description: uiLabels.EN.restore_no_changes })
    );
  });

  it("the mutation cache backstop shows the AppError label instead of the mutation's errorLabel", async () => {
    const m = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => {
        throw new AppError("error_revert_to_draft");
      },
      meta: { errorLabel: "error_save_invoice" },
    });
    await m.execute(undefined).catch(() => {});
    expect(toast.error).toHaveBeenCalledWith(uiLabels.EN.error_revert_to_draft, expect.anything());
  });

  it("deleting a default or used category, or the default template, throws an AppError", async () => {
    await expect(deleteExpenseCategory("AM")).rejects.toMatchObject({ labelKey: "toast_category_default" });
    setSelectHandler((sql) => (sql.includes("COUNT(*)") ? [{ cnt: 2 }] : sql.includes("is_default") ? [{ is_default: 1 }] : []));
    await expect(deleteExpenseCategory("ZZ_CUSTOM")).rejects.toMatchObject({ labelKey: "toast_category_in_use" });
    await expect(deleteInvoiceTemplate(1)).rejects.toMatchObject({ labelKey: "error_template_default" });
  });
});
