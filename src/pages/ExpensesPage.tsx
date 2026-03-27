import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Plus, Paperclip, Eye, X, ChevronRight, Upload, Trash2, CheckCircle, Receipt } from "lucide-react";
import { Button, Input, Select, PageHeader, SearchBar, PageSpinner, EmptyState, Card } from "../components/ui";
import { SavedFilterBar } from "../components/SavedFilterBar";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatDisplayDate } from "../utils/formatDate";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { copyFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";
import { readFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  useExpenses,
  useExpenseCategories,
  useDistinctSuppliers,
  useCreateExpense,
  useUpdateExpense,
  useDeleteExpense,
  useDuplicateCheck,
} from "../db/hooks/useExpenses";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { BulkActionBar } from "../components/BulkActionBar";
import { useBulkSelect } from "../hooks/useBulkSelect";
import type { Expense } from "../types/expense";
import { getNextExpenseReference } from "../db/queries/expenses";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { useT } from "../i18n/useT";
import { extractPdfText, extractImageText, parseExpenseFromText, type ExtractedExpenseData } from "../lib/pdfExtract";
import { logError } from "../lib/log";
import { useYearGrouping } from "../hooks/useYearGrouping";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions } from "../types/saved-filter";

type SortKey = "reference" | "supplier" | "category_code" | "invoice_date" | "amount" | "paid_date";

export function ExpensesPage() {
  const t = useT();
  const { data: expenses, isLoading } = useExpenses();
  const { data: categories } = useExpenseCategories();
  const { data: pastSuppliers } = useDistinctSuppliers();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const [showForm, setShowForm] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<Expense> | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "invoice_date", dir: "desc" });
  const [preview, setPreview] = useState<{ path: string; reference: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [prefill, setPrefill] = useState<(ExtractedExpenseData & { receiptPath?: string }) | null>(null);
  const [parsing, setParsing] = useState(false);
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);

  const applyFilter = useCallback((filters: SavedFilterData) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    if (filters.sort && typeof filters.sort === "object") setSort(filters.sort as SortState<SortKey>);
    setFilterConditions(filters.conditions ?? []);
  }, []);

  const expenseFields = useMemo<FilterableField[]>(() => [
    { key: "reference", label: t.reference, type: "string" },
    { key: "supplier", label: t.supplier, type: "string" },
    { key: "category_code", label: t.category, type: "select", options: (categories ?? []).map((c) => ({ value: c.code, label: c.name_fr })) },
    { key: "amount", label: t.amount, type: "number" },
  ], [t, categories]);

  const categoryName = (code: string) =>
    categories?.find((c) => c.code === code)?.name_fr ?? code;

  const filtered = useMemo(() => {
    if (!expenses) return [];
    const q = search.toLowerCase();
    let rows = q
      ? expenses.filter(
          (e) =>
            e.reference.toLowerCase().includes(q) ||
            e.supplier.toLowerCase().includes(q) ||
            e.category_code.toLowerCase().includes(q)
        )
      : expenses;
    rows = applyFilterConditions(rows, filterConditions);
    return sortRows(rows, sort.key, sort.dir);
  }, [expenses, search, sort, filterConditions]);

  const { expandedYears, groupedByYear, toggleYear } = useYearGrouping(
    filtered,
    useCallback((exp: (typeof filtered)[0]) => exp.invoice_date, [])
  );

  const bulk = useBulkSelect(filtered);

  const bulkDelete = useCallback(async () => {
    if (!(await ask(t.confirm_bulk_delete, { kind: "warning" }))) return;
    const ids = [...bulk.selected] as number[];
    ids.forEach((id) => deleteExpense.mutate(id));
    bulk.clearSelection();
  }, [bulk, deleteExpense, t]);

  const handleDroppedFile = useCallback(async (filePath: string) => {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "png", "jpg", "jpeg", "heic"].includes(ext)) {
      toast.error(t.unsupported_file);
      return;
    }

    setParsing(true);
    try {
      let extracted: ExtractedExpenseData = {};

      if (ext === "pdf") {
        const text = await extractPdfText(filePath);
        if (text) {
          extracted = parseExpenseFromText(text);
        }
      } else if (["png", "jpg", "jpeg", "heic"].includes(ext)) {
        const text = await extractImageText(filePath);
        if (text) {
          extracted = parseExpenseFromText(text);
        }
      }

      // Match supplier to known suppliers for category autofill
      if (extracted.supplier && pastSuppliers) {
        const match = pastSuppliers.find(
          (s) => s.supplier.toLowerCase() === extracted.supplier!.toLowerCase()
        );
        if (match) {
          extracted.supplier = match.supplier;
        }
      }

      setPrefill({ ...extracted, receiptPath: filePath });
      setShowForm(true);
    } catch (e) {
      logError("PDF parsing failed:", e);
      setPrefill({ receiptPath: filePath });
      setShowForm(true);
    } finally {
      setParsing(false);
    }
  }, [pastSuppliers]);

  // Listen for Tauri drag-and-drop events
  useEffect(() => {
    const webview = getCurrentWebview();
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    webview.onDragDropEvent((event) => {
      if (cancelled) return;
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsDragging(true);
      } else if (event.payload.type === "drop") {
        setIsDragging(false);
        const paths = event.payload.paths;
        if (paths.length > 0) {
          handleDroppedFile(paths[0]);
        }
      } else if (event.payload.type === "leave") {
        setIsDragging(false);
      }
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unlisten = fn;
    }).catch(() => {
      // Silently handle if drag-drop listener setup fails (e.g. unsupported platform)
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleDroppedFile]);

  const attachReceipt = async (expenseId: number, reference: string, supplier: string) => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Files", extensions: ["pdf", "png", "jpg", "jpeg", "heic"] }],
      });
      if (!selected) return;
      const filePath = typeof selected === "string" ? selected : selected;
      const ext = filePath.split(".").pop() ?? "pdf";
      const dataDir = await appDataDir();
      const receiptsDir = `${dataDir}/receipts`;
      if (!(await exists(receiptsDir))) {
        await mkdir(receiptsDir, { recursive: true });
      }
      const safeRef = reference.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
      const safeSup = supplier.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
      const destPath = `${receiptsDir}/${safeRef}_${safeSup}.${ext}`;
      await copyFile(filePath, destPath);
      updateExpense.mutate(
        { id: expenseId, data: { receipt_path: destPath } },
        { onSuccess: () => toast.success(t.receipt_attached) }
      );
    } catch {
      toast.error("Failed to attach receipt");
    }
  };

  if (isLoading) return <PageSpinner />;

  return (
    <div className="relative">
      {isDragging && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-accent">
            <Upload size={32} />
            <span className="text-sm font-medium">{t.drop_pdf_hint}</span>
          </div>
        </div>
      )}

      {parsing && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-gray-100/60 dark:bg-gray-900/60 backdrop-blur-sm rounded-lg">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 border border-gray-200 shadow-sm">
            <div className="h-4 w-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted">{t.analyzing_receipt}</span>
          </div>
        </div>
      )}

      <PageHeader title={t.expenses}>
        <Button icon={<Plus size={16} />} onClick={() => { setPrefill(null); setShowForm(true); }}>{t.new_expense}</Button>
      </PageHeader>

      <SearchBar value={search} onChange={(v) => { setSearch(v); setActiveFilterId(null); setFilterConditions([]); }} placeholder={t.search_expenses} className="w-64 mb-4" />

      <SavedFilterBar
        page="expenses"
        currentFilters={{ search, sort, conditions: filterConditions }}
        onApply={applyFilter}
        activeFilterId={activeFilterId}
        onActiveChange={setActiveFilterId}
        fields={expenseFields}
      />

      {showForm && (
        <NewExpenseForm
          categories={categories ?? []}
          pastSuppliers={pastSuppliers ?? []}
          prefill={prefill}
          onSave={async (data) => {
            const reference = await getNextExpenseReference(new Date().getFullYear());

            let receiptPath = data.receipt_path;
            if (prefill?.receiptPath && !receiptPath) {
              try {
                const ext = prefill.receiptPath.split(".").pop() ?? "pdf";
                const dataDir = await appDataDir();
                const receiptsDir = `${dataDir}/receipts`;
                if (!(await exists(receiptsDir))) {
                  await mkdir(receiptsDir, { recursive: true });
                }
                const safeRef = reference.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
                const safeSup = (data.supplier || "").replace(/[/\\]/g, "_").replace(/\.\./g, "_");
                const destPath = `${receiptsDir}/${safeRef}_${safeSup}.${ext}`;
                await copyFile(prefill.receiptPath, destPath);
                receiptPath = destPath;
              } catch (e) {
                logError("Receipt copy failed:", e);
              }
            }

            createExpense.mutate(
              { ...data, reference, receipt_path: receiptPath },
              {
                onSuccess: () => {
                  toast.success("Expense created");
                  setShowForm(false);
                  setPrefill(null);
                },
              }
            );
          }}
          onCancel={() => { setShowForm(false); setPrefill(null); }}
        />
      )}

      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border-header)]">
              <th className="w-8 px-2 py-2">
                <input type="checkbox" checked={bulk.isAllSelected} onChange={bulk.toggleAll} className="accent-[var(--accent)]" />
              </th>
              <SortHeader label="Reference" sortKey="reference" current={sort} onSort={setSort} />
              <SortHeader label={t.supplier} sortKey="supplier" current={sort} onSort={setSort} />
              <SortHeader label={t.category} sortKey="category_code" current={sort} onSort={setSort} />
              <SortHeader label={t.date} sortKey="invoice_date" current={sort} onSort={setSort} />
              <SortHeader label={t.amount} sortKey="amount" current={sort} onSort={setSort} align="right" />
              <SortHeader label="Paid" sortKey="paid_date" current={sort} onSort={setSort} />
              <th className="px-4 py-2 font-medium text-muted text-left">{t.receipt}</th>
            </tr>
          </thead>
          <tbody>
            {groupedByYear.map(([year, yearExpenses]) => {
              const isOpen = expandedYears.has(year);
              const yearTotal = yearExpenses.reduce((s, e) => s + e.amount, 0);
              return (
                <React.Fragment key={year}>
                  <tr
                    className="border-b border-[var(--color-border-divider)] cursor-pointer hover:bg-[var(--color-hover-row)] rounded-md"
                    onClick={() => toggleYear(year)}
                  >
                    <td colSpan={8} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          size={14}
                          className={`text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                        <span className="text-[10px] font-medium uppercase tracking-widest text-muted">{year}</span>
                        <span className="text-xs text-muted">
                          {yearExpenses.length} expense{yearExpenses.length !== 1 ? "s" : ""}
                        </span>
                        <span className="ml-auto text-sm font-medium">
                          CHF {yearTotal.toFixed(2)}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {isOpen &&
                    yearExpenses.map((exp) => (
                      <tr
                        key={exp.id}
                        className="border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] rounded-md group"
                        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: exp }); }}
                      >
                        <td className="w-8 px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={bulk.selected.has(exp.id)}
                            onChange={(e) => bulk.toggleItem(exp.id, e.nativeEvent instanceof MouseEvent ? (e.nativeEvent as MouseEvent).shiftKey : false)}
                            className="accent-[var(--accent)]"
                          />
                        </td>
                        <td className="px-4 py-2 font-medium">{exp.reference}</td>
                        <td className="px-4 py-2">{exp.supplier}</td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100">
                            {exp.category_code}
                          </span>
                          <span className="ml-1 text-xs text-muted">{categoryName(exp.category_code)}</span>
                        </td>
                        <td className="px-4 py-2 text-muted">{formatDisplayDate(exp.invoice_date)}</td>
                        <td className="px-4 py-2 text-right font-medium">
                          CHF {exp.amount.toFixed(2)}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            <Input
                              type="date"
                              fullWidth={false}
                              value={exp.paid_date ?? ""}
                              onChange={(e) =>
                                updateExpense.mutate(
                                  {
                                    id: exp.id,
                                    data: { paid_date: e.target.value || null },
                                  },
                                  { onSuccess: () => toast.success(e.target.value ? "Paid date updated" : "Marked as unpaid") }
                                )
                              }
                              className={`px-1.5 py-0.5 text-xs rounded w-[110px] ${
                                exp.paid_date ? "text-green-700 dark:text-green-300" : "text-red-600 dark:text-red-300"
                              }`}
                            />
                            {!exp.paid_date && (
                              <button
                                onClick={() =>
                                  updateExpense.mutate(
                                    {
                                      id: exp.id,
                                      data: { paid_date: format(new Date(), "yyyy-MM-dd") },
                                    },
                                    { onSuccess: () => toast.success("Marked as paid") }
                                  )
                                }
                                className="px-1.5 py-0.5 text-[10px] rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 shrink-0"
                                title="Mark as paid today"
                              >
                                {t.today ?? "Today"}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          {exp.receipt_path ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setPreview({ path: exp.receipt_path!, reference: exp.reference })}
                                className="text-xs text-accent hover:underline flex items-center gap-1"
                                title="Preview receipt"
                              >
                                <Eye size={14} /> View
                              </button>
                              <span className="text-xs text-success flex items-center gap-1">
                                <Paperclip size={12} />
                              </span>
                            </div>
                          ) : (
                            <button
                              onClick={() => attachReceipt(exp.id, exp.reference, exp.supplier)}
                              className="text-xs text-accent hover:underline flex items-center gap-1"
                            >
                              <Paperclip size={12} /> Attach
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && !isLoading && (
          <EmptyState message={search ? (t.no_matching_expenses ?? "No matching expenses") : (t.no_expenses_yet ?? "No expenses yet")} icon={<Receipt size={32} />} />
        )}
      </div>

      {preview && (
        <ReceiptPreview
          path={preview.path}
          reference={preview.reference}
          onClose={() => setPreview(null)}
        />
      )}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            ...(!ctxMenu.item.paid_date ? [{ label: t.mark_paid, icon: <CheckCircle size={14} />, onClick: () => updateExpense.mutate({ id: ctxMenu.item.id, data: { paid_date: new Date().toISOString().split("T")[0] } }) }] : []),
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteExpense.mutate(ctxMenu.item.id) },
          ]}
        />
      )}
      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.delete, icon: <Trash2 size={14} />, onClick: bulkDelete, danger: true },
        ]}
      />
    </div>
  );
}

function ReceiptPreview({
  path,
  reference,
  onClose,
}: {
  path: string;
  reference: string;
  onClose: () => void;
}) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["png", "jpg", "jpeg", "webp"].includes(ext);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    readFile(path)
      .then((bytes) => {
        const mime = isImage
          ? `image/${ext === "jpg" ? "jpeg" : ext}`
          : "application/pdf";
        const blob = new Blob([bytes], { type: mime });
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch(() => setBlobUrl(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, ext, isImage]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-gray-100 rounded-lg shadow-xl w-[80vw] h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold">{reference}</h2>
          <button onClick={onClose} className="text-muted hover:text-gray-900 dark:hover:text-gray-200">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center">
          {!blobUrl ? (
            <span className="text-sm text-muted">Loading...</span>
          ) : isImage ? (
            <img
              src={blobUrl}
              alt={reference}
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <iframe
              src={blobUrl}
              title={reference}
              className="w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function NewExpenseForm({
  categories,
  pastSuppliers,
  prefill,
  onSave,
  onCancel,
}: {
  categories: { code: string; name_fr: string }[];
  pastSuppliers: { supplier: string; category_code: string; amount: number }[];
  prefill: (ExtractedExpenseData & { receiptPath?: string }) | null;
  onSave: (data: {
    supplier: string;
    category_code: string;
    invoice_date: string;
    due_date: string | null;
    amount: number;
    paid_date: string | null;
    receipt_path: string | null;
    notes: string;
  }) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState(() => {
    let categoryCode = categories[0]?.code ?? "FA";
    let amount = 0;
    if (prefill?.supplier && pastSuppliers.length > 0) {
      const match = pastSuppliers.find(
        (s) => s.supplier.toLowerCase() === prefill.supplier!.toLowerCase()
      );
      if (match) {
        categoryCode = match.category_code;
        amount = match.amount;
      }
    }

    return {
      supplier: prefill?.supplier ?? "",
      category_code: categoryCode,
      invoice_date: prefill?.invoice_date ?? format(new Date(), "yyyy-MM-dd"),
      amount: prefill?.amount ?? amount,
      notes: "",
    };
  });
  // Sync prefill into form when it changes (e.g. new file dropped while form is open)
  useEffect(() => {
    if (!prefill) return;
    let categoryCode = categories[0]?.code ?? "FA";
    let amount = 0;
    if (prefill.supplier && pastSuppliers.length > 0) {
      const match = pastSuppliers.find(
        (s) => s.supplier.toLowerCase() === prefill.supplier!.toLowerCase()
      );
      if (match) {
        categoryCode = match.category_code;
        amount = match.amount;
      }
    }
    setForm({
      supplier: prefill.supplier ?? "",
      category_code: categoryCode,
      invoice_date: prefill.invoice_date ?? format(new Date(), "yyyy-MM-dd"),
      amount: prefill.amount ?? amount,
      notes: "",
    });
  }, [prefill]);

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{ supplier: string; amount: number; date: string } | null>(null);
  const duplicateCheck = useDuplicateCheck();

  const checkForDuplicates = () => {
    if (form.supplier.trim() && form.amount > 0 && form.invoice_date) {
      duplicateCheck.mutate(
        { supplier: form.supplier, amount: form.amount, date: form.invoice_date },
        {
          onSuccess: (dupes) => {
            if (dupes.length > 0) {
              setDuplicateWarning({ supplier: dupes[0].supplier, amount: dupes[0].amount, date: dupes[0].invoice_date });
            } else {
              setDuplicateWarning(null);
            }
          },
        }
      );
    }
  };

  const suggestions = form.supplier.length > 0
    ? pastSuppliers.filter((s) =>
        s.supplier.toLowerCase().includes(form.supplier.toLowerCase())
      )
    : pastSuppliers;

  const selectSupplier = (s: { supplier: string; category_code: string; amount: number }) => {
    setForm({
      ...form,
      supplier: s.supplier,
      category_code: s.category_code,
      amount: s.amount,
    });
    setShowSuggestions(false);
    setDuplicateWarning(null);
  };

  return (
    <Card className="mb-6 space-y-3">
      {prefill?.receiptPath && (
        <div className="flex items-center gap-2 text-xs text-success">
          <Paperclip size={12} />
          <span>Receipt will be attached: {prefill.receiptPath.split("/").pop()}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="relative">
          <Input
            placeholder={`${t.supplier} *`}
            value={form.supplier}
            onChange={(e) => {
              setForm({ ...form, supplier: e.target.value });
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            className="py-2"
            autoComplete="off"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-gray-100 border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((s) => (
                <button
                  key={s.supplier}
                  type="button"
                  onMouseDown={() => selectSupplier(s)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-200 flex items-center justify-between"
                >
                  <span>{s.supplier}</span>
                  <span className="text-xs text-muted">
                    {s.category_code} / CHF {s.amount.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Select
          value={form.category_code}
          onChange={(e) => setForm({ ...form, category_code: e.target.value })}
          className="py-2"
        >
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} - {c.name_fr}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          fullWidth={false}
          value={form.invoice_date}
          onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
          className="py-2"
        />
        <Input
          type="number"
          step="0.01"
          fullWidth={false}
          placeholder={`${t.amount} *`}
          value={form.amount || ""}
          onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
          onBlur={checkForDuplicates}
          className="py-2"
        />
      </div>
      {duplicateWarning && (
        <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md text-sm">
          <span className="text-yellow-600 dark:text-yellow-400 font-medium">{t.possible_duplicate}:</span>
          <span className="text-yellow-700 dark:text-yellow-300">
            {duplicateWarning.supplier} — {duplicateWarning.amount.toFixed(2)} CHF ({formatDisplayDate(duplicateWarning.date)})
          </span>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          onClick={() => {
            if (!form.supplier.trim()) return toast.error("Supplier is required");
            if (!form.amount) return toast.error("Amount is required");
            onSave({
              ...form,
              due_date: prefill?.due_date ?? null,
              paid_date: null,
              receipt_path: null,
            });
          }}
        >
          {t.save}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </Card>
  );
}
