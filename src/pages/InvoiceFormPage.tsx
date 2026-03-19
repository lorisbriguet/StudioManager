import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2, ArrowLeft, ListTodo } from "lucide-react";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { useT } from "../i18n/useT";
import { useInvoice, useCreateInvoice, useUpdateInvoice, useDeleteInvoice } from "../db/hooks/useInvoices";
import { useQueryClient } from "@tanstack/react-query";
import { useClients, useClientContacts } from "../db/hooks/useClients";
import { useProjectsByClient } from "../db/hooks/useProjects";
import { useTasksByProject } from "../db/hooks/useTasks";
import { getNextInvoiceReference, getInvoiceLineItems } from "../db/queries/invoices";
import { useBusinessProfile } from "../db/hooks/useBusinessProfile";
import { parseActivities } from "../types/business-profile";
import { getQuote, getQuoteLineItems, updateQuote } from "../db/queries/quotes";


interface LineItem {
  designation: string;
  rate: number | null;
  unit: string | null;
  quantity: number;
  amount: number;
}

export function InvoiceFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const invoiceId = Number(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromQuoteId = Number(searchParams.get("from_quote")) || null;

  const t = useT();
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
  const [projectId, setProjectId] = useState<number | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [activity, setActivity] = useState("");
  const [assignment, setAssignment] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    { designation: "", rate: null, unit: null, quantity: 1, amount: 0 },
  ]);

  useEffect(() => {
    if (existingInvoice) {
      setClientId(existingInvoice.client_id);
      setContactId(existingInvoice.contact_id);
      setProjectId(existingInvoice.project_id);
      setInvoiceDate(existingInvoice.invoice_date);
      setActivity(existingInvoice.activity);
      setAssignment(existingInvoice.assignment);
      setPoNumber(existingInvoice.po_number ?? "");
      setNotes(existingInvoice.notes);
      getInvoiceLineItems(invoiceId).then((lineItems) => {
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
  }, [existingInvoice, invoiceId]);

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
      setActivity(quote.activity);
      setAssignment(quote.assignment);
      setNotes(quote.notes);
      const lineItems = await getQuoteLineItems(fromQuoteId);
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
    })().catch((e) => console.error("Failed to load quote:", e));
  }, [fromQuoteId, isEdit]);

  const selectedClient = clients?.find((c) => c.id === clientId);
  const discountRate = selectedClient?.has_discount ? selectedClient.discount_rate : 0;
  const subtotal = items.reduce((sum, i) => sum + i.amount, 0);
  const discountAmount = subtotal * discountRate;
  const total = subtotal - discountAmount;

  const { data: clientContacts } = useClientContacts(clientId);
  const { data: clientProjects } = useProjectsByClient(clientId);
  const { data: projectTasks } = useTasksByProject(projectId ?? 0);

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

    const dueDate = format(addDays(new Date(invoiceDate), 30), "yyyy-MM-dd");

    const lineItems = items.map((item, i) => ({ ...item, sort_order: i }));

    try {
      if (isEdit) {
        updateInvoice.mutate(
          {
            id: invoiceId,
            data: {
              client_id: clientId,
              project_id: projectId,
              contact_id: contactId,
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
        const reference = await getNextInvoiceReference(new Date().getFullYear());
        createInvoice.mutate(
          {
            data: {
              reference,
              client_id: clientId,
              project_id: projectId,
              contact_id: contactId,
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

  const availableTasks = projectTasks ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate("/invoices")} className="text-muted hover:text-gray-900">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold">
          {isEdit ? t.edit_invoice : t.new_invoice}
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
                setContactId(null);
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
            <label className="block text-xs font-medium text-muted mb-1">{t.intended_for}</label>
            <select
              value={contactId ?? ""}
              onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
            >
              <option value="">{t.none}</option>
              {clientContacts?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}{c.role ? ` — ${c.role}` : ""}
                </option>
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
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
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
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.assignment}</label>
            <input
              value={assignment}
              onChange={(e) => setAssignment(e.target.value)}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
              placeholder={t.description_work}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">{t.po_number}</label>
            <input
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
              placeholder="e.g. PO-12345"
            />
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">{t.line_items}</h2>
            <div className="flex items-center gap-3">
              {availableTasks.length > 0 && (
                <button
                  onClick={() => {
                    const existingDesignations = new Set(items.map((i) => i.designation));
                    const newTasks = availableTasks.filter(
                      (t) => !existingDesignations.has(t.title)
                    );
                    if (newTasks.length === 0) {
                      toast.info(t.all_tasks_added);
                      return;
                    }
                    const newItems = newTasks.map((t) => ({
                      designation: t.title,
                      rate: null,
                      unit: null,
                      quantity: 1,
                      amount: 0,
                    }));
                    const nonEmpty = items.filter((i) => i.designation.trim());
                    setItems(nonEmpty.length > 0 ? [...nonEmpty, ...newItems] : newItems);
                  }}
                  className="flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  <ListTodo size={14} /> {t.add_tasks}
                </button>
              )}
              <button onClick={addItem} className="flex items-center gap-1 text-xs text-accent hover:underline">
                <Plus size={14} /> {t.add_line}
              </button>
            </div>
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
                    <DesignationInput
                      value={item.designation}
                      onChange={(v: string) => updateItem(i, "designation", v)}
                      tasks={availableTasks}
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
            disabled={createInvoice.isPending || updateInvoice.isPending}
            className="px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isEdit ? t.update_invoice : t.create_invoice}
          </button>
          <button
            onClick={() => navigate("/invoices")}
            className="px-4 py-2 border border-gray-200 text-sm rounded-md hover:bg-gray-50"
          >
            {t.cancel}
          </button>
          {isEdit && existingInvoice?.status === "draft" && !showDeleteConfirm && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="ml-auto flex items-center gap-1.5 px-4 py-2 text-sm text-danger border border-danger/30 rounded-md hover:bg-danger/5"
            >
              <Trash2 size={14} /> {t.delete}
            </button>
          )}
          {showDeleteConfirm && existingInvoice && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-danger">{t.delete} {existingInvoice.reference}?</span>
              <button
                onClick={() => {
                  deleteInvoice.mutate(invoiceId, {
                    onSuccess: () => {
                      toast.success(t.delete + " — " + existingInvoice.reference);
                      navigate("/invoices");
                    },
                    onError: (e) => toast.error(String(e)),
                  });
                }}
                className="px-3 py-1.5 text-sm bg-danger text-white rounded-md hover:bg-danger/90"
              >
                {t.delete}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50"
              >
                {t.cancel}
              </button>
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
    (t) => t.title.toLowerCase().includes(value.toLowerCase()) && t.title !== value
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
          {filtered.map((t) => (
            <button
              key={t.title}
              type="button"
              onClick={() => {
                onChange(t.title);
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-50"
            >
              {t.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
