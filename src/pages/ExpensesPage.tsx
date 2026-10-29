import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { CalendarCheck } from "lucide-react";
import { ICONS, ICON_SIZE, Button, DatePicker, Input, Select, FormField, FormGrid, FormModal, PageHeader, SearchBar, Table, TableSkeleton, EmptyState, QueryState, NoResults, Spinner, Popover, IconButton, Tag, Callout, Tooltip } from "../components/ui";
import * as v from "../lib/validate";
import { deleteWithUndo } from "../lib/undo";
import { SavedFilterBar } from "../components/shared/SavedFilterBar";
import { ReceiptNote } from "../components/shared/ReceiptNote";
import { notify } from "../lib/notify";
import { format } from "date-fns";
import { formatDisplayDate } from "../utils/formatDate";
import { todayLocalISO } from "../utils/localDate";
import { copyFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { orgPaths } from "../lib/orgPaths";
import { attachReceipt as attachReceiptFlow, sanitizeSegment } from "../lib/attachReceipt";
import { ReceiptPreview } from "../components/ReceiptPreview";
import {
  useExpenses,
  useExpenseCategories,
  useDistinctSuppliers,
  useCreateExpense,
  useUpdateExpense,
  useDeleteExpense,
  useDuplicateCheck,
} from "../db/hooks/useExpenses";
import { ContextMenu, type ContextMenuState } from "../components/ui/ContextMenu";
import { MENU_ITEM } from "../components/ui/Dropdown";
import { BulkActionBar } from "../components/ui/BulkActionBar";
import { useReceiptDrop } from "../hooks/useReceiptDrop";
import { useListNavigation } from "../hooks/useListNavigation";
import { useDetectedFields } from "../hooks/useDetectedFields";
import { useBulkSelect } from "../hooks/useBulkSelect";
import { useBulkDelete } from "../hooks/useBulkDelete";
import type { Expense } from "../types/expense";
import { getNextExpenseReference } from "../db/queries/expenses";
import { SortHeader, sortRows, type SortState } from "../components/ui/SortHeader";
import { useT } from "../i18n/useT";
import { type ExtractedExpenseData } from "../lib/expenseParse";
import { logError } from "../lib/log";
import { useYearGrouping } from "../hooks/useYearGrouping";
import type { SavedFilterData, FilterCondition, FilterableField } from "../types/saved-filter";
import { applyFilterConditions, type ConditionLogic } from "../types/saved-filter";

type SortKey = "reference" | "supplier" | "category_code" | "invoice_date" | "amount" | "paid_date";

export function ExpensesPage() {
  const t = useT();
  const expensesQuery = useExpenses();
  const { data: expenses } = expensesQuery;
  const { data: categories } = useExpenseCategories();
  const { data: pastSuppliers } = useDistinctSuppliers();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const [showForm, setShowForm] = useState(false);
  // From the first await (the next reference) to the end of the insert: a
  // second Enter in that window would create a second expense.
  const [saving, setSaving] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState<Expense> | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "invoice_date", dir: "desc" });
  const [preview, setPreview] = useState<{ path: string; reference: string } | null>(null);
  const [prefill, setPrefill] = useState<(ExtractedExpenseData & { receiptPath?: string }) | null>(null);
  const [activeFilterId, setActiveFilterId] = useState<number | null>(null);
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<ConditionLogic>("and");
  const [editDateExpense, setEditDateExpense] = useState<Expense | null>(null);
  const [editDateValue, setEditDateValue] = useState("");

  const applyFilter = useCallback((filters: SavedFilterData) => {
    if (typeof filters.search === "string") setSearch(filters.search);
    if (filters.sort && typeof filters.sort === "object") setSort(filters.sort as SortState<SortKey>);
    setFilterConditions(filters.conditions ?? []);
    setFilterLogic(filters.conditionLogic ?? "and");
  }, []);

  const expenseFields = useMemo<FilterableField[]>(() => [
    { key: "reference", label: t.reference, type: "string" },
    { key: "supplier", label: t.supplier, type: "string" },
    { key: "category_code", label: t.category, type: "select", options: (categories ?? []).map((c) => ({ value: c.code, label: c.name_fr })) },
    { key: "amount", label: t.amount, type: "number" },
  ], [t, categories]);

  // Map lookup instead of a linear find per rendered row
  const categoryMap = useMemo(
    () => new Map((categories ?? []).map((c) => [c.code, c])),
    [categories]
  );

  const categoryName = (code: string) => categoryMap.get(code)?.name_fr ?? code;


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
    rows = applyFilterConditions(rows, filterConditions, filterLogic);
    return sortRows(rows, sort.key, sort.dir);
  }, [expenses, search, sort, filterConditions, filterLogic]);

  const { expandedYears, groupedByYear, toggleYear } = useYearGrouping(
    filtered,
    useCallback((exp: (typeof filtered)[0]) => exp.invoice_date, [])
  );

  // Cmd+N (GlobalShortcuts) opens the inline form on this page.
  useEffect(() => {
    const open = () => { setPrefill(null); setShowForm(true); };
    window.addEventListener("sm:new-item", open);
    return () => window.removeEventListener("sm:new-item", open);
  }, []);

  // Keyboard row navigation over the visible (expanded) rows. Expenses have
  // no full edit form, so Enter opens the row menu like Space.
  const visibleRows = useMemo(
    () => groupedByYear.flatMap(([year, rows]) => (expandedYears.has(year) ? rows : [])),
    [groupedByYear, expandedYears]
  );
  const rowIdxById = useMemo(
    () => new Map(visibleRows.map((r, i) => [r.id, i])),
    [visibleRows]
  );
  const openRowMenu = useCallback(
    (exp: Expense, pos: { x: number; y: number }) => setCtxMenu({ ...pos, item: exp }),
    []
  );
  const openExpenseMenu = useCallback((exp: Expense) => {
    const el = document.querySelectorAll("[data-list-row]")[rowIdxById.get(exp.id) ?? 0];
    const r = el?.getBoundingClientRect();
    openRowMenu(exp, { x: r ? r.left + 32 : 80, y: r ? r.bottom : 80 });
  }, [openRowMenu, rowIdxById]);
  const { focusIdx } = useListNavigation({
    items: visibleRows,
    onOpen: openExpenseMenu,
    onMenu: openRowMenu,
    enabled: preview === null,
  });

  const bulk = useBulkSelect(filtered);

  const deleteSelection = useBulkDelete("expenses", (id: number) => deleteExpense.mutateAsync(id));
  const bulkDelete = () => void deleteSelection([...bulk.selected] as number[], bulk.clearSelection);

  const saveEditDate = () => {
    if (!editDateExpense) return;
    updateExpense.mutate(
      { id: editDateExpense.id, data: { paid_date: editDateValue || null } },
      { onSuccess: () => { notify.success(editDateValue ? t.paid_date_updated : t.marked_as_unpaid); setEditDateExpense(null); } }
    );
  };

  const { isDragging, parsing } = useReceiptDrop({
    getKnownSuppliers: () => (pastSuppliers ?? []).map((s) => s.supplier),
    onResult: (extracted, filePath) => {
      // Match supplier to known suppliers for category autofill
      if (extracted.supplier && pastSuppliers) {
        const needle = extracted.supplier.trim().toLowerCase();
        const match = pastSuppliers.find(
          (s) => s.supplier.trim().toLowerCase() === needle
        );
        if (match) extracted.supplier = match.supplier;
      }
      setPrefill({ ...extracted, receiptPath: filePath });
      setShowForm(true);
    },
  });

  const attachReceipt = (expenseId: number, reference: string, supplier: string) =>
    attachReceiptFlow(
      reference,
      supplier,
      (destPath) =>
        updateExpense.mutate(
          { id: expenseId, data: { receipt_path: destPath } },
          { onSuccess: () => notify.success(t.receipt_attached) }
        ),
      (err) => notify.error(t.attach_failed, err)
    );

  const clearFilters = () => {
    setSearch("");
    setFilterConditions([]);
    setActiveFilterId(null);
  };

  return (
    <div className="relative">
      {isDragging && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-accent-tint-strong border-2 border-dashed border-accent rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-accent-text">
            <ICONS.upload size={ICON_SIZE.empty} />
            <span className="text-sm font-medium">{t.drop_pdf_hint}</span>
          </div>
        </div>
      )}

      {parsing && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--color-surface)]/60 backdrop-blur-sm rounded-lg">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] shadow-menu">
            <Spinner label={t.analyzing_receipt} />
            <span className="text-sm text-muted" aria-hidden="true">{t.analyzing_receipt}</span>
          </div>
        </div>
      )}

      <PageHeader title={t.expenses}>
        <Button icon={ICONS.add} onClick={() => { setPrefill(null); setShowForm(true); }}>{t.new_expense}</Button>
      </PageHeader>

      <SearchBar value={search} onChange={(v) => { setSearch(v); setActiveFilterId(null); setFilterConditions([]); }} placeholder={t.search_expenses} className="w-64 mb-4" />

      <SavedFilterBar
        page="expenses"
        currentFilters={{ search, sort, conditions: filterConditions, conditionLogic: filterLogic }}
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
          submitting={saving}
          onSave={async (data) => {
            setSaving(true);
            try {
              const reference = await getNextExpenseReference(new Date().getFullYear());

              let receiptPath = data.receipt_path;
              if (prefill?.receiptPath && !receiptPath) {
                try {
                  const ext = prefill.receiptPath.split(".").pop() ?? "pdf";
                  const { receiptsDir } = await orgPaths();
                  if (!(await exists(receiptsDir))) {
                    await mkdir(receiptsDir, { recursive: true });
                  }
                  const safeRef = sanitizeSegment(reference);
                  const safeSup = sanitizeSegment(data.supplier || "");
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
                    notify.success(t.expense_created);
                    setShowForm(false);
                    setPrefill(null);
                  },
                  onSettled: () => setSaving(false),
                }
              );
            } catch (e) {
              setSaving(false);
              throw e;
            }
          }}
          onCancel={() => { setShowForm(false); setPrefill(null); }}
        />
      )}

      <QueryState query={expensesQuery} skeleton={<TableSkeleton columns={9} />} errorMessage={t.load_error_expenses}>
      {(all) => (
      <Table>
        <Table.Head>
          <Table.SelectAll all={bulk.isAllSelected} some={bulk.selected.size > 0} onToggle={bulk.toggleAll} label={t.select_all} />
          <SortHeader label={t.reference} sortKey="reference" current={sort} onSort={setSort} />
          <SortHeader label={t.supplier} sortKey="supplier" current={sort} onSort={setSort} />
          <SortHeader label={t.category} sortKey="category_code" current={sort} onSort={setSort} />
          <SortHeader label={t.date} sortKey="invoice_date" current={sort} onSort={setSort} />
          <SortHeader label={t.paid} sortKey="paid_date" current={sort} onSort={setSort} />
          <Table.Th>{t.receipt}</Table.Th>
          <SortHeader label={t.amount} sortKey="amount" current={sort} onSort={setSort} align="right" />
          <Table.ActionsTh />
        </Table.Head>
        <Table.Body>
          {groupedByYear.map(([year, yearExpenses]) => {
            const isOpen = expandedYears.has(year);
            const yearTotal = yearExpenses.reduce((s, e) => s + e.amount, 0);
            return (
              <React.Fragment key={year}>
                <Table.Group
                  colSpan={9}
                  label={year}
                  count={`${yearExpenses.length} ${yearExpenses.length !== 1 ? t.expenses_count_plural : t.expenses_count_singular}`}
                  total={`CHF ${yearTotal.toFixed(2)}`}
                  open={isOpen}
                  onToggle={() => toggleYear(year)}
                />
                {isOpen &&
                  yearExpenses.map((exp) => (
                    <Table.Row
                      key={exp.id}
                      data-list-row
                      focused={rowIdxById.get(exp.id) === focusIdx}
                      selected={bulk.selected.has(exp.id)}
                      onOpen={(e) => openRowMenu(exp, { x: e.clientX, y: e.clientY })}
                      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item: exp }); }}
                    >
                      <Table.Select checked={bulk.selected.has(exp.id)} onToggle={(shift) => bulk.toggleItem(exp.id, shift)} label={t.select_row.replace("{name}", exp.reference || exp.supplier)} />
                      <Table.Td className="font-medium">{exp.reference}</Table.Td>
                      <Table.Td>{exp.supplier}</Table.Td>
                      <Table.Td>
                        <Tag name={exp.category_code} color={categoryMap.get(exp.category_code)?.color || undefined} />
                        <span className="ml-1 text-xs text-muted">{categoryName(exp.category_code)}</span>
                      </Table.Td>
                      <Table.Td muted>{formatDisplayDate(exp.invoice_date)}</Table.Td>
                      <Table.Td className={exp.paid_date ? "text-[var(--color-success-text)]" : "text-[var(--color-danger-text)]"}>
                        {exp.paid_date ? formatDisplayDate(exp.paid_date) : "\u2014"}
                      </Table.Td>
                      <Table.Td>
                        {exp.receipt_path ? (
                          <div className="flex items-center gap-2">
                            <Tooltip content={t.preview_receipt}>
                              <Button
                                variant="link"
                                icon={ICONS.preview}
                                onClick={() => setPreview({ path: exp.receipt_path!, reference: exp.reference })}
                              >
                                {t.view}
                              </Button>
                            </Tooltip>
                            <span className="text-xs text-success-text flex items-center gap-1">
                              <ICONS.attachment size={ICON_SIZE.control} />
                            </span>
                          </div>
                        ) : (
                          <Button
                            variant="link"
                            icon={ICONS.attachment}
                            onClick={() => attachReceipt(exp.id, exp.reference, exp.supplier)}
                          >
                            {t.attach}
                          </Button>
                        )}
                      </Table.Td>
                      <Table.Td numeric className="font-medium">
                        CHF {exp.amount.toFixed(2)}
                      </Table.Td>
                      <Table.Actions>
                        <IconButton size="xs"
                          icon={ICONS.more}
                          label={t.more_actions}
                          onClick={(e) => setCtxMenu({ x: e.clientX, y: e.clientY, item: exp })}
                        />
                      </Table.Actions>
                    </Table.Row>
                  ))}
              </React.Fragment>
            );
          })}
          {filtered.length === 0 && (
            <Table.Empty colSpan={9}>
              {all.length === 0 ? (
                <EmptyState
                  message={t.no_expenses_yet}
                  icon={ICONS.expense}
                  action={<Button icon={ICONS.add} onClick={() => { setPrefill(null); setShowForm(true); }}>{t.new_expense}</Button>}
                />
              ) : (
                <NoResults message={t.no_matching_expenses} onClear={clearFilters} />
              )}
            </Table.Empty>
          )}
        </Table.Body>
      </Table>
      )}
      </QueryState>

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
            ...(!ctxMenu.item.paid_date
              ? [
                  { label: t.mark_as_paid_today, icon: ICONS.markPaid, onClick: () => updateExpense.mutate({ id: ctxMenu.item.id, data: { paid_date: todayLocalISO() } }, { onSuccess: () => notify.success(t.marked_as_paid) }) },
                  { label: t.mark_as_paid_at_invoice_date, icon: CalendarCheck, onClick: () => updateExpense.mutate({ id: ctxMenu.item.id, data: { paid_date: ctxMenu.item.invoice_date } }, { onSuccess: () => notify.success(t.marked_as_paid) }) },
                ]
              : [{ label: t.mark_as_unpaid, icon: ICONS.markUnpaid, onClick: () => updateExpense.mutate({ id: ctxMenu.item.id, data: { paid_date: null } }, { onSuccess: () => notify.success(t.marked_as_unpaid) }) }]),
            { label: t.edit_paid_date, icon: ICONS.edit, onClick: () => { setEditDateValue(ctxMenu.item.paid_date ?? format(new Date(), "yyyy-MM-dd")); setEditDateExpense(ctxMenu.item); } },
            { label: t.delete, icon: ICONS.delete, danger: true, onClick: () => deleteWithUndo(deleteExpense, ctxMenu.item.id, t.toast_expense_deleted) },
          ]}
        />
      )}
      <FormModal
        open={!!editDateExpense}
        onClose={() => setEditDateExpense(null)}
        title={t.edit_paid_date}
        size="sm"
        submitLabel={t.save}
        onSubmit={saveEditDate}
        submitting={updateExpense.isPending}
      >
        <FormField label={t.date}>
          <DatePicker
            fullWidth
            value={editDateValue || null}
            onChange={(v) => setEditDateValue(v ?? "")}
            autoFocus
          />
        </FormField>
      </FormModal>
      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clearSelection}
        actions={[
          { label: t.delete, icon: ICONS.delete, onClick: bulkDelete, danger: true },
        ]}
      />
    </div>
  );
}

// Phase 2 E3 — inline validation (E1 pattern). category_code is a Select that
// always holds a valid value (defaulted, never empty), so it is not validated.
type ExpenseFormField = "supplier" | "amount" | "invoice_date";

const expenseSchema: v.FormSchema<ExpenseFormField> = {
  supplier: [v.required],
  amount: [v.required, v.numberPositive],
  invoice_date: [v.required, v.dateValid],
};

/** Fields the receipt parser can prefill — tracked for "from receipt" badges. */
type DetectableExpenseField = "supplier" | "invoice_date" | "amount";

function detectedFields(
  prefill: ExtractedExpenseData | null | undefined
): Set<DetectableExpenseField> {
  const s = new Set<DetectableExpenseField>();
  if (prefill?.supplier) s.add("supplier");
  if (prefill?.invoice_date) s.add("invoice_date");
  if (prefill?.amount) s.add("amount");
  return s;
}

export function NewExpenseForm({
  categories,
  pastSuppliers,
  prefill,
  title,
  submitting,
  onSave,
  onCancel,
}: {
  categories: { code: string; name_fr: string }[];
  pastSuppliers: { supplier: string; category_code: string; amount: number }[];
  prefill: (ExtractedExpenseData & { receiptPath?: string }) | null;
  /** The dialog title; "New expense" by default. */
  title?: string;
  /** The save is running (spinner, no second submit). */
  submitting?: boolean;
  onSave: (data: {
    supplier: string;
    category_code: string;
    invoice_date: string;
    due_date: string | null;
    amount: number;
    paid_date: string | null;
    receipt_path: string | null;
    notes: string;
  }) => void | Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState(() => {
    let categoryCode = categories[0]?.code ?? "FA";
    let amount = 0;
    if (prefill?.supplier && pastSuppliers.length > 0) {
      const match = pastSuppliers.find(
        (s) => s.supplier.trim().toLowerCase() === prefill.supplier!.trim().toLowerCase()
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
  const [errors, setErrors] = useState<Partial<Record<ExpenseFormField, string>>>({});
  const { undetect, resetDetected, detectedBadge, isDetected } =
    useDetectedFields<DetectableExpenseField>(() => detectedFields(prefill));

  const setFieldError = (field: ExpenseFormField, msg: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[field] = msg;
      else delete next[field];
      return next;
    });

  // Raw string value per validated field; amount is held as a number in form
  // state and renders as "" while zero, so validate what the user sees.
  const fieldValue = (field: ExpenseFormField): string =>
    field === "amount" ? (form.amount ? String(form.amount) : "") : form[field];

  const validateOnBlur = (field: ExpenseFormField) =>
    setFieldError(field, v.validateField(fieldValue(field), expenseSchema[field]));

  const clearError = (field: ExpenseFormField) => setFieldError(field, null);

  // Sync prefill into form when it changes (e.g. new file dropped while form is open)
  useEffect(() => {
    if (!prefill) return;
    let categoryCode = categories[0]?.code ?? "FA";
    let amount = 0;
    if (prefill.supplier && pastSuppliers.length > 0) {
      const match = pastSuppliers.find(
        (s) => s.supplier.trim().toLowerCase() === prefill.supplier!.trim().toLowerCase()
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
    // OCR prefill overwrites the whole form programmatically — any stale
    // inline errors no longer describe what is on screen, so clear them all.
    setErrors({});
    resetDetected(detectedFields(prefill));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only when a new prefill arrives; adding categories/pastSuppliers would clobber user edits when those queries refetch
  }, [prefill]);

  const [showSuggestions, setShowSuggestions] = useState(false);
  // Set on suggestion mousedown (which fires before the input's blur) so the
  // blur handler does not validate the stale pre-selection supplier value.
  const pickingSuggestionRef = useRef(false);
  const focusedOnceRef = useRef(false);
  const supplierInputRef = useRef<HTMLInputElement>(null);
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
    // Programmatic fill — stale errors on the filled fields no longer apply.
    clearError("supplier");
    clearError("amount");
    // Picking a suggestion is a deliberate user choice, not a detection.
    undetect("supplier");
    undetect("amount");
  };

  const submit = () => {
    const errs = v.validateForm(
      { supplier: form.supplier, amount: fieldValue("amount"), invoice_date: form.invoice_date },
      expenseSchema
    );
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    // DB failures surface via the mutation's onError toast (backstop).
    // Returned so FormModal ignores a second submit while it runs.
    return onSave({
      ...form,
      due_date: prefill?.due_date ?? null,
      paid_date: null,
      receipt_path: null,
    });
  };

  return (
    <FormModal
      open
      onClose={onCancel}
      title={title ?? t.new_expense}
      submitLabel={t.save}
      onSubmit={submit}
      submitting={submitting}
      // Filled from a dropped receipt: a stray backdrop click would lose the scan.
      dirty={prefill?.receiptPath ? true : undefined}
    >
      {prefill?.receiptPath && <ReceiptNote path={prefill.receiptPath} />}
      <FormGrid cols={2}>
        <div className="relative">
          <FormField
            label={t.supplier}
            required
            error={errors.supplier}
            badge={detectedBadge("supplier", () => setForm((f) => ({ ...f, supplier: "" })))}
          >
            <Input
              ref={supplierInputRef}
              value={form.supplier}
              onChange={(e) => {
                setForm({ ...form, supplier: e.target.value });
                setShowSuggestions(true);
                clearError("supplier");
                undetect("supplier");
              }}
              autoFocus
              // Not on the autoFocus when the dialog opens: the list would cover the form.
              onFocus={() => {
                if (focusedOnceRef.current) setShowSuggestions(true);
                focusedOnceRef.current = true;
              }}
              // Suggestions are mouse-only, so Enter submits the form; close them first.
              onKeyDown={(e) => { if (e.key === "Enter") setShowSuggestions(false); }}
              onBlur={() => {
                setTimeout(() => setShowSuggestions(false), 200);
                if (!pickingSuggestionRef.current) validateOnBlur("supplier");
                pickingSuggestionRef.current = false;
              }}
              detected={isDetected("supplier")}
              autoComplete="off"
            />
          </FormField>
          {showSuggestions && suggestions.length > 0 && (
            <Popover
              anchor={supplierInputRef}
              onClose={() => setShowSuggestions(false)}
              autoFocus={false}
              role="group"
              aria-label={t.supplier}
              matchWidth
              padding="menu"
              className="max-h-48 overflow-y-auto"
            >
              {suggestions.map((s) => (
                <button
                  key={s.supplier}
                  type="button"
                  onMouseDown={() => {
                    pickingSuggestionRef.current = true;
                    selectSupplier(s);
                  }}
                  className={`${MENU_ITEM} justify-between cursor-pointer hover:bg-[var(--color-hover-row)]`}
                >
                  <span>{s.supplier}</span>
                  <span className="text-xs text-muted">
                    {s.category_code} / CHF {s.amount.toFixed(2)}
                  </span>
                </button>
              ))}
            </Popover>
          )}
        </div>
        <FormField label={t.category}>
          <Select
            value={form.category_code}
            onChange={(e) => setForm({ ...form, category_code: e.target.value })}
          >
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} - {c.name_fr}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label={t.date}
          required
          error={errors.invoice_date}
          badge={detectedBadge("invoice_date", () =>
            setForm((f) => ({ ...f, invoice_date: format(new Date(), "yyyy-MM-dd") }))
          )}
        >
          <DatePicker
            value={form.invoice_date || null}
            onChange={(v) => {
              setForm({ ...form, invoice_date: v ?? "" });
              clearError("invoice_date");
              undetect("invoice_date");
            }}
            onBlur={() => validateOnBlur("invoice_date")}
            detected={isDetected("invoice_date")}
          />
        </FormField>
        <FormField
          label={t.amount}
          required
          error={errors.amount}
          badge={detectedBadge("amount", () => setForm((f) => ({ ...f, amount: 0 })))}
        >
          <Input
            numeric
            step="0.01"
            unit="CHF"
            value={form.amount || ""}
            onChange={(e) => {
              setForm({ ...form, amount: Number(e.target.value) });
              clearError("amount");
              undetect("amount");
            }}
            onBlur={() => {
              checkForDuplicates();
              validateOnBlur("amount");
            }}
            detected={isDetected("amount")}
          />
        </FormField>
      </FormGrid>
      {duplicateWarning && (
        <Callout tone="warning">
          <span className="font-medium">{t.possible_duplicate}:</span>{" "}
          {duplicateWarning.supplier} — {duplicateWarning.amount.toFixed(2)} CHF ({formatDisplayDate(duplicateWarning.date)})
        </Callout>
      )}
    </FormModal>
  );
}
