import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useAppStore } from "../stores/app-store";
import { getDb } from "../db";
import { setSelectHandler, executedStatements, clearExecutedStatements } from "../__mocks__/tauri-sql";
import { setInvokeHandler, invokedCommands, clearInvokedCommands, copiedFiles, removedPaths, clearFsWrites } from "../__mocks__/tauri-api";
import { uiLabels } from "../i18n/ui";
import type { InboxItem } from "../lib/paperless/inbox";

const t = uiLabels.EN;

vi.mock("../lib/pdfExtract", () => ({ extractPdfText: vi.fn(), extractImageText: vi.fn() }));
vi.mock("../lib/log", () => ({ logError: vi.fn(async () => {}), logWarn: vi.fn(async () => {}), logInfo: vi.fn(async () => {}) }));

// The inbox as Paperless + the links table would report it: a mutable list the
// mocked link queries edit, read through a real query so invalidation refetches.
const fake = vi.hoisted(() => ({
  items: [] as InboxItem[],
  offline: false,
  error: null as string | null,
  connected: true,
  refresh: () => {},
}));

vi.mock("../db/hooks/usePaperlessInbox", () => ({
  paperlessInboxKey: (id: number | null) => ["paperless-inbox", id],
  usePaperlessInbox: () => {
    const q = useQuery({
      queryKey: ["paperless-inbox", 3],
      queryFn: async () => fake.items.map((i) => ({ ...i })),
    });
    return {
      items: q.data ?? [],
      offline: fake.offline,
      error: fake.error,
      refresh: fake.refresh,
      connection: fake.connected ? { id: 3, host: "nas.local", port: 8443 } : null,
    };
  },
}));

const setState = (docId: number, state: InboxItem["state"] | "linked") => {
  fake.items = state === "linked"
    ? fake.items.filter((i) => i.docId !== docId)
    : fake.items.map((i) => (i.docId === docId ? { ...i, state } : i));
};
const linkPaperlessDoc = vi.fn(async (_c: number, docId: number, _e: number) => setState(docId, "linked"));
const dismissPaperlessDoc = vi.fn(async (_c: number, docId: number) => setState(docId, "dismissed"));
const undismissPaperlessDoc = vi.fn(async (_c: number, docId: number) => setState(docId, "new"));
vi.mock("../db/queries/paperlessLinks", () => ({
  linkPaperlessDoc: (c: number, d: number, e: number) => linkPaperlessDoc(c, d, e),
  dismissPaperlessDoc: (c: number, d: number) => dismissPaperlessDoc(c, d),
  undismissPaperlessDoc: (c: number, d: number) => undismissPaperlessDoc(c, d),
}));

vi.mock("../db/queries/connections", () => ({
  getConnections: async () => [{ id: 3, kind: "paperless", host: "nas.local", port: 8443, label: "P" }],
}));

import { ExpensesPage } from "../pages/ExpensesPage";

const item = (docId: number, supplier: string | null, state: InboxItem["state"] = "new", amount: number | null = null): InboxItem => ({
  connectionId: 3,
  docId,
  title: `Doc ${docId}`,
  supplier,
  date: "2026-10-01",
  amount,
  state,
});

let download: (args: Record<string, unknown>) => unknown;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ExpensesPage />
    </QueryClientProvider>
  );
}

const openInbox = async (count?: number) =>
  fireEvent.click(await screen.findByRole("radio", { name: count ? `${t.paperless_to_file} ${count}` : t.paperless_to_file }));

beforeEach(async () => {
  await getDb();
  useAppStore.setState({ language: "EN" });
  fake.items = [item(11, "sunrise ")];
  fake.offline = false;
  fake.error = null;
  fake.connected = true;
  linkPaperlessDoc.mockClear();
  dismissPaperlessDoc.mockClear();
  undismissPaperlessDoc.mockClear();
  download = () => "/cache/paperless/11.pdf";
  setSelectHandler((sql) => {
    const flat = sql.replace(/\s+/g, " ");
    if (flat.includes("GROUP BY supplier")) return [{ supplier: "Sunrise", category_code: "TE", amount: 49.9 }];
    if (flat.includes("FROM expense_categories")) {
      return [
        { code: "FA", name_fr: "Frais administratifs", name_en: "Admin fees", pl_section: "operating", color: null },
        { code: "TE", name_fr: "Télécommunications", name_en: "Telecom", pl_section: "operating", color: null },
      ];
    }
    return [];
  });
  setInvokeHandler((cmd, args) => {
    if (cmd === "paperless_download") return download(args);
    return null;
  });
  clearExecutedStatements();
  clearInvokedCommands();
});

afterEach(() => {
  setSelectHandler(null);
  setInvokeHandler(null);
  cleanup();
});

const insert = () => executedStatements.find((s) => s.sql.includes("INSERT INTO expenses"));

const amountInput = (dialog: HTMLElement) => within(dialog).getByLabelText(new RegExp(`^${t.amount}`));

async function createAndSave() {
  await openInbox(1);
  fireEvent.click(await screen.findByRole("button", { name: t.paperless_create_expense }));
  const dialog = await screen.findByRole("dialog", { name: t.new_expense });
  // No Montant in Paperless: the amount starts empty and the user types it.
  fireEvent.change(amountInput(dialog), { target: { value: "80" } });
  fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
  await waitFor(() => expect(linkPaperlessDoc).toHaveBeenCalled());
}

describe("Paperless inbox on the Expenses page", () => {
  it("badge shows the count and hides at zero", async () => {
    fake.items = [item(11, "Sunrise"), item(12, "Swisscom"), item(13, "Old", "dismissed")];
    renderPage();
    expect(await screen.findByRole("radio", { name: `${t.paperless_to_file} 2` })).toBeInTheDocument();
    cleanup();

    fake.items = [item(13, "Old", "dismissed")];
    renderPage();
    await waitFor(() => expect(screen.getByRole("radio", { name: t.paperless_to_file })).toBeInTheDocument());
    cleanup();

    fake.connected = false;
    renderPage();
    await screen.findByRole("button", { name: t.new_expense });
    expect(screen.queryByRole("radio", { name: new RegExp(t.paperless_to_file) })).not.toBeInTheDocument();
  });

  it("create expense opens the form prefilled with supplier and date", async () => {
    renderPage();
    await openInbox(1);
    expect(screen.getByText("Doc 11")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.paperless_create_expense }));
    const dialog = await screen.findByRole("dialog", { name: t.new_expense });
    expect(within(dialog).getByLabelText(new RegExp(`^${t.supplier}`))).toHaveValue("Sunrise");
    expect(invokedCommands.find((c) => c.cmd === "paperless_download")?.args).toMatchObject({ id: 3, docId: 11 });
    fireEvent.change(amountInput(dialog), { target: { value: "80" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    await waitFor(() => expect(insert()).toBeDefined());
    expect(insert()!.params).toContain("2026-10-01");
    expect(insert()!.params).toContain("Sunrise");
  });

  it("without a Paperless amount the form's amount is empty, not the supplier's last amount", async () => {
    // Sunrise has past expenses (49.90 in the select handler).
    renderPage();
    await openInbox(1);
    fireEvent.click(screen.getByRole("button", { name: t.paperless_create_expense }));
    const dialog = await screen.findByRole("dialog", { name: t.new_expense });
    expect(within(dialog).getByLabelText(new RegExp(`^${t.supplier}`))).toHaveValue("Sunrise");
    expect(amountInput(dialog)).toHaveValue(null);
    // Saving without an amount is refused: nothing is booked.
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    await new Promise((r) => setTimeout(r, 50));
    expect(insert()).toBeUndefined();
  });

  it("the Paperless Montant prefills the amount", async () => {
    fake.items = [item(11, "Sunrise", "new", 123.45)];
    renderPage();
    await openInbox(1);
    fireEvent.click(screen.getByRole("button", { name: t.paperless_create_expense }));
    const dialog = await screen.findByRole("dialog", { name: t.new_expense });
    expect(amountInput(dialog)).toHaveValue(123.45);
    fireEvent.click(within(dialog).getByRole("button", { name: t.save }));
    await waitFor(() => expect(insert()).toBeDefined());
    expect(insert()!.params).toContain(123.45);
  });

  it("a dropped-receipt prefill still guesses the supplier's last amount", async () => {
    // Regression guard: only inbox prefills skip the history amount.
    const { NewExpenseForm } = await import("../pages/ExpensesPage");
    render(
      <QueryClientProvider client={new QueryClient()}>
      <NewExpenseForm
        categories={[{ code: "TE", name_fr: "Télécommunications" }]}
        pastSuppliers={[{ supplier: "Sunrise", category_code: "TE", amount: 49.9 }]}
        prefill={{ supplier: "Sunrise", receiptPath: "/Users/me/Downloads/x.pdf" }}
        onSave={() => {}}
        onCancel={() => {}}
      />
      </QueryClientProvider>
    );
    const dialog = await screen.findByRole("dialog", { name: t.new_expense });
    expect(amountInput(dialog)).toHaveValue(49.9);
  });

  it("the receipt is copied from the downloaded path, which is then deleted", async () => {
    clearFsWrites();
    download = () => "/Users/me/Library/Application Support/ch.studio/paperless-cache/11.pdf";
    renderPage();
    await createAndSave();
    const copy = copiedFiles.find((c) => c.from.endsWith("paperless-cache/11.pdf"));
    expect(copy).toBeDefined();
    expect(copy!.to).toMatch(/receipts\/.*_Sunrise\.pdf$/);
    await waitFor(() => expect(removedPaths).toContain("/Users/me/Library/Application Support/ch.studio/paperless-cache/11.pdf"));
  });

  it("saving links the doc and writes back title and tags", async () => {
    renderPage();
    await createAndSave();
    expect(linkPaperlessDoc).toHaveBeenCalledWith(3, 11, 1);
    const reference = insert()!.params[0] as string;
    await waitFor(() => expect(invokedCommands.find((c) => c.cmd === "paperless_mark_linked")).toBeDefined());
    expect(invokedCommands.find((c) => c.cmd === "paperless_mark_linked")!.args).toMatchObject({
      id: 3,
      docId: 11,
      title: `${reference} Sunrise`,
      tags: ["StudioManager", "2026", "Télécommunications"],
    });
    // The receipt from Paperless was copied into receipts/.
    expect(insert()!.params[7]).toMatch(/receipts\/.*_Sunrise\.pdf$/);
    await waitFor(() => expect(screen.queryByText("Doc 11")).not.toBeInTheDocument());
  });

  it("dismiss removes the item and it can be restored from the dismissed filter", async () => {
    renderPage();
    await openInbox(1);
    fireEvent.click(screen.getByRole("button", { name: t.paperless_dismiss }));
    await waitFor(() => expect(screen.queryByText("Doc 11")).not.toBeInTheDocument());
    expect(dismissPaperlessDoc).toHaveBeenCalledWith(3, 11);
    expect(insert()).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: t.paperless_dismissed }));
    fireEvent.click(await screen.findByRole("button", { name: t.paperless_restore }));
    await waitFor(() => expect(undismissPaperlessDoc).toHaveBeenCalledWith(3, 11));
    fireEvent.click(screen.getByRole("button", { name: t.paperless_dismissed }));
    expect(await screen.findByText("Doc 11")).toBeInTheDocument();
  });

  it("shows offline state without throwing", async () => {
    fake.offline = true;
    renderPage();
    await openInbox(1);
    expect(screen.getByText(t.paperless_offline)).toBeInTheDocument();
    expect(screen.getByText("Doc 11")).toBeInTheDocument();
  });

  it("download failure keeps the expense and offers retry", async () => {
    download = () => { throw new Error("Paperless unreachable: timeout"); };
    renderPage();
    await createAndSave();
    expect(insert()).toBeDefined();
    expect(insert()!.params[7]).toBeNull();
    expect(linkPaperlessDoc).toHaveBeenCalledWith(3, 11, 1);

    download = () => "/cache/paperless/11.pdf";
    fireEvent.click(await screen.findByRole("button", { name: t.paperless_receipt_missing_retry }));
    await waitFor(() => {
      const upd = executedStatements.find((s) => s.sql.includes("UPDATE expenses"));
      expect(upd).toBeDefined();
      expect(upd!.params.some((p) => typeof p === "string" && /receipts\/.*_Sunrise\.pdf$/.test(p))).toBe(true);
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: t.paperless_receipt_missing_retry })).not.toBeInTheDocument()
    );
  });
});
