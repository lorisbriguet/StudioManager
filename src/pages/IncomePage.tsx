import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Plus, Paperclip, Eye, X, ChevronRight, Trash2, Upload } from "lucide-react";
import { PageHeader, SearchBar, Button } from "../components/ui";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatDisplayDate } from "../utils/formatDate";
import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, mkdir, exists, readFile } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  useIncomes,
  useCreateIncome,
  useUpdateIncome,
  useDeleteIncome,
} from "../db/hooks/useIncome";
import { getNextIncomeReference } from "../db/queries/income";
import { SortHeader, sortRows, type SortState } from "../components/SortHeader";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu";
import { useT } from "../i18n/useT";
import type { Income } from "../types/income";
import { extractPdfText, extractImageText, parseExpenseFromText } from "../lib/pdfExtract";
import { logError } from "../lib/log";
import { useYearGrouping } from "../hooks/useYearGrouping";

type SortKey = "reference" | "source" | "category" | "date" | "amount";

const INCOME_CATEGORIES = [
  "side_income",
  "grant",
  "refund",
  "interest",
  "other",
] as const;

export function IncomePage() {
  const t = useT();
  const { data: incomes, isLoading } = useIncomes();
  const createIncome = useCreateIncome();
  const updateIncome = useUpdateIncome();
  const deleteIncome = useDeleteIncome();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "date", dir: "desc" });
  const [preview, setPreview] = useState<{ path: string; reference: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [droppedReceiptPath, setDroppedReceiptPath] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ amount?: number; date?: string; source?: string } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<Income> | null>(null);

  const filtered = useMemo(() => {
    if (!incomes) return [];
    const q = search.toLowerCase();
    const rows = q
      ? incomes.filter(
          (i) =>
            i.reference.toLowerCase().includes(q) ||
            i.source.toLowerCase().includes(q) ||
            i.description.toLowerCase().includes(q) ||
            i.category.toLowerCase().includes(q)
        )
      : incomes;
    return sortRows(rows, sort.key, sort.dir);
  }, [incomes, search, sort]);

  const { expandedYears, groupedByYear, toggleYear } = useYearGrouping(
    filtered,
    useCallback((inc: (typeof filtered)[0]) => inc.date, [])
  );

  const handleDroppedFile = useCallback(async (filePath: string) => {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "png", "jpg", "jpeg", "heic"].includes(ext)) {
      toast.error(t.unsupported_file);
      return;
    }

    setParsing(true);
    try {
      let extracted: { supplier?: string; amount?: number; date?: string } = {};

      if (ext === "pdf") {
        const text = await extractPdfText(filePath);
        if (text) extracted = parseExpenseFromText(text);
      } else if (["png", "jpg", "jpeg", "heic"].includes(ext)) {
        const text = await extractImageText(filePath);
        if (text) extracted = parseExpenseFromText(text);
      }

      setPrefill({
        amount: extracted.amount,
        date: extracted.date,
        source: extracted.supplier,
      });
    } catch (e) {
      logError("Income file parsing failed:", e);
      setPrefill(null);
    } finally {
      setParsing(false);
    }

    setDroppedReceiptPath(filePath);
    setShowForm(true);
  }, [t]);

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
        if (paths.length > 0) handleDroppedFile(paths[0]);
      } else if (event.payload.type === "leave") {
        setIsDragging(false);
      }
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unlisten = fn;
    }).catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleDroppedFile]);

  const attachReceipt = async (incomeId: number, reference: string, source: string) => {
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
      const safeSrc = source.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
      const destPath = `${receiptsDir}/${safeRef}_${safeSrc}.${ext}`;
      await copyFile(filePath, destPath);
      updateIncome.mutate(
        { id: incomeId, data: { receipt_path: destPath } },
        { onSuccess: () => toast.success(t.receipt_attached) }
      );
    } catch {
      toast.error("Failed to attach receipt");
    }
  };

  if (isLoading) return <div className="text-muted text-sm">{t.loading}</div>;

  return (
    <div className="relative">
      {(isDragging || parsing) && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-accent">
            <Upload size={32} />
            <span className="text-sm font-medium">{parsing ? t.parsing_receipt : t.drop_pdf_hint}</span>
          </div>
        </div>
      )}

      <PageHeader title={t.income}>
        <Button icon={<Plus size={16} />} onClick={() => { setDroppedReceiptPath(null); setShowForm(true); }}>
          {t.new_income}
        </Button>
      </PageHeader>

      <SearchBar value={search} onChange={setSearch} placeholder={t.search_incomes} className="w-64 mb-4" />

      {showForm && (
        <NewIncomeForm
          droppedReceiptPath={droppedReceiptPath}
          prefill={prefill}
          onSave={async (data) => {
            const reference = await getNextIncomeReference(new Date().getFullYear());

            let receiptPath = data.receipt_path;
            if (droppedReceiptPath && !receiptPath) {
              try {
                const ext = droppedReceiptPath.split(".").pop() ?? "pdf";
                const dataDir = await appDataDir();
                const receiptsDir = `${dataDir}/receipts`;
                if (!(await exists(receiptsDir))) {
                  await mkdir(receiptsDir, { recursive: true });
                }
                const safeRef = reference.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
                const safeSrc = (data.source || "").replace(/[/\\]/g, "_").replace(/\.\./g, "_");
                const destPath = `${receiptsDir}/${safeRef}_${safeSrc}.${ext}`;
                await copyFile(droppedReceiptPath, destPath);
                receiptPath = destPath;
              } catch (e) {
                logError("Receipt copy failed:", e);
              }
            }

            createIncome.mutate(
              { ...data, reference, receipt_path: receiptPath },
              {
                onSuccess: () => {
                  toast.success(t.toast_created);
                  setShowForm(false);
                  setDroppedReceiptPath(null);
                },
              }
            );
          }}
          onCancel={() => { setShowForm(false); setDroppedReceiptPath(null); setPrefill(null); }}
        />
      )}

      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <SortHeader label={t.reference} sortKey="reference" current={sort} onSort={setSort} />
              <SortHeader label={t.source} sortKey="source" current={sort} onSort={setSort} />
              <SortHeader label={t.description} sortKey="category" current={sort} onSort={setSort} />
              <SortHeader label={t.date} sortKey="date" current={sort} onSort={setSort} />
              <SortHeader label={t.amount} sortKey="amount" current={sort} onSort={setSort} align="right" />
              <th className="px-4 py-2 font-medium text-muted text-left">{t.receipt}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {groupedByYear.map(([year, yearIncomes]) => {
              const isOpen = expandedYears.has(year);
              const yearTotal = yearIncomes.reduce((s, i) => s + i.amount, 0);
              return (
                <React.Fragment key={year}>
                  <tr
                    className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-200"
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
                          {yearIncomes.length} {yearIncomes.length !== 1 ? t.incomes_count_plural : t.incomes_count_singular}
                        </span>
                        <span className="ml-auto text-sm font-medium">
                          CHF {yearTotal.toFixed(2)}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {isOpen &&
                    yearIncomes.map((inc) => (
                      <tr
                        key={inc.id}
                        className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-200 group"
                        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: inc }); }}
                      >
                        <td className="px-4 py-2 font-medium">{inc.reference}</td>
                        <td className="px-4 py-2">{inc.source}</td>
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100">
                            {inc.category}
                          </span>
                          {inc.description && (
                            <span className="ml-1 text-xs text-muted">{inc.description}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-muted">{formatDisplayDate(inc.date)}</td>
                        <td className="px-4 py-2 text-right font-medium">
                          CHF {inc.amount.toFixed(2)}
                        </td>
                        <td className="px-4 py-2">
                          {inc.receipt_path ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setPreview({ path: inc.receipt_path!, reference: inc.reference })}
                                className="text-xs text-accent hover:underline flex items-center gap-1"
                              >
                                <Eye size={14} /> View
                              </button>
                              <span className="text-xs text-success flex items-center gap-1">
                                <Paperclip size={12} />
                              </span>
                            </div>
                          ) : (
                            <button
                              onClick={() => attachReceipt(inc.id, inc.reference, inc.source)}
                              className="text-xs text-accent hover:underline flex items-center gap-1"
                            >
                              <Paperclip size={12} /> Attach
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <button
                            onClick={() => {
                              deleteIncome.mutate(inc.id, {
                                onSuccess: () => toast.success(t.toast_deleted),
                              });
                            }}
                            className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-600 transition-opacity"
                            title={t.delete}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  {search ? t.no_matching_incomes : t.no_incomes_yet}
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
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteIncome.mutate(ctxMenu.item.id) },
          ]}
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

function NewIncomeForm({
  droppedReceiptPath,
  prefill,
  onSave,
  onCancel,
}: {
  droppedReceiptPath: string | null;
  prefill: { amount?: number; date?: string; source?: string } | null;
  onSave: (data: {
    date: string;
    description: string;
    amount: number;
    category: string;
    source: string;
    receipt_path: string | null;
    notes: string;
  }) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState({
    source: prefill?.source ?? "",
    description: "",
    category: INCOME_CATEGORIES[0] as string,
    date: prefill?.date ?? format(new Date(), "yyyy-MM-dd"),
    amount: prefill?.amount ?? 0,
    notes: "",
  });

  useEffect(() => {
    if (prefill) {
      setForm((prev) => ({
        ...prev,
        source: prefill.source ?? prev.source,
        date: prefill.date ?? prev.date,
        amount: prefill.amount ?? prev.amount,
      }));
    }
  }, [prefill]);

  return (
    <div className="border border-gray-100 rounded-lg p-4 mb-6 space-y-3">
      {droppedReceiptPath && (
        <div className="flex items-center gap-2 text-xs text-success">
          <Paperclip size={12} />
          <span>Receipt will be attached: {droppedReceiptPath.split("/").pop()}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <input
          placeholder={`${t.source} *`}
          value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })}
          className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
        />
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="border border-gray-200 rounded-md px-3 py-2 text-sm"
        >
          {INCOME_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </select>
        <input
          placeholder={t.description}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
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
            if (!form.source.trim()) return toast.error(t.source + " is required");
            if (!form.amount) return toast.error(t.amount + " is required");
            onSave({
              ...form,
              receipt_path: null,
            });
          }}
          className="px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover"
        >
          {t.save}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 border border-gray-200 text-sm rounded-md hover:bg-gray-50 dark:hover:bg-gray-200"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
