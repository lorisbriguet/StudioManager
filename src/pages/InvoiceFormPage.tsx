import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ListTodo, Trash2, ArrowLeft } from "lucide-react";
import { Button, Input, Select } from "../components/ui";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { useT } from "../i18n/useT";
import { useInvoice, useCreateInvoice, useUpdateInvoice, useDeleteInvoice } from "../db/hooks/useInvoices";
import { useQueryClient } from "@tanstack/react-query";
import { useClients, useClientContacts, useClientAddresses } from "../db/hooks/useClients";
import { useProjectsByClient } from "../db/hooks/useProjects";
import { useTasksByProject } from "../db/hooks/useTasks";
import { getInvoiceLineItems } from "../db/queries/invoices";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { parseActivities } from "../types/business-profile";
import { getQuote, getQuoteLineItems, updateQuote } from "../db/queries/quotes";
import { logError } from "../lib/log";
import { makeLineItem, useLineItemForm, toPersistedLineItems, unitShortLabel } from "../lib/lineItems";
import { LineItemsTable } from "../components/shared/LineItemsTable";
import { currencies, getExchangeRate, toCHF, type Currency } from "../lib/exchangeRate";
import { useTabStore } from "../stores/tab-store";

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
    setItems((prev) => [...prev, makeLineItem({ rate, unit, amount: rate ? rate * 1 : 0 })]);
  }, [setItems]);

  const applyGlobalRate = useCallback((rate: number, unit?: string) => {
    const u = unit ?? globalUnitRef.current;
    setItems((prev) => prev.map((item) => ({
      ...item,
      rate,
      unit: u,
      amount: rate * item.quantity,
    })));
  }, [setItems]);

  useEffect(() => {
    if (existingInvoice) {
      setClientId(existingInvoice.client_id);
      setContactId(existingInvoice.contact_id);
      setBillingAddressId(existingInvoice.billing_address_id);
      setProjectId(existingInvoice.project_id);
      setInvoiceDate(existingInvoice.invoice_date);
      setActivity(existingInvoice.activity);
      setAssignment(existingInvoice.assignment);
      setPoNumber(existingInvoice.po_number ?? "");
      setNotes(existingInvoice.notes);
      setCurrency((existingInvoice.currency ?? "CHF") as Currency);
      setExchangeRate(existingInvoice.exchange_rate ?? 1);
      setChfEquivalent(existingInvoice.chf_equivalent ?? existingInvoice.total);
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
      });
    }
  }, [existingInvoice, invoiceId]);

  // Update tab label with invoice reference
  useEffect(() => {
    if (isEdit && existingInvoice?.reference) {
      const label = existingInvoice.reference.startsWith("DRAFT") ? t.draft : existingInvoice.reference;
      updateActiveTab(`/invoices/${invoiceId}/edit`, label);
    }
  }, [existingInvoice?.reference, isEdit, invoiceId]);

  // Default activity from profile for new invoices
  useEffect(() => {
    if (!isEdit && !activity && !fromQuoteId && profileActivities.length > 0) {
      setActivity(profileActivities[0]);
    }
  }, [profileActivities, isEdit, fromQuoteId]);

  // Pre-fill from quote when converting
  useEffect(() => {
    if (!fromQuoteId || isEdit) return;
    (async () => {
      const quote = await getQuote(fromQuoteId);
      if (!quote) return;
      setClientId(quote.client_id);
      setProjectId(quote.project_id);
      setBillingAddressId(quote.billing_address_id ?? null);
      setActivity(quote.activity);
      setAssignment(quote.assignment);
      setNotes(quote.notes);
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
    })().catch((e) => {
      logError("Failed to load quote:", e);
      toast.error(t.failed_load_line_items);
    });
  }, [fromQuoteId, isEdit]);

  const selectedClient = clients?.find((c) => c.id === clientId);
  const discountRate = selectedClient?.has_discount ? selectedClient.discount_rate : 0;
  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
  const discountAmount = subtotal * discountRate;
  const total = subtotal - discountAmount;

  // Auto-fetch exchange rate when currency changes
  useEffect(() => {
    if (currency === "CHF") {
      setExchangeRate(1);
      setChfManualOverride(false);
      return;
    }
    let cancelled = false;
    getExchangeRate(currency).then((rate) => {
      if (cancelled) return;
      setExchangeRate(rate);
      setChfManualOverride(false);
    });
    return () => { cancelled = true; };
  }, [currency]);

  // Auto-calc CHF equivalent when total or exchange rate changes (unless manually overridden)
  useEffect(() => {
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
  }, [clientAddresses]);
  const { data: projectTasks } = useTasksByProject(projectId ?? 0);

  const availableTasks = projectTasks ?? [];

  const save = async () => {
    if (!clientId) return toast.error(t.toast_select_client);
    if (items.every((i) => !i.designation.trim())) return toast.error(t.add_line_item);

    const dueDate = format(addDays(new Date(invoiceDate), 30), "yyyy-MM-dd");
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
            },
            lineItems,
          },
          {
            onSuccess: () => {
              toast.success(t.invoice_updated);
              navigate("/invoices");
            },
            onError: (e) => toast.error(String(e)),
          }
        );
      } else {
        const reference = `DRAFT-${Date.now()}`;
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
              assignment,
              invoice_date: invoiceDate,
              due_date: dueDate,
              payment_terms_days: 30,
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
            },
            lineItems,
          },
          {
            onSuccess: async (invoiceId) => {
              if (fromQuoteId) {
                await updateQuote(fromQuoteId, { converted_to_invoice_id: invoiceId });
                queryClient.invalidateQueries({ queryKey: ["quotes"] });
              }
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
        <Button variant="ghost" size="sm" onClick={() => navigate("/invoices")} icon={<ArrowLeft size={18} />} />
        <h1 className="text-xl font-semibold">
          {isEdit ? t.edit_invoice : t.new_invoice}
        </h1>
      </div>

      <div className="space-y-4 max-w-3xl">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.client}</label>
            <Select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setContactId(null);
                setBillingAddressId(null);
                setProjectId(null);
              }}
            >
              <option value="">{t.select_client}</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.intended_for}</label>
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
          </div>
          {clientAddresses && clientAddresses.length >= 1 && (
            <div>
              <label className="block text-xs font-medium text-muted mb-1">{t.billing_address}</label>
              <Select
                value={billingAddressId ?? ""}
                onChange={(e) => setBillingAddressId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">{t.none}</option>
                {clientAddresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}{a.billing_name ? ` — ${a.billing_name}` : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.project_optional}</label>
            <Select
              value={projectId ?? ""}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{t.none}</option>
              {clientProjects?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.date}</label>
            <Input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.activity}</label>
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
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.assignment}</label>
            <Input
              value={assignment}
              onChange={(e) => setAssignment(e.target.value)}
              placeholder={t.description_work}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.po_number}</label>
            <Input
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="e.g. PO-12345"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.currency}</label>
            <Select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </div>
          {currency !== "CHF" && (
              <div>
                <label className="block text-xs font-medium text-muted mb-1">{t.chf_equivalent}</label>
                <Input
                  type="number"
                  step="0.01"
                  value={chfEquivalent}
                  onChange={(e) => {
                    setChfEquivalent(Number(e.target.value));
                    setChfManualOverride(true);
                  }}
                />
              </div>
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
                className="border border-gray-200 rounded px-2 py-1.5 text-sm"
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
          onDragEnd={handleDragEnd}
          onAdd={addItem}
          onRemove={removeItem}
          onUpdate={updateItem}
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
              onChange={(v: string) => updateItem(i, "designation", v)}
              tasks={availableTasks}
            />
          )}
        />

        <div>
          <label className="block text-xs font-medium text-muted mb-1">{t.notes}</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
          />
        </div>

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
            onClick={() => navigate("/invoices")}
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
        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
        placeholder={t.description}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-100 border border-gray-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
          {filtered.map((tk, idx) => (
            <button
              key={`${tk.title}-${idx}`}
              type="button"
              onClick={() => {
                onChange(tk.title);
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-200"
            >
              {tk.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
