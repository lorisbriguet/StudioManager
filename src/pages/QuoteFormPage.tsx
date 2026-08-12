import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye } from "lucide-react";
import { Button, Input, Select, FormField } from "../components/ui";
import * as v from "../lib/validate";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { useQuote, useCreateQuote, useUpdateQuote } from "../db/hooks/useQuotes";
import { useInvoiceTemplates, useDefaultTemplate } from "../db/hooks/useInvoiceTemplates";
import { useClients, useClientAddresses } from "../db/hooks/useClients";
import { useProjects } from "../db/hooks/useProjects";
import { getQuoteLineItems } from "../db/queries/quotes";
import { logError } from "../lib/log";
import { useT } from "../i18n/useT";
import { useActivities } from "../db/hooks/useActivities";
import type { Activity } from "../types/activity";
import { makeLineItem, useLineItemForm, toPersistedLineItems, unitShortLabel, round2 } from "../lib/lineItems";
import { LineItemsTable } from "../components/shared/LineItemsTable";
import { useUnsavedChangesWarning } from "../hooks/useUnsavedChangesWarning";
import { confirmIfDirty } from "../lib/dirty-guard";

// Phase 2 E2 — inline validation (additive; only fields with rules appear in
// the schema, the rest are unvalidated). "line_items" has no schema rules —
// it is a region-level check performed in save() (at least one line with a
// description and an amount) whose message renders under LineItemsTable.
type QuoteField = "client_id" | "quote_date" | "line_items";

const quoteSchema: v.FormSchema<QuoteField> = {
  client_id: [v.required],
  quote_date: [v.required, v.dateValid],
};

export function QuoteFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const quoteId = Number(id);
  const navigate = useNavigate();

  const t = useT();
  const { data: existingQuote } = useQuote(isEdit ? quoteId : 0);
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { data: activityList } = useActivities();
  const createQuote = useCreateQuote();
  const updateQuote = useUpdateQuote();

  // Track whether the user has made any changes to the form
  const [formDirty, setFormDirty] = useState(false);
  const formLoadedRef = useRef(false);
  const markDirty = useCallback(() => {
    if (formLoadedRef.current) setFormDirty(true);
  }, []);
  useUnsavedChangesWarning(formDirty);

  // Phase 2 E2 — field errors (blur -> validate, change -> clear, submit -> block)
  const [errors, setErrors] = useState<Partial<Record<QuoteField, string>>>({});
  const setFieldError = (field: QuoteField, msg: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[field] = msg;
      else delete next[field];
      return next;
    });
  const clearError = (field: QuoteField) => setFieldError(field, null);

  const { data: invoiceTemplates } = useInvoiceTemplates();
  const { data: defaultTemplate } = useDefaultTemplate();
  const [templateId, setTemplateId] = useState<number | null>(null);

  const [clientId, setClientId] = useState("");
  const [billingAddressId, setBillingAddressId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [quoteDate, setQuoteDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [activity, setActivity] = useState("");
  const [activityId, setActivityId] = useState<number | null>(null);
  const [assignment, setAssignment] = useState("");
  const [notes, setNotes] = useState("");
  const [discountRate, setDiscountRate] = useState(0);

  const {
    items, setItems, sensors, lineItemIds, handleDragEnd,
    addItem: _addItemBase, removeItem, updateItem,
  } = useLineItemForm();
  void _addItemBase;

  const [useGlobalRate, setUseGlobalRate] = useState(false);
  const [globalRate, setGlobalRate] = useState<number>(0);
  const [globalUnit, setGlobalUnit] = useState<string>("hours");
  const globalRateRef = useRef<number>(0);
  globalRateRef.current = globalRate;
  const useGlobalRateRef = useRef(false);
  useGlobalRateRef.current = useGlobalRate;
  const globalUnitRef = useRef<string>("hours");
  globalUnitRef.current = globalUnit;

  const addItem = useCallback(() => {
    const rate = useGlobalRateRef.current ? globalRateRef.current : null;
    const unit = useGlobalRateRef.current ? globalUnitRef.current : null;
    setItems((prev) => [...prev, makeLineItem({ rate, unit, amount: rate ? round2(rate * 1) : 0 })]);
  }, [setItems]);

  const applyGlobalRate = useCallback((rate: number, unit?: string) => {
    const u = unit ?? globalUnitRef.current;
    setItems((prev) => prev.map((item) => ({
      ...item,
      rate,
      unit: u,
      amount: round2(rate * item.quantity),
    })));
  }, [setItems]);

  useEffect(() => {
    if (existingQuote) {
      formLoadedRef.current = false;
      setClientId(existingQuote.client_id);
      setBillingAddressId(existingQuote.billing_address_id);
      setProjectId(existingQuote.project_id);
      setQuoteDate(existingQuote.quote_date);
      setActivity(existingQuote.activity);
      setActivityId(existingQuote.activity_id ?? null);
      setAssignment(existingQuote.assignment);
      setNotes(existingQuote.notes);
      setDiscountRate(existingQuote.discount_rate ?? 0);
      getQuoteLineItems(quoteId).then((lineItems) => {
        if (lineItems.length > 0) {
          setItems(
            lineItems.map((li) => makeLineItem({
              designation: li.designation,
              rate: li.rate,
              unit: li.unit,
              quantity: li.quantity,
              amount: li.amount,
            }))
          );
        }
      }).catch((e) => {
        logError("Failed to load line items:", e);
        toast.error(t.failed_load_line_items);
      }).finally(() => {
        setTimeout(() => { formLoadedRef.current = true; }, 0);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate-once per loaded quote; adding t.* would re-hydrate (and clobber edits) on locale switch. setItems is a stable setState.
  }, [existingQuote, quoteId]);

  // Default activity for new quotes
  useEffect(() => {
    if (!isEdit && !activity && activityId === null && activityList && activityList.length > 0) {
      setActivityId(activityList[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default-fill only when activities load; adding `activity`/`activityId` would re-fill after the user clears the field
  }, [activityList, isEdit]);

  // Pre-select default template for new quotes
  useEffect(() => {
    if (!isEdit && !templateId && defaultTemplate) {
      setTemplateId(defaultTemplate.id);
    }
  }, [defaultTemplate, isEdit, templateId]);

  // Load template_id from existing quote
  useEffect(() => {
    if (existingQuote && "template_id" in existingQuote) {
      setTemplateId((existingQuote as { template_id?: number | null }).template_id ?? null);
    }
  }, [existingQuote]);

  // Arm dirty tracking for new quotes (no existing data to load)
  useEffect(() => {
    if (!isEdit) {
      setTimeout(() => { formLoadedRef.current = true; }, 0);
    }
  }, [isEdit]);

  const selectedClient = clients?.find((c) => c.id === clientId);
  const quoteLang: "FR" | "EN" = selectedClient?.language ?? "FR";
  const activityName = (a: Activity) => (quoteLang === "FR" ? a.name_fr : a.name_en);
  // Newly computed money values are rounded at every boundary — these are
  // what save() persists.
  const subtotal = round2(items.reduce((sum, i) => sum + i.amount, 0));
  const discountAmount = round2(subtotal * discountRate);
  const total = round2(subtotal - discountAmount);

  const { data: clientAddresses } = useClientAddresses(clientId);
  const clientProjects = projects?.filter((p) => p.client_id === clientId);

  // Auto-select address when client has exactly one
  useEffect(() => {
    if (clientAddresses && clientAddresses.length === 1 && !billingAddressId) {
      setBillingAddressId(clientAddresses[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot auto-select when the address list loads; adding billingAddressId would re-select right after the user deselects
  }, [clientAddresses]);

  const save = async () => {
    // Phase 2 E2 — field-level validation replaces the old toast branches
    // (toasts remain the backstop for DB failures via onError below).
    const errs = v.validateForm<QuoteField>(
      { client_id: clientId, quote_date: quoteDate },
      quoteSchema
    );
    // Region-level line-items rule: at least one line that actually bills
    // something — a description plus a non-zero amount (amount covers both
    // rate*quantity and the direct flat-amount entry the table supports).
    if (!items.some((i) => i.designation.trim() && i.amount > 0)) {
      errs.line_items = t.line_items_required;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    // On edit, keep the stored validity date unless the quote date was changed.
    const validUntil =
      isEdit && existingQuote?.valid_until && quoteDate === existingQuote.quote_date
        ? existingQuote.valid_until
        : format(addDays(new Date(quoteDate), 30), "yyyy-MM-dd");
    const lineItems = toPersistedLineItems(items);

    try {
      if (isEdit) {
        updateQuote.mutate(
          {
            id: quoteId,
            data: {
              client_id: clientId,
              project_id: projectId,
              billing_address_id: billingAddressId,
              language: selectedClient?.language ?? "FR",
              ...(() => {
                const selected = activityId !== null ? activityList?.find((a) => a.id === activityId) : undefined;
                return {
                  activity: (selected ? activityName(selected) : activity).trim(),
                  activity_id: selected ? selected.id : null,
                };
              })(),
              assignment,
              quote_date: quoteDate,
              valid_until: validUntil,
              subtotal,
              discount_applied: discountRate > 0 ? 1 : 0,
              discount_rate: discountRate,
              total,
              notes,
              template_id: templateId,
            },
            lineItems,
          },
          {
            onSuccess: () => {
              setFormDirty(false);
              toast.success(t.quote_updated);
              navigate("/quotes");
            },
            onError: (e) => toast.error(String(e)),
          }
        );
      } else {
        const reference = `DRAFT-${crypto.randomUUID()}`;
        createQuote.mutate(
          {
            data: {
              reference,
              client_id: clientId,
              project_id: projectId,
              billing_address_id: billingAddressId,
              status: "draft",
              language: selectedClient?.language ?? "FR",
              ...(() => {
                const selected = activityId !== null ? activityList?.find((a) => a.id === activityId) : undefined;
                return {
                  activity: (selected ? activityName(selected) : activity).trim(),
                  activity_id: selected ? selected.id : null,
                };
              })(),
              assignment,
              quote_date: quoteDate,
              valid_until: validUntil,
              subtotal,
              discount_applied: discountRate > 0 ? 1 : 0,
              discount_rate: discountRate,
              total,
              converted_to_invoice_id: null,
              converted_to_project_id: null,
              notes,
              template_id: templateId,
            },
            lineItems,
          },
          {
            onSuccess: () => {
              setFormDirty(false);
              toast.success(t.quote_created);
              navigate("/quotes");
            },
            onError: (e) => toast.error(String(e)),
          }
        );
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={async () => { if (await confirmIfDirty("/quotes")) navigate("/quotes"); }} icon={<ArrowLeft size={18} />} aria-label={t.back} />
        <h1 className="text-xl font-semibold">
          {isEdit ? t.edit_quote : t.new_quote}
        </h1>
      </div>

      <div className="space-y-4 max-w-3xl" onChange={markDirty} onInput={markDirty}>
        {/* Template selector */}
        {invoiceTemplates && invoiceTemplates.length > 0 && (
          <div className="max-w-xs">
            <label className="block text-xs font-medium text-muted mb-1">
              {t.select_invoice_template}
            </label>
            <Select
              value={templateId ?? ""}
              onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)}
              className="py-2"
            >
              <option value="">{t.none}</option>
              {invoiceTemplates.map((tmpl) => (
                <option key={tmpl.id} value={tmpl.id}>
                  {tmpl.name}{tmpl.is_default ? " (default)" : ""}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t.client} required error={errors.client_id}>
            <Select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setBillingAddressId(null);
                setProjectId(null);
                // User picked a (new) client: derive discount from that client
                const newClient = clients?.find((c) => c.id === e.target.value);
                setDiscountRate(newClient?.has_discount ? newClient.discount_rate : 0);
                clearError("client_id");
              }}
              onBlur={() => setFieldError("client_id", v.validateField(clientId, quoteSchema.client_id))}
              className="py-2"
            >
              <option value="">{t.select_client}</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </FormField>
          {clientId && (
            <FormField label={t.billing_address}>
              <Select
                value={billingAddressId ?? ""}
                onChange={(e) => setBillingAddressId(e.target.value ? Number(e.target.value) : null)}
                className="py-2"
              >
                <option value="">{t.main_address}</option>
                {clientAddresses?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}{a.billing_name ? ` — ${a.billing_name}` : ""}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          <FormField label={t.project_optional}>
            <Select
              value={projectId ?? ""}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
              className="py-2"
            >
              <option value="">{t.none}</option>
              {clientProjects?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.date} required error={errors.quote_date}>
            <Input
              type="date"
              value={quoteDate}
              onChange={(e) => { setQuoteDate(e.target.value); clearError("quote_date"); }}
              onBlur={() => setFieldError("quote_date", v.validateField(quoteDate, quoteSchema.quote_date))}
              className="py-2"
            />
          </FormField>
          <FormField label={t.activity}>
            <Select
              value={activityId !== null ? String(activityId) : activity ? "legacy" : ""}
              onChange={(e) => {
                setActivityId(e.target.value === "legacy" || e.target.value === "" ? null : Number(e.target.value));
              }}
              className="py-2"
            >
              {(activityList ?? []).map((a) => (
                <option key={a.id} value={String(a.id)}>{activityName(a)}</option>
              ))}
              {activityId === null && activity && (
                <option value="legacy">{activity}</option>
              )}
              {activityId === null && !activity && <option value="" />}
            </Select>
          </FormField>
          <FormField label={t.assignment} className="col-span-2">
            <Input
              value={assignment}
              onChange={(e) => setAssignment(e.target.value)}
              className="py-2"
              placeholder={t.description_work}
            />
          </FormField>
        </div>

        {/* Global rate toggle */}
        <div className="flex items-center gap-3 mb-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={useGlobalRate}
              onChange={(e) => {
                setUseGlobalRate(e.target.checked);
                if (e.target.checked && globalRate > 0) {
                  applyGlobalRate(globalRate);
                }
              }}
              className="accent-[var(--accent)]"
            />
            {t.apply_global_rate}
          </label>
          {useGlobalRate && (
            <>
              <Input
                type="number"
                value={globalRate || ""}
                onChange={(e) => {
                  const rate = e.target.value ? Number(e.target.value) : 0;
                  setGlobalRate(rate);
                  applyGlobalRate(rate);
                }}
                placeholder={t.global_rate}
                fullWidth={false}
                className="w-28 text-right"
              />
              <select
                value={globalUnit}
                onChange={(e) => {
                  setGlobalUnit(e.target.value);
                  if (globalRate > 0) applyGlobalRate(globalRate, e.target.value);
                }}
                className="border border-[var(--color-border-divider)] rounded-lg px-2 py-1.5 text-sm bg-[var(--color-surface)]"
              >
                <option value="hours">{t.hours}</option>
                <option value="days">{t.days}</option>
                <option value="units">{t.units}</option>
                <option value="flat">{t.flat_rate}</option>
              </select>
            </>
          )}
        </div>

        <LineItemsTable
          items={items}
          lineItemIds={lineItemIds}
          sensors={sensors}
          onDragEnd={(...a) => { handleDragEnd(...a); markDirty(); }}
          onAdd={() => { addItem(); markDirty(); clearError("line_items"); }}
          onRemove={(...a) => { removeItem(...a); markDirty(); clearError("line_items"); }}
          onUpdate={(...a) => { updateItem(...a); markDirty(); clearError("line_items"); }}
          subtotal={subtotal}
          discountRate={discountRate}
          discountAmount={discountAmount}
          total={total}
          hideRate={useGlobalRate}
          globalRateLabel={useGlobalRate && globalRate > 0 ? t.all_items_at_rate.replace("{rate}", String(globalRate)).replace("{currency}", "CHF").replace("{unit}", unitShortLabel(globalUnit)) : undefined}
        />

        {/* Phase 2 E2 — summary error for the line-items region (not per-cell) */}
        {errors.line_items && (
          <p role="alert" className="text-xs text-danger-text">
            {errors.line_items}
          </p>
        )}

        <FormField label={t.notes}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full border border-[var(--color-border-divider)] rounded-lg px-3 py-2 text-sm bg-[var(--color-surface)]"
          />
        </FormField>

        <div className="flex gap-2">
          <Button
            size="lg"
            onClick={save}
            disabled={createQuote.isPending || updateQuote.isPending}
          >
            {isEdit ? t.update_quote : t.create_quote}
          </Button>
          {isEdit && (
            <Button
              variant="secondary"
              size="lg"
              icon={<Eye size={14} />}
              // Preview renders the SAVED quote, so unsaved edits would be
              // silently dropped — prompt as a stopgap. Proper phase-2 fix:
              // save-then-preview.
              onClick={async () => {
                if (await confirmIfDirty(`/quotes/${quoteId}/preview`)) navigate(`/quotes/${quoteId}/preview`);
              }}
            >
              {t.preview}
            </Button>
          )}
          <Button
            variant="secondary"
            size="lg"
            onClick={async () => {
              if (await confirmIfDirty("/quotes")) navigate("/quotes");
            }}
          >
            {t.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}
