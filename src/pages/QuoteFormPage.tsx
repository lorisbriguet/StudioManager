import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye } from "lucide-react";
import { Button, Input, Select } from "../components/ui";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { useQuote, useCreateQuote, useUpdateQuote } from "../db/hooks/useQuotes";
import { useClients, useClientAddresses } from "../db/hooks/useClients";
import { useProjects } from "../db/hooks/useProjects";
import { getNextQuoteReference, getQuoteLineItems } from "../db/queries/quotes";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { logError } from "../lib/log";
import { parseActivities } from "../types/business-profile";
import { useT } from "../i18n/useT";
import { makeLineItem, useLineItemForm, toPersistedLineItems, unitShortLabel } from "../lib/lineItems";
import { LineItemsTable } from "../components/shared/LineItemsTable";

export function QuoteFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const quoteId = Number(id);
  const navigate = useNavigate();

  const t = useT();
  const { data: existingQuote } = useQuote(isEdit ? quoteId : 0);
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { data: profile } = useBusinessProfile();
  const profileActivities = useMemo(() => parseActivities(profile?.default_activity), [profile?.default_activity]);
  const createQuote = useCreateQuote();
  const updateQuote = useUpdateQuote();

  const [clientId, setClientId] = useState("");
  const [billingAddressId, setBillingAddressId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [quoteDate, setQuoteDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [activity, setActivity] = useState("");
  const [assignment, setAssignment] = useState("");
  const [notes, setNotes] = useState("");

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
    if (existingQuote) {
      setClientId(existingQuote.client_id);
      setBillingAddressId(existingQuote.billing_address_id);
      setProjectId(existingQuote.project_id);
      setQuoteDate(existingQuote.quote_date);
      setActivity(existingQuote.activity);
      setAssignment(existingQuote.assignment);
      setNotes(existingQuote.notes);
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
      });
    }
  }, [existingQuote, quoteId]);

  // Default activity from profile for new quotes
  useEffect(() => {
    if (!isEdit && !activity && profileActivities.length > 0) {
      setActivity(profileActivities[0]);
    }
  }, [profileActivities, isEdit]);

  const selectedClient = clients?.find((c) => c.id === clientId);
  const discountRate = selectedClient?.has_discount ? selectedClient.discount_rate : 0;
  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
  const discountAmount = subtotal * discountRate;
  const total = subtotal - discountAmount;

  const { data: clientAddresses } = useClientAddresses(clientId);
  const clientProjects = projects?.filter((p) => p.client_id === clientId);

  // Auto-select address when client has exactly one
  useEffect(() => {
    if (clientAddresses && clientAddresses.length === 1 && !billingAddressId) {
      setBillingAddressId(clientAddresses[0].id);
    }
  }, [clientAddresses]);

  const save = async () => {
    if (!clientId) return toast.error(t.toast_select_client);
    if (items.every((i) => !i.designation.trim())) return toast.error(t.add_line_item);

    const validUntil = format(addDays(new Date(quoteDate), 30), "yyyy-MM-dd");
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
              activity,
              assignment,
              quote_date: quoteDate,
              valid_until: validUntil,
              subtotal,
              discount_applied: discountRate > 0 ? 1 : 0,
              discount_rate: discountRate,
              total,
              notes,
            },
            lineItems,
          },
          {
            onSuccess: () => {
              toast.success(t.quote_updated);
              navigate("/quotes");
            },
            onError: (e) => toast.error(String(e)),
          }
        );
      } else {
        const reference = await getNextQuoteReference(new Date().getFullYear());
        createQuote.mutate(
          {
            data: {
              reference,
              client_id: clientId,
              project_id: projectId,
              billing_address_id: billingAddressId,
              status: "draft",
              language: selectedClient?.language ?? "FR",
              activity,
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
            },
            lineItems,
          },
          {
            onSuccess: () => {
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
        <Button variant="ghost" size="sm" onClick={() => navigate("/quotes")} icon={<ArrowLeft size={18} />} />
        <h1 className="text-xl font-semibold">
          {isEdit ? t.edit_quote : t.new_quote}
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
                setBillingAddressId(null);
                setProjectId(null);
              }}
              className="py-2"
            >
              <option value="">{t.select_client}</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          {clientAddresses && clientAddresses.length >= 1 && (
            <div>
              <label className="block text-xs font-medium text-muted mb-1">{t.billing_address}</label>
              <Select
                value={billingAddressId ?? ""}
                onChange={(e) => setBillingAddressId(e.target.value ? Number(e.target.value) : null)}
                className="py-2"
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
              className="py-2"
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
              value={quoteDate}
              onChange={(e) => setQuoteDate(e.target.value)}
              className="py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.activity}</label>
            <Select
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
              className="py-2"
            >
              {profileActivities.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
              {activity && !profileActivities.includes(activity) && (
                <option value={activity}>{activity}</option>
              )}
            </Select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-muted mb-1">{t.assignment}</label>
            <Input
              value={assignment}
              onChange={(e) => setAssignment(e.target.value)}
              className="py-2"
              placeholder={t.description_work}
            />
          </div>
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
          hideRate={useGlobalRate}
          globalRateLabel={useGlobalRate && globalRate > 0 ? t.all_items_at_rate.replace("{rate}", String(globalRate)).replace("{currency}", "CHF").replace("{unit}", unitShortLabel(globalUnit)) : undefined}
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
            disabled={createQuote.isPending || updateQuote.isPending}
          >
            {isEdit ? t.update_quote : t.create_quote}
          </Button>
          {isEdit && (
            <Button
              variant="secondary"
              size="lg"
              icon={<Eye size={14} />}
              onClick={() => navigate(`/quotes/${quoteId}/preview`)}
            >
              {t.preview}
            </Button>
          )}
          <Button
            variant="secondary"
            size="lg"
            onClick={() => navigate("/quotes")}
          >
            {t.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}
