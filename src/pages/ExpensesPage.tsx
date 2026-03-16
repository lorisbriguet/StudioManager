import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Plus, Paperclip, Search, Eye, X, ChevronRight, Upload } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatDisplayDate } from "../utils/formatDate";
import { open } from "@tauri-apps/plugin-dialog";
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
} from "../db/hooks/useExpenses";
import { getNextExpenseReference } from "../db/queries/expenses";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { useT } from "../i18n/useT";
import { extractPdfText, parseExpenseFromText, type ExtractedExpenseData } from "../lib/pdfExtract";

type SortKey = "reference" | "supplier" | "category_code" | "invoice_date" | "amount" | "paid_date";

export function ExpensesPage() {
  const t = useT();
  const { data: expenses, isLoading } = useExpenses();
  const { data: categories } = useExpenseCategories();
  const { data: pastSuppliers } = useDistinctSuppliers();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "invoice_date", dir: "desc" });
  const [preview, setPreview] = useState<{ path: string; reference: string } | null>(null);
  const currentYear = new Date().getFullYear();
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set([currentYear]));
  const [isDragging, setIsDragging] = useState(false);
  const [prefill, setPrefill] = useState<(ExtractedExpenseData & { receiptPath?: string }) | null>(null);
  const [parsing, setParsing] = useState(false);

  const categoryName = (code: string) =>
    categories?.find((c) => c.code === code)?.name_fr ?? code;

  const filtered = useMemo(() => {
    if (!expenses) return [];
    const q = search.toLowerCase();
    const rows = q
      ? expenses.filter(
          (e) =>
            e.reference.toLowerCase().includes(q) ||
            e.supplier.toLowerCase().includes(q) ||
            e.category_code.toLowerCase().includes(q)
        )
      : expenses;
    return sortRows(rows, sort.key, sort.dir);
  }, [expenses, search, sort]);

  const groupedByYear = useMemo(() => {
    const groups = new Map<number, typeof filtered>();
    for (const exp of filtered) {
      const year = exp.invoice_date ? parseInt(exp.invoice_date.substring(0, 4)) : currentYear;
      const arr = groups.get(year) ?? [];
      arr.push(exp);
      groups.set(year, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b - a);
  }, [filtered, currentYear]);

  const toggleYear = (year: number) => {
    const next = new Set(expandedYears);
    next.has(year) ? next.delete(year) : next.add(year);
    setExpandedYears(next);
  };

  const handleDroppedFile = useCallback(async (filePath: string) => {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "png", "jpg", "jpeg"].includes(ext)) {
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
      console.error("PDF parsing failed:", e);
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
        filters: [{ name: "Files", extensions: ["pdf", "png", "jpg", "jpeg"] }],
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

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;

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
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 rounded-lg">
          <span className="text-sm text-muted">Analyzing PDF...</span>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{t.expenses}</h1>
        <button
          onClick={() => { setPrefill(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
        >
          <Plus size={16} /> {t.new_expense}
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Search size={16} className="text-muted" />
        <input
          placeholder={t.search_expenses}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-md px-3 py-1.5 text-sm w-64"
        />
      </div>

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
                console.error("Receipt copy failed:", e);
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

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
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
                    className="border-b border-gray-200 bg-gray-50 cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleYear(year)}
                  >
                    <td colSpan={7} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          size={14}
                          className={`text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                        <span className="font-medium text-sm">{year}</span>
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
                      <tr key={exp.id} className="border-b border-gray-100 hover:bg-gray-50">
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
                            <input
                              type="date"
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
                              className={`border border-gray-200 rounded px-1.5 py-0.5 text-xs w-[110px] ${
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
                                <Eye size={12} /> View
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  {search ? t.no_matching_expenses : t.no_expenses_yet}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {preview && (
        <ReceiptPreview
          path={preview.path}
          reference={preview.reference}
          onClose={() => setPreview(null)}
        />
      )}
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
          <button onClick={onClose} className="text-muted hover:text-gray-900">
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
  const [showSuggestions, setShowSuggestions] = useState(false);

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
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 mb-6 space-y-3">
      {prefill?.receiptPath && (
        <div className="flex items-center gap-2 text-xs text-success">
          <Paperclip size={12} />
          <span>Receipt will be attached: {prefill.receiptPath.split("/").pop()}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="relative">
          <input
            placeholder={`${t.supplier} *`}
            value={form.supplier}
            onChange={(e) => {
              setForm({ ...form, supplier: e.target.value });
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
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
        <select
          value={form.category_code}
          onChange={(e) => setForm({ ...form, category_code: e.target.value })}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm"
        >
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} - {c.name_fr}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={form.invoice_date}
          onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm"
        />
        <input
          type="number"
          step="0.01"
          placeholder={`${t.amount} *`}
          value={form.amount || ""}
          onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button
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
          className="px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
        >
          {t.save}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 border border-gray-200 text-sm rounded-md hover:bg-gray-50"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
