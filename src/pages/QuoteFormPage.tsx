import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Plus, Trash2, ArrowLeft, Eye } from "lucide-react";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { useQuote, useCreateQuote, useUpdateQuote } from "../db/hooks/useQuotes";
import { useClients } from "../db/hooks/useClients";
import { useProjects } from "../db/hooks/useProjects";
import { getNextQuoteReference, getQuoteLineItems } from "../db/queries/quotes";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { parseActivities } from "../types/business-profile";
import { useT } from "../i18n/useT";

interface LineItem {
  designation: string;
  rate: number | null;
  unit: string | null;
  quantity: number;
  amount: number;
}

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
  const [projectId, setProjectId] = useState<number | null>(null);
  const [quoteDate, setQuoteDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [activity, setActivity] = useState("");
  const [assignment, setAssignment] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    { designation: "", rate: null, unit: null, quantity: 1, amount: 0 },
  ]);

  useEffect(() => {
    if (existingQuote) {
      setClientId(existingQuote.client_id);
      setProjectId(existingQuote.project_id);
      setQuoteDate(existingQuote.quote_date);
      setActivity(existingQuote.activity);
      setAssignment(existingQuote.assignment);
      setNotes(existingQuote.notes);
      getQuoteLineItems(quoteId).then((lineItems) => {
        if (lineItems.length > 0) {
          setItems(
            lineItems.map((li) => ({
              designation: li.designation,
              rate: li.rate,
              unit: li.unit,
              quantity: li.quantity,
              amount: li.amount,
            }))
          );
        }
      }).catch((e) => console.error("Failed to load line items:", e));
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

  const clientProjects = projects?.filter((p) => p.client_id === clientId);

  const addItem = () =>
    setItems([...items, { designation: "", rate: null, unit: null, quantity: 1, amount: 0 }]);

  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));

  const updateItem = (i: number, field: keyof LineItem, value: unknown) => {
    const updated = [...items];
    (updated[i] as unknown as Record<string, unknown>)[field] = value;
    if (field === "rate" || field === "quantity") {
      const rate = updated[i].rate ?? 0;
      updated[i].amount = rate * updated[i].quantity;
    }
    setItems(updated);
  };

  const save = async () => {
    if (!clientId) return toast.error(t.toast_select_client);
    if (items.every((i) => !i.designation.trim())) return toast.error(t.add_line_item);

    const validUntil = format(addDays(new Date(quoteDate), 30), "yyyy-MM-dd");

    const lineItems = items.map((item, i) => ({ ...item, sort_order: i }));

    try {
      if (isEdit) {
        updateQuote.mutate(
          {
            id: quoteId,
            data: {
              client_id: clientId,
              project_id: projectId,
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
        <button onClick={() => navigate("/quotes")} className="text-muted hover:text-gray-900">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold">
          {isEdit ? t.edit_quote : t.new_quote}
        </h1>
      </div>

      <div className="space-y-4 max-w-3xl">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.client}</label>
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setProjectId(null);
              }}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
            >
              <option value="">{t.select_client}</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.project_optional}</label>
            <select
              value={projectId ?? ""}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
            >
              <option value="">{t.none}</option>
              {clientProjects?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.date}</label>
            <input
              type="date"
              value={quoteDate}
              onChange={(e) => setQuoteDate(e.target.value)}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.activity}</label>
            <select
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
            >
              {profileActivities.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
              {activity && !profileActivities.includes(activity) && (
                <option value={activity}>{activity}</option>
              )}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-muted mb-1">{t.assignment}</label>
            <input
              value={assignment}
              onChange={(e) => setAssignment(e.target.value)}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
              placeholder={t.description_work}
            />
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">{t.line_items}</h2>
            <button onClick={addItem} className="flex items-center gap-1 text-xs text-accent hover:underline">
              <Plus size={14} /> {t.add_line}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="text-left pb-2">{t.designation}</th>
                <th className="text-right pb-2 w-24">{t.rate}</th>
                <th className="text-right pb-2 w-20">{t.qty}</th>
                <th className="text-right pb-2 w-28">{t.amount}</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  <td className="pr-2 py-1">
                    <input
                      value={item.designation}
                      onChange={(e) => updateItem(i, "designation", e.target.value)}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                      placeholder={t.description}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      value={item.rate ?? ""}
                      onChange={(e) => updateItem(i, "rate", e.target.value ? Number(e.target.value) : null)}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-right"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(i, "quantity", Number(e.target.value))}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-right"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      value={item.amount}
                      onChange={(e) => updateItem(i, "amount", Number(e.target.value))}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-right"
                    />
                  </td>
                  <td className="pl-1 py-1">
                    {items.length > 1 && (
                      <button onClick={() => removeItem(i)} className="text-muted hover:text-danger">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-gray-200 mt-3 pt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">{t.subtotal}</span>
              <span>CHF {subtotal.toFixed(2)}</span>
            </div>
            {discountRate > 0 && (
              <div className="flex justify-between text-muted">
                <span>{t.cultural_discount} ({(discountRate * 100).toFixed(0)}%)</span>
                <span>- CHF {discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base pt-1">
              <span>{t.total}</span>
              <span>CHF {total.toFixed(2)}</span>
            </div>
          </div>
        </div>

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
          <button
            onClick={save}
            disabled={createQuote.isPending || updateQuote.isPending}
            className="px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isEdit ? t.update_quote : t.create_quote}
          </button>
          {isEdit && (
            <button
              onClick={() => navigate(`/quotes/${quoteId}/preview`)}
              className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-sm rounded-md hover:bg-gray-50"
            >
              <Eye size={14} /> {t.preview}
            </button>
          )}
          <button
            onClick={() => navigate("/quotes")}
            className="px-4 py-2 border border-gray-200 text-sm rounded-md hover:bg-gray-50"
          >
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
