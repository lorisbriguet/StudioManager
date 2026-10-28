import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Plus, Paperclip, Eye, Trash2, Upload, Wallet, Pencil, Settings2 } from "lucide-react";
import { PageHeader, SearchBar, Button, DatePicker, EmptyState, FormField, FormGrid, FormModal, Input, Select, Table, TableSkeleton, IconButton, Tag } from "../components/ui";
import * as v from "../lib/validate";
import { undoableFromStore } from "../lib/undo";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatDisplayDate } from "../utils/formatDate";
import { ask } from "@tauri-apps/plugin-dialog";
import { copyFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { orgPaths } from "../lib/orgPaths";
import { attachReceipt as attachReceiptFlow, sanitizeSegment } from "../lib/attachReceipt";
import { ReceiptPreview } from "../components/ReceiptPreview";
import {
  useIncomes,
  useCreateIncome,
  useUpdateIncome,
  useDeleteIncome,
} from "../db/hooks/useIncome";
import { getNextIncomeReference } from "../db/queries/income";
import { SortHeader, sortRows, type SortState } from "../components/ui/SortHeader";
import { ContextMenu, type ContextMenuState } from "../components/ui/ContextMenu";
import { BulkActionBar } from "../components/ui/BulkActionBar";
import { useReceiptDrop } from "../hooks/useReceiptDrop";
import { useDetectedFields } from "../hooks/useDetectedFields";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { useT } from "../i18n/useT";
import type { Income } from "../types/income";
import { logError } from "../lib/log";
import { useYearGrouping } from "../hooks/useYearGrouping";
import { useListNavigation } from "../hooks/useListNavigation";
import { SavedFilterBar } from "../components/shared/SavedFilterBar";
import { ReceiptNote } from "../components/shared/ReceiptNote";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";

type SortKey = "reference" | "source" | "category" | "date" | "amount";

const INCOME_CATEGORIES = [
  "side_income",
  "grant",
  "refund",
  "interest",
  "other",
] as const;

/** The five income category codes are stored raw in the database; both the row
 *  badge and the edit form must show the same translated label. */
function incomeCategoryLabel(t: ReturnType<typeof useT>, code: string): string {
  const key = `income_cat_${code}` as keyof typeof t;
  return (t[key] as string | undefined) ?? code.replace(/_/g, " ");
}

export function IncomePage() {
  const t = useT();
  const { data: incomes, isLoading } = useIncomes();
  const createIncome = useCreateIncome();
  const updateIncome = useUpdateIncome();
  const deleteIncome = useDeleteIncome();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "date", dir: "desc" });
  const [preview, setPreview] = useState<{ path: string; reference: string } | null>(null);
  const [droppedReceiptPath, setDroppedReceiptPath] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ amount?: number; date?: string; source?: string } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<Income> | null>(null);
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<ConditionLogic>("and");

  const applyFilter = useCallback((filters: SavedFilterData) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    if (filters.sort && typeof filters.sort === "object") setSort(filters.sort as SortState<SortKey>);
    setFilterConditions(filters.conditions ?? []);
    setFilterLogic(filters.conditionLogic ?? "and");
  }, []);

  const incomeFields = useMemo<FilterableField[]>(() => [
    { key: "reference", label: t.reference, type: "string" },
    { key: "source", label: t.source, type: "string" },
    { key: "category", label: t.category, type: "select", options: INCOME_CATEGORIES.map((c) => ({ value: c, label: incomeCategoryLabel(t, c) })) },
    { key: "amount", label: t.amount, type: "number" },
  ], [t]);

  const filtered = useMemo(() => {
    if (!incomes) return [];
    const q = search.toLowerCase();
    let rows = q
      ? incomes.filter(
          (i) =>
            i.reference.toLowerCase().includes(q) ||
            i.source.toLowerCase().includes(q) ||
            i.description.toLowerCase().includes(q) ||
            i.category.toLowerCase().includes(q)
        )
      : incomes;
    rows = applyFilterConditions(rows, filterConditions, filterLogic);
    return sortRows(rows, sort.key, sort.dir);
  }, [incomes, search, sort, filterConditions, filterLogic]);

  const bulk = useBulkSelect(filtered);

  const bulkDelete = useCallback(async () => {
    if (!(await ask(t.confirm_bulk_delete, { kind: "warning" }))) return;
    const ids = [...bulk.selected] as number[];
    ids.forEach((id) => deleteIncome.mutate(id));
    bulk.clearSelection();
  }, [bulk, deleteIncome, t]);

  const { expandedYears, groupedByYear, toggleYear } = useYearGrouping(
    filtered,
    useCallback((inc: (typeof filtered)[0]) => inc.date, [])
  );

  // Cmd+N (GlobalShortcuts) opens the inline form on this page.
  useEffect(() => {
    const open = () => { setDroppedReceiptPath(null); setEditing(null); setShowForm(true); };
    window.addEventListener("sm:new-item", open);
    return () => window.removeEventListener("sm:new-item", open);
  }, []);

  // Keyboard row navigation over the visible (expanded) rows.
  const visibleRows = useMemo(
    () => groupedByYear.flatMap(([year, rows]) => (expandedYears.has(year) ? rows : [])),
    [groupedByYear, expandedYears]
  );
  const rowIdxById = useMemo(
    () => new Map(visibleRows.map((r, i) => [r.id, i])),
    [visibleRows]
  );
  const openIncome = useCallback((inc: Income) => { setShowForm(false); setEditing(inc); }, []);
  const { focusIdx } = useListNavigation({
    items: visibleRows,
    onOpen: openIncome,
    onMenu: useCallback((inc: Income, pos: { x: number; y: number }) => setCtxMenu({ ...pos, item: inc }), []),
    enabled: preview === null,
  });

  const { isDragging, parsing } = useReceiptDrop({
    onResult: (extracted, filePath) => {
      const hasData =
        extracted.amount != null || extracted.invoice_date != null || extracted.supplier != null;
      setPrefill(
        hasData
          ? { amount: extracted.amount, date: extracted.invoice_date, source: extracted.supplier }
          : null
      );
      setDroppedReceiptPath(filePath);
      setShowForm(true);
    },
  });

  const attachReceipt = (incomeId: number, reference: string, source: string) =>
    attachReceiptFlow(
      reference,
      source,
      (destPath) =>
        updateIncome.mutate(
          { id: incomeId, data: { receipt_path: destPath } },
          { onSuccess: () => toast.success(t.receipt_attached) }
        ),
      () => toast.error(t.failed_to_attach_receipt)
    );

  if (isLoading) return (
    <div className="relative">
      <PageHeader title={t.income}>
        <Button icon={<Plus size={12} />} onClick={() => { setDroppedReceiptPath(null); setShowForm(true); }}>
          {t.new_income}
        </Button>
      </PageHeader>
      <TableSkeleton columns={8} />
    </div>
  );

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
        <Button icon={<Plus size={12} />} onClick={() => { setDroppedReceiptPath(null); setShowForm(true); }}>
          {t.new_income}
        </Button>
      </PageHeader>

      <SearchBar value={search} onChange={(v) => { setSearch(v); setActiveFilterId(null); setFilterConditions([]); }} placeholder={t.search_incomes} className="w-64 mb-4" />

      <SavedFilterBar
        page="income"
        currentFilters={{ search, sort, conditions: filterConditions, conditionLogic: filterLogic }}
        onApply={applyFilter}
        activeFilterId={activeFilterId}
        onActiveChange={setActiveFilterId}
        fields={incomeFields}
      />

      {(showForm || editing) && (
        <NewIncomeForm
          key={editing?.id ?? "new"}
          droppedReceiptPath={editing ? null : droppedReceiptPath}
          prefill={editing ? null : prefill}
          initial={editing}
          onSave={async (data) => {
            if (editing) {
              // Never touch receipt_path on edit — the receipt cell manages it.
              const { receipt_path: _omit, ...fields } = data;
              updateIncome.mutate(
                { id: editing.id, data: fields },
                {
                  onSuccess: () => {
                    toast.success(t.toast_income_updated);
                    setEditing(null);
                  },
                }
              );
              return;
            }
            const reference = await getNextIncomeReference(new Date().getFullYear());

            let receiptPath = data.receipt_path;
            if (droppedReceiptPath && !receiptPath) {
              try {
                const ext = droppedReceiptPath.split(".").pop() ?? "pdf";
                const { receiptsDir } = await orgPaths();
                if (!(await exists(receiptsDir))) {
                  await mkdir(receiptsDir, { recursive: true });
                }
                const safeRef = sanitizeSegment(reference);
                const safeSrc = sanitizeSegment(data.source || "");
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
          onCancel={() => { setShowForm(false); setEditing(null); setDroppedReceiptPath(null); setPrefill(null); }}
        />
      )}

      <Table>
        <Table.Head>
          <Table.SelectAll all={bulk.isAllSelected} some={bulk.selected.size > 0} onToggle={bulk.toggleAll} />
          <SortHeader label={t.reference} sortKey="reference" current={sort} onSort={setSort} />
          <SortHeader label={t.source} sortKey="source" current={sort} onSort={setSort} />
          <SortHeader label={t.description} sortKey="category" current={sort} onSort={setSort} />
          <SortHeader label={t.date} sortKey="date" current={sort} onSort={setSort} />
          <SortHeader label={t.amount} sortKey="amount" current={sort} onSort={setSort} align="right" />
          <Table.Th>{t.receipt}</Table.Th>
          <Table.ActionsTh />
        </Table.Head>
        <Table.Body>
          {groupedByYear.map(([year, yearIncomes]) => {
            const isOpen = expandedYears.has(year);
            const yearTotal = yearIncomes.reduce((s, i) => s + i.amount, 0);
            return (
              <React.Fragment key={year}>
                <Table.Group
                  colSpan={8}
                  label={year}
                  count={`${yearIncomes.length} ${yearIncomes.length !== 1 ? t.incomes_count_plural : t.incomes_count_singular}`}
                  total={`CHF ${yearTotal.toFixed(2)}`}
                  open={isOpen}
                  onToggle={() => toggleYear(year)}
                />
                {isOpen &&
                  yearIncomes.map((inc) => (
                    <Table.Row
                      key={inc.id}
                      data-list-row
                      focused={rowIdxById.get(inc.id) === focusIdx}
                      selected={bulk.selected.has(inc.id)}
                      onOpen={() => openIncome(inc)}
                      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: inc }); }}
                    >
                      <Table.Select checked={bulk.selected.has(inc.id)} onToggle={(shift) => bulk.toggleItem(inc.id, shift)} />
                      <Table.Td className="font-medium">{inc.reference}</Table.Td>
                      <Table.Td>{inc.source}</Table.Td>
                      <Table.Td>
                        <Tag name={inc.category}>{incomeCategoryLabel(t, inc.category)}</Tag>
                        {inc.description && (
                          <span className="ml-1 text-xs text-muted">{inc.description}</span>
                        )}
                      </Table.Td>
                      <Table.Td muted>{formatDisplayDate(inc.date)}</Table.Td>
                      <Table.Td numeric className="font-medium">
                        CHF {inc.amount.toFixed(2)}
                      </Table.Td>
                      <Table.Td>
                        {inc.receipt_path ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="link"
                              icon={<Eye size={12} />}
                              onClick={() => setPreview({ path: inc.receipt_path!, reference: inc.reference })}
                            >
                              {t.view}
                            </Button>
                            <span className="text-xs text-success flex items-center gap-1">
                              <Paperclip size={12} />
                            </span>
                          </div>
                        ) : (
                          <Button
                            variant="link"
                            icon={<Paperclip size={12} />}
                            onClick={() => attachReceipt(inc.id, inc.reference, inc.source)}
                          >
                            {t.attach}
                          </Button>
                        )}
                      </Table.Td>
                      <Table.Actions>
                        <IconButton size="xs"
                          icon={Settings2}
                          label={t.more_actions}
                          onClick={(e) => setCtxMenu({ x: e.clientX, y: e.clientY, item: inc })}
                        />
                      </Table.Actions>
                    </Table.Row>
                  ))}
              </React.Fragment>
            );
          })}
          {filtered.length === 0 && !isLoading && (
            <Table.Empty colSpan={8}>
              <EmptyState
                message={(incomes?.length ?? 0) === 0 ? t.no_incomes_yet : t.no_matching_incomes}
                icon={<Wallet size={32} />}
                action={(incomes?.length ?? 0) === 0 ? (
                  <Button icon={<Plus size={12} />} onClick={() => { setDroppedReceiptPath(null); setShowForm(true); }}>
                    {t.new_income}
                  </Button>
                ) : undefined}
              />
            </Table.Empty>
          )}
        </Table.Body>
      </Table>

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
            { label: t.edit, icon: <Pencil size={14} />, onClick: () => { setShowForm(false); setEditing(ctxMenu.item); } },
            ctxMenu.item.receipt_path
              ? { label: t.view, icon: <Eye size={14} />, onClick: () => setPreview({ path: ctxMenu.item.receipt_path!, reference: ctxMenu.item.reference }) }
              : { label: t.attach, icon: <Paperclip size={14} />, onClick: () => attachReceipt(ctxMenu.item.id, ctxMenu.item.reference, ctxMenu.item.source) },
            { label: "", divider: true, onClick: () => {} },
            { label: t.delete, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteIncome.mutate(ctxMenu.item.id, { onSuccess: () => undoableFromStore(t.toast_income_deleted) }) },
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

// Phase 2 E3 — inline validation (E1 pattern). category is a Select that
// always holds a valid value; description/notes are free-form. Unvalidated.
type IncomeFormField = "source" | "amount" | "date";

const incomeSchema: v.FormSchema<IncomeFormField> = {
  source: [v.required],
  amount: [v.required, v.numberPositive],
  date: [v.required, v.dateValid],
};

/** Fields the receipt parser can prefill — tracked for "from receipt" badges. */
type DetectableIncomeField = "source" | "date" | "amount";

function detectedIncomeFields(
  prefill: { amount?: number; date?: string; source?: string } | null | undefined
): Set<DetectableIncomeField> {
  const s = new Set<DetectableIncomeField>();
  if (prefill?.source) s.add("source");
  if (prefill?.date) s.add("date");
  if (prefill?.amount) s.add("amount");
  return s;
}

export function NewIncomeForm({
  droppedReceiptPath,
  prefill,
  initial,
  onSave,
  onCancel,
}: {
  droppedReceiptPath: string | null;
  prefill: { amount?: number; date?: string; source?: string } | null;
  /** When set, the form edits this income instead of creating a new one. */
  initial?: Income | null;
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
    source: initial?.source ?? prefill?.source ?? "",
    description: initial?.description ?? "",
    category: (initial?.category ?? INCOME_CATEGORIES[0]) as string,
    date: initial?.date ?? prefill?.date ?? format(new Date(), "yyyy-MM-dd"),
    amount: initial?.amount ?? prefill?.amount ?? 0,
    notes: initial?.notes ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<IncomeFormField, string>>>({});
  const { undetect, resetDetected, detectedBadge, detectedClass } =
    useDetectedFields<DetectableIncomeField>(() => detectedIncomeFields(prefill));

  const setFieldError = (field: IncomeFormField, msg: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[field] = msg;
      else delete next[field];
      return next;
    });

  // Raw string value per validated field; amount is held as a number in form
  // state and renders as "" while zero, so validate what the user sees.
  const fieldValue = (field: IncomeFormField): string =>
    field === "amount" ? (form.amount ? String(form.amount) : "") : form[field];

  const validateOnBlur = (field: IncomeFormField) =>
    setFieldError(field, v.validateField(fieldValue(field), incomeSchema[field]));

  const clearError = (field: IncomeFormField) => setFieldError(field, null);

  useEffect(() => {
    if (prefill) {
      setForm((prev) => ({
        ...prev,
        source: prefill.source ?? prev.source,
        date: prefill.date ?? prev.date,
        amount: prefill.amount ?? prev.amount,
      }));
      // Receipt-parse prefill fills fields programmatically — clear any stale
      // inline error on exactly the fields it fills.
      setErrors((e) => {
        const next = { ...e };
        if (prefill.source != null) delete next.source;
        if (prefill.date != null) delete next.date;
        if (prefill.amount != null) delete next.amount;
        return next;
      });
      resetDetected(detectedIncomeFields(prefill));
    }
  }, [prefill, resetDetected]);

  const submit = () => {
    const errs = v.validateForm(
      { source: form.source, amount: fieldValue("amount"), date: form.date },
      incomeSchema
    );
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    // DB failures surface via the mutation's onError toast (backstop).
    onSave({
      ...form,
      receipt_path: null,
    });
  };

  return (
    <FormModal open onClose={onCancel} title={initial ? t.edit : t.new_income} submitLabel={t.save} onSubmit={submit}>
      {droppedReceiptPath && <ReceiptNote path={droppedReceiptPath} />}
      <FormGrid cols={2}>
        <FormField
          label={t.source}
          required
          error={errors.source}
          badge={detectedBadge("source", () => setForm((f) => ({ ...f, source: "" })))}
        >
          <Input
            value={form.source}
            onChange={(e) => {
              setForm({ ...form, source: e.target.value });
              clearError("source");
              undetect("source");
            }}
            onBlur={() => validateOnBlur("source")}
            className={detectedClass("source")}
          />
        </FormField>
        <FormField label={t.category}>
          <Select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {INCOME_CATEGORIES.map((c) => (
              <option key={c} value={c}>{incomeCategoryLabel(t, c)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t.description}>
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </FormField>
        <FormField
          label={t.date}
          required
          error={errors.date}
          badge={detectedBadge("date", () =>
            setForm((f) => ({ ...f, date: format(new Date(), "yyyy-MM-dd") }))
          )}
        >
          <DatePicker
            value={form.date || null}
            onChange={(v) => {
              setForm({ ...form, date: v ?? "" });
              clearError("date");
              undetect("date");
            }}
            onBlur={() => validateOnBlur("date")}
            inputClassName={detectedClass("date")}
          />
        </FormField>
        <FormField
          label={t.amount}
          required
          error={errors.amount}
          badge={detectedBadge("amount", () => setForm((f) => ({ ...f, amount: 0 })))}
        >
          <Input
            type="number"
            step="0.01"
            value={form.amount || ""}
            onChange={(e) => {
              setForm({ ...form, amount: Number(e.target.value) });
              clearError("amount");
              undetect("amount");
            }}
            onBlur={() => validateOnBlur("amount")}
            className={detectedClass("amount")}
          />
        </FormField>
      </FormGrid>
    </FormModal>
  );
}
