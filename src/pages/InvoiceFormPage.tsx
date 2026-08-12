import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ListTodo, Trash2, ArrowLeft } from "lucide-react";
import { Button, Input, Select, FormField } from "../components/ui";
import * as v from "../lib/validate";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { useT } from "../i18n/useT";
import { useInvoice, useCreateInvoice, useUpdateInvoice, useDeleteInvoice } from "../db/hooks/useInvoices";
import { useInvoiceTemplates, useDefaultTemplate } from "../db/hooks/useInvoiceTemplates";
import { useQueryClient } from "@tanstack/react-query";
import { useClients, useClientContacts, useClientAddresses } from "../db/hooks/useClients";
import { useProjectsByClient } from "../db/hooks/useProjects";
import { useTasksByProject } from "../db/hooks/useTasks";
import { getInvoiceLineItems } from "../db/queries/invoices";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { parseActivities } from "../types/business-profile";
import { getQuote, getQuoteLineItems, updateQuote } from "../db/queries/quotes";
import { logError } from "../lib/log";
import { makeLineItem, useLineItemForm, toPersistedLineItems, unitShortLabel, round2 } from "../lib/lineItems";
import { LineItemsTable } from "../components/shared/LineItemsTable";
import { currencies, getExchangeRate, toCHF, type Currency } from "../lib/exchangeRate";
import { useTabStore } from "../stores/tab-store";
import { useUnsavedChangesWarning } from "../hooks/useUnsavedChangesWarning";
import { confirmIfDirty } from "../lib/dirty-guard";

// Phase 2 E2 — inline validation (additive; only fields with rules appear in
// the schema, the rest are unvalidated). "line_items" has no schema rules —
// it is a region-level check performed in save() (at least one line with a
// description and an amount) whose message renders under LineItemsTable.
// chf_equivalent is validated only while its input exists (currency !== CHF):
// save() simply omits the value for CHF, and numberPositive passes empty.
type InvoiceField = "client_id" | "invoice_date" | "chf_equivalent" | "line_items";

const invoiceSchema: v.FormSchema<InvoiceField> = {
  client_id: [v.required],
  invoice_date: [v.required, v.dateValid],
  chf_equivalent: [v.numberPositive],
};

export function InvoiceFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const invoiceId = Number(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromQuoteId = Number(searchParams.get("from_quote")) || null;

  const t = useT();
  const updateActiveTab = useTabStore((s) => s.updateActiveTab);
  const { data: existingInvoice } = useInvoice(isEdit ? invoiceId : 0);
  const { data: clients } = useClients();
  const { data: profile } = useBusinessProfile();
  const profileActivities = useMemo(() => parseActivities(profile?.default_activity), [profile?.default_activity]);
  const createInvoice = useCreateInvoice();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const queryClient = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Track whether the user has made any changes to the form
  const [formDirty, setFormDirty] = useState(false);
  const formLoadedRef = useRef(false);
  const markDirty = useCallback(() => {
    if (formLoadedRef.current) setFormDirty(true);
  }, []);
  useUnsavedChangesWarning(formDirty);

  // Phase 2 E2 — field errors (blur -> validate, change -> clear, submit -> block)
  const [errors, setErrors] = useState<Partial<Record<InvoiceField, string>>>({});
  const setFieldError = (field: InvoiceField, msg: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[field] = msg;
      else delete next[field];
      return next;
    });
  const clearError = (field: InvoiceField) => setFieldError(field, null);

  const { data: invoiceTemplates } = useInvoiceTemplates();
  const { data: defaultTemplate } = useDefaultTemplate();
  const [templateId, setTemplateId] = useState<number | null>(null);

  const [clientId, setClientId] = useState("");
  const [contactId, setContactId] = useState<number | null>(null);
  const [billingAddressId, setBillingAddressId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [activity, setActivity] = useState("");
  const [assignment, setAssignment] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState<Currency>("CHF");
  const [exchangeRate, setExchangeRate] = useState(1);
  const [chfManualOverride, setChfManualOverride] = useState(false);
  const [chfEquivalent, setChfEquivalent] = useState(0);
  const [discountRate, setDiscountRate] = useState(0);
  // Snapshot of the loaded invoice's stored money facts. While `currency`
  // matches this snapshot, the [currency] effect re-asserts the stored
  // exchange_rate/chf_equivalent instead of fetching today's rate — editing
  // an old invoice must never rewrite its historical financials.
  const loadedInvoiceRef = useRef<{
    currency: Currency;
    exchange_rate: number;
    chf_equivalent: number;
  } | null>(null);

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
    if (existingInvoice) {
      formLoadedRef.current = false;
      // Single source for the stored money facts: the ref (used by the
      // currency/auto-calc effects) and the hydration setters below must agree.
      const snapshot = {
        currency: (existingInvoice.currency ?? "CHF") as Currency,
        exchange_rate: existingInvoice.exchange_rate ?? 1,
        chf_equivalent: existingInvoice.chf_equivalent ?? existingInvoice.total,
      };
      loadedInvoiceRef.current = snapshot;
      setClientId(existingInvoice.client_id);
      setContactId(existingInvoice.contact_id);
      setBillingAddressId(existingInvoice.billing_address_id);
      setProjectId(existingInvoice.project_id);
      setInvoiceDate(existingInvoice.invoice_date);
      setActivity(existingInvoice.activity);
      setAssignment(existingInvoice.assignment);
      setPoNumber(existingInvoice.po_number ?? "");
      setNotes(existingInvoice.notes);
      setCurrency(snapshot.currency);
      setExchangeRate(snapshot.exchange_rate);
      setChfEquivalent(snapshot.chf_equivalent);
      setDiscountRate(existingInvoice.discount_rate ?? 0);
      if (existingInvoice.currency && existingInvoice.currency !== "CHF") {
        setChfManualOverride(true); // preserve user's manually set CHF equivalent
      }
      getInvoiceLineItems(invoiceId).then((lineItems) => {
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
        // Allow a tick for React to settle before arming dirty tracking
        setTimeout(() => { formLoadedRef.current = true; }, 0);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate-once per loaded invoice; adding t.* would re-hydrate (and clobber edits) on locale switch. setItems is a stable setState.
  }, [existingInvoice, invoiceId]);

  // Update tab label with invoice reference
  useEffect(() => {
    if (isEdit && existingInvoice?.reference) {
      const label = existingInvoice.reference.startsWith("DRAFT") ? t.draft : existingInvoice.reference;
      updateActiveTab(`/invoices/${invoiceId}/edit`, label);
    }
  }, [existingInvoice?.reference, isEdit, invoiceId, t.draft, updateActiveTab]);

  // Default activity from profile for new invoices
  useEffect(() => {
    if (!isEdit && !activity && !fromQuoteId && profileActivities.length > 0) {
      setActivity(profileActivities[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default-fill only when the profile loads; adding `activity` would re-fill the default after the user clears the field
  }, [profileActivities, isEdit, fromQuoteId]);

  // Pre-select default template for new invoices
  useEffect(() => {
    if (!isEdit && !templateId && defaultTemplate) {
      setTemplateId(defaultTemplate.id);
    }
  }, [defaultTemplate, isEdit, templateId]);

  // Load template_id from existing invoice
  useEffect(() => {
    if (existingInvoice && "template_id" in existingInvoice) {
      setTemplateId((existingInvoice as { template_id?: number | null }).template_id ?? null);
    }
  }, [existingInvoice]);

  // Arm dirty tracking for new invoices (no existing data to load)
  useEffect(() => {
    if (!isEdit && !fromQuoteId) {
      setTimeout(() => { formLoadedRef.current = true; }, 0);
    }
  }, [isEdit, fromQuoteId]);

  // Pre-fill from quote when converting
  useEffect(() => {
    if (!fromQuoteId || isEdit) return;
    formLoadedRef.current = false;
    (async () => {
      const quote = await getQuote(fromQuoteId);
      if (!quote) return;
      setClientId(quote.client_id);
      setProjectId(quote.project_id);
      setBillingAddressId(quote.billing_address_id ?? null);
      setActivity(quote.activity);
      setAssignment(quote.assignment);
      setNotes(quote.notes);
      // Carry over the discount agreed on the quote, not the client's current setting
      setDiscountRate(quote.discount_rate ?? 0);
      const lineItems = await getQuoteLineItems(fromQuoteId);
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
      setTimeout(() => { formLoadedRef.current = true; }, 0);
    })().catch((e) => {
      logError("Failed to load quote:", e);
      toast.error(t.failed_load_line_items);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pre-fill once per source quote; adding t.* would re-run the pre-fill (and clobber edits) on locale switch. setItems is a stable setState.
  }, [fromQuoteId, isEdit]);

  const selectedClient = clients?.find((c) => c.id === clientId);
  // Newly computed money values are rounded at every boundary — these are
  // what save() persists, and invoices are legal documents.
  const subtotal = round2(items.reduce((sum, i) => sum + i.amount, 0));
  const discountAmount = round2(subtotal * discountRate);
  const total = round2(subtotal - discountAmount);

  // Auto-fetch exchange rate when currency changes
  useEffect(() => {
    const loaded = loadedInvoiceRef.current;
    if (loaded && currency === loaded.currency) {
      // Editing an invoice in its stored currency: exchange_rate and
      // chf_equivalent are historical facts captured at invoice time —
      // re-assert them instead of fetching today's rate. (Re-asserting, not
      // just returning, also repairs the mount ordering where this effect
      // ran with the pre-hydration currency and clobbered the stored rate.)
      setExchangeRate(loaded.exchange_rate);
      if (loaded.currency !== "CHF") {
        setChfEquivalent(loaded.chf_equivalent);
        setChfManualOverride(true);
      } else {
        setChfManualOverride(false);
      }
      return;
    }
    if (currency === "CHF") {
      setExchangeRate(1);
      setChfManualOverride(false);
      return;
    }
    let cancelled = false;
    getExchangeRate(currency).then((rate) => {
      if (cancelled) return;
      if (rate === null) {
        // No trustworthy live rate (offline / API down). Never book the
        // face value as CHF: zero the equivalent so a wrong figure is
        // impossible to miss, and force manual mode so the auto-calc
        // effect cannot recompute it from a stale exchangeRate. Also zero
        // exchangeRate itself so the persisted exchange_rate metadata is
        // as loud as the UI (it could otherwise hold 1 or a stale
        // different-currency rate); safe because override is on, so the
        // auto-calc effect never divides by it.
        toast.error(t.exchange_rate_unavailable);
        setExchangeRate(0);
        setChfEquivalent(0);
        setChfManualOverride(true);
        return;
      }
      setExchangeRate(rate);
      setChfManualOverride(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately runs on currency change only (see comments above); adding t.* would refetch today's rate on locale switch
  }, [currency]);

  // Auto-calc CHF equivalent when total or exchange rate changes (unless manually overridden)
  useEffect(() => {
    const loaded = loadedInvoiceRef.current;
    if (loaded && currency === loaded.currency && currency !== "CHF") {
      // Loaded invoice in its stored foreign currency: chf_equivalent is a
      // historical fact re-asserted by the currency effect that re-asserts
      // stored values — never recompute it here (this effect can re-run in
      // the same flush as that repair with a stale chfManualOverride closure
      // and clobber it).
      return;
    }
    if (!chfManualOverride) {
      setChfEquivalent(currency === "CHF" ? total : toCHF(total, exchangeRate));
    }
  }, [total, exchangeRate, currency, chfManualOverride]);

  const { data: clientContacts } = useClientContacts(clientId);
  const { data: clientAddresses } = useClientAddresses(clientId);
  const { data: clientProjects } = useProjectsByClient(clientId);

  // Auto-select address when client has exactly one
  useEffect(() => {
    if (clientAddresses && clientAddresses.length === 1 && !billingAddressId) {
      setBillingAddressId(clientAddresses[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot auto-select when the address list loads; adding billingAddressId would re-select right after the user deselects
  }, [clientAddresses]);
  const { data: projectTasks } = useTasksByProject(projectId ?? 0);

  const availableTasks = projectTasks ?? [];

  const save = async () => {
    // Phase 2 E2 — field-level validation replaces the old toast branches
    // (toasts remain the backstop for DB failures via onError below).
    const errs = v.validateForm<InvoiceField>(
      {
        client_id: clientId,
        invoice_date: invoiceDate,
        // The CHF-equivalent input only exists for foreign currencies; for
        // CHF the value is omitted so numberPositive passes it as empty.
        ...(currency !== "CHF" ? { chf_equivalent: chfEquivalent } : {}),
      },
      invoiceSchema
    );
    // Region-level line-items rule: at least one line that actually bills
    // something — a description plus a non-zero amount (amount covers both
    // rate*quantity and the direct flat-amount entry the table supports).
    if (!items.some((i) => i.designation.trim() && i.amount > 0)) {
      errs.line_items = t.line_items_required;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    // Payment terms: the invoice's own stored terms on edit, profile default on create.
    const paymentTermsDays =
      existingInvoice?.payment_terms_days || profile?.default_payment_terms_days || 30;
    // On edit, keep the stored due date unless the invoice date was changed.
    const dueDate =
      isEdit && existingInvoice?.due_date && invoiceDate === existingInvoice.invoice_date
        ? existingInvoice.due_date
        : format(addDays(new Date(invoiceDate), paymentTermsDays), "yyyy-MM-dd");
    const lineItems = toPersistedLineItems(items);

    try {
      if (isEdit) {
        updateInvoice.mutate(
          {
            id: invoiceId,
            data: {
              client_id: clientId,
              project_id: projectId,
              contact_id: contactId,
              billing_address_id: billingAddressId,
              language: selectedClient?.language ?? "FR",
              activity,
              assignment,
              invoice_date: invoiceDate,
              due_date: dueDate,
              subtotal,
              discount_applied: discountRate > 0 ? 1 : 0,
              discount_rate: discountRate,
              discount_label: discountRate > 0 ? "Rabais culturel" : "",
              total,
              po_number: poNumber || null,
              notes,
              currency,
              exchange_rate: exchangeRate,
              chf_equivalent: chfEquivalent,
              template_id: templateId,
            },
            lineItems,
          },
          {
            onSuccess: () => {
              setFormDirty(false);
              toast.success(t.invoice_updated);
              navigate("/invoices");
            },
            onError: (e) => toast.error(String(e)),
          }
        );
      } else {
        const reference = `DRAFT-${crypto.randomUUID()}`;
        createInvoice.mutate(
          {
            data: {
              reference,
              client_id: clientId,
              project_id: projectId,
              contact_id: contactId,
              billing_address_id: billingAddressId,
              status: "draft",
              language: selectedClient?.language ?? "FR",
              activity,
              activity_id: null,
              assignment,
              invoice_date: invoiceDate,
              due_date: dueDate,
              payment_terms_days: paymentTermsDays,
              subtotal,
              discount_applied: discountRate > 0 ? 1 : 0,
              discount_rate: discountRate,
              discount_label: discountRate > 0 ? "Rabais culturel" : "",
              total,
              po_number: poNumber || null,
              paid_date: null,
              pdf_path: null,
              from_quote_id: fromQuoteId,
              notes,
              currency,
              exchange_rate: exchangeRate,
              chf_equivalent: chfEquivalent,
              reminder_count: 0,
              last_reminder_date: null,
              template_id: templateId,
            },
            lineItems,
          },
          {
            onSuccess: async (invoiceId) => {
              if (fromQuoteId) {
                await updateQuote(fromQuoteId, { converted_to_invoice_id: invoiceId });
                queryClient.invalidateQueries({ queryKey: ["quotes"] });
              }
              setFormDirty(false);
              toast.success(fromQuoteId ? t.quote_converted : t.invoice_created);
              navigate("/invoices");
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
        <Button variant="ghost" size="sm" onClick={async () => { if (await confirmIfDirty("/invoices")) navigate("/invoices"); }} icon={<ArrowLeft size={18} />} aria-label={t.back} />
        <h1 className="text-xl font-semibold">
          {isEdit ? t.edit_invoice : t.new_invoice}
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
                setContactId(null);
                setBillingAddressId(null);
                setProjectId(null);
                // User picked a (new) client: derive discount from that client
                const newClient = clients?.find((c) => c.id === e.target.value);
                setDiscountRate(newClient?.has_discount ? newClient.discount_rate : 0);
                clearError("client_id");
              }}
              onBlur={() => setFieldError("client_id", v.validateField(clientId, invoiceSchema.client_id))}
            >
              <option value="">{t.select_client}</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.intended_for}>
            <Select
              value={contactId ?? ""}
              onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t.none}</option>
              {clientContacts?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}{c.role ? ` — ${c.role}` : ""}
                </option>
              ))}
            </Select>
          </FormField>
          {clientId && (
            <FormField label={t.billing_address}>
              <Select
                value={billingAddressId ?? ""}
                onChange={(e) => setBillingAddressId(e.target.value ? Number(e.target.value) : null)}
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
            >
              <option value="">{t.none}</option>
              {clientProjects?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.date} required error={errors.invoice_date}>
            <Input
              type="date"
              value={invoiceDate}
              onChange={(e) => { setInvoiceDate(e.target.value); clearError("invoice_date"); }}
              onBlur={() => setFieldError("invoice_date", v.validateField(invoiceDate, invoiceSchema.invoice_date))}
            />
          </FormField>
          <FormField label={t.activity}>
            <Select
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
            >
              {profileActivities.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
              {activity && !profileActivities.includes(activity) && (
                <option value={activity}>{activity}</option>
              )}
            </Select>
          </FormField>
          <FormField label={t.assignment}>
            <Input
              value={assignment}
              onChange={(e) => setAssignment(e.target.value)}
              placeholder={t.description_work}
            />
          </FormField>
          <FormField label={t.po_number}>
            <Input
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="e.g. PO-12345"
            />
          </FormField>
          <FormField label={t.currency}>
            <Select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </FormField>
          {currency !== "CHF" && (
            <FormField label={t.chf_equivalent} error={errors.chf_equivalent}>
              <Input
                type="number"
                step="0.01"
                value={chfEquivalent}
                onChange={(e) => {
                  setChfEquivalent(Number(e.target.value));
                  setChfManualOverride(true);
                  clearError("chf_equivalent");
                }}
                onBlur={() => setFieldError("chf_equivalent", v.validateField(String(chfEquivalent), invoiceSchema.chf_equivalent))}
              />
            </FormField>
          )}
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
          currency={currency}
          hideRate={useGlobalRate}
          globalRateLabel={useGlobalRate && globalRate > 0 ? t.all_items_at_rate.replace("{rate}", String(globalRate)).replace("{currency}", currency).replace("{unit}", unitShortLabel(globalUnit)) : undefined}
          headerActions={
            <div className="flex items-center gap-2">
              {availableTasks.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ListTodo size={14} />}
                  onClick={() => {
                    const existingDesignations = new Set(items.map((i) => i.designation));
                    const newTasks = availableTasks.filter(
                      (tk) => !existingDesignations.has(tk.title)
                    );
                    if (newTasks.length === 0) {
                      toast.info(t.all_tasks_added);
                      return;
                    }
                    const newItems = newTasks.map((tk) => makeLineItem({
                      designation: tk.title,
                    }));
                    const nonEmpty = items.filter((i) => i.designation.trim());
                    setItems(nonEmpty.length > 0 ? [...nonEmpty, ...newItems] : newItems);
                    markDirty();
                    clearError("line_items");
                  }}
                  className="text-accent hover:underline"
                >
                  {t.add_tasks}
                </Button>
              )}
            </div>
          }
          renderDesignation={(item, i) => (
            <DesignationInput
              value={item.designation}
              onChange={(v: string) => { updateItem(i, "designation", v); clearError("line_items"); }}
              tasks={availableTasks}
            />
          )}
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
            disabled={createInvoice.isPending || updateInvoice.isPending}
          >
            {isEdit ? t.update_invoice : t.create_invoice}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={async () => {
              if (await confirmIfDirty("/invoices")) navigate("/invoices");
            }}
          >
            {t.cancel}
          </Button>
          {isEdit && existingInvoice?.status === "draft" && !showDeleteConfirm && (
            <Button
              variant="secondary"
              size="lg"
              icon={<Trash2 size={14} />}
              onClick={() => setShowDeleteConfirm(true)}
              className="ml-auto text-danger border-danger/30 hover:bg-danger/5"
            >
              {t.delete}
            </Button>
          )}
          {showDeleteConfirm && existingInvoice && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-danger">{t.delete} {existingInvoice.reference}?</span>
              <Button
                variant="danger"
                onClick={() => {
                  deleteInvoice.mutate(invoiceId, {
                    onSuccess: () => {
                      setFormDirty(false);
                      toast.success(t.delete + " — " + existingInvoice.reference);
                      navigate("/invoices");
                    },
                    onError: (e) => toast.error(String(e)),
                  });
                }}
              >
                {t.delete}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowDeleteConfirm(false)}
              >
                {t.cancel}
              </Button>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

function DesignationInput({
  value,
  onChange,
  tasks,
}: {
  value: string;
  onChange: (v: string) => void;
  tasks: { title: string }[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = tasks.filter(
    (tk) => tk.title.toLowerCase().includes(value.toLowerCase()) && tk.title !== value
  );

  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        className="w-full border border-[var(--color-border-divider)] rounded-lg px-2 py-1.5 text-sm"
        placeholder={t.description}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-[var(--color-surface)] border border-[var(--color-border-divider)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {filtered.map((tk, idx) => (
            <button
              key={`${tk.title}-${idx}`}
              type="button"
              onClick={() => {
                onChange(tk.title);
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 text-sm hover:bg-[var(--color-hover-row)]"
            >
              {tk.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
