import { lazy, Suspense, useState } from "react";
import { Link2, Receipt, Unlink } from "lucide-react";
import { Button, Modal, Select } from "../ui";
import { useT } from "../../i18n/useT";
import { useUpdateMachine } from "../../db/hooks/useUpkeep";
import {
  useCreateExpense,
  useDistinctSuppliers,
  useExpenseCategories,
  useExpenses,
} from "../../db/hooks/useExpenses";
import { getNextExpenseReference } from "../../db/queries/expenses";
import { formatDisplayDate } from "../../utils/formatDate";
import { todayLocalISO } from "../../utils/localDate";
import type { Machine } from "../../types/upkeep";

// The expense form is the Expenses page's own; load it only when asked for.
const NewExpenseForm = lazy(() =>
  import("../../pages/ExpensesPage").then((m) => ({ default: m.NewExpenseForm }))
);

/** Price of the machine, with a link to an existing expense or a new prefilled one. */
export function MachineExpenseRow({ machine }: { machine: Machine }) {
  const t = useT();
  const update = useUpdateMachine();
  const { data: expenses = [] } = useExpenses();
  const { data: categories = [] } = useExpenseCategories();
  const { data: suppliers = [] } = useDistinctSuppliers();
  const createExpense = useCreateExpense();
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);

  const linked = expenses.find((e) => e.id === machine.expense_id);

  return (
    <div className="space-y-2">
      <div className="text-sm tabular-nums">
        {machine.price != null ? `${machine.price.toFixed(2)} ${machine.currency ?? "CHF"}` : "—"}
      </div>
      {machine.expense_id != null ? (
        <div className="flex items-center gap-2 text-xs">
          <Receipt size={14} className="text-muted" />
          <span>{linked ? `${linked.reference} · ${linked.supplier}` : t.upkeep_expense_linked}</span>
          <button
            type="button"
            aria-label={t.upkeep_unlink_expense}
            title={t.upkeep_unlink_expense}
            className="p-1 rounded-md text-muted hover:bg-[var(--color-hover-row)]"
            onClick={() => update.mutate({ id: machine.id, data: { expense_id: null } })}
          >
            <Unlink size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {picking ? (
            <Select
              fullWidth={false}
              aria-label={t.upkeep_link_expense}
              value=""
              onChange={(e) => {
                if (e.target.value) update.mutate({ id: machine.id, data: { expense_id: Number(e.target.value) } });
                setPicking(false);
              }}
            >
              <option value="">{t.upkeep_pick_expense}</option>
              {expenses.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.reference} · {e.supplier} · {e.amount.toFixed(2)}
                </option>
              ))}
            </Select>
          ) : (
            <Button size="sm" variant="secondary" icon={<Link2 size={14} />} onClick={() => setPicking(true)}>
              {t.upkeep_link_expense}
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={<Receipt size={14} />} onClick={() => setCreating(true)}>
            {t.upkeep_create_expense}
          </Button>
        </div>
      )}
      {creating && (
        <Modal open onClose={() => setCreating(false)} title={t.upkeep_create_expense} size="lg">
          <Suspense fallback={null}>
            <NewExpenseForm
              categories={categories}
              pastSuppliers={suppliers}
              prefill={{
                supplier: machine.supplier ?? undefined,
                amount: machine.price ?? undefined,
                invoice_date: machine.purchase_date ?? todayLocalISO(),
              }}
              onCancel={() => setCreating(false)}
              onSave={async (data) => {
                const reference = await getNextExpenseReference(
                  Number((data.invoice_date || todayLocalISO()).slice(0, 4))
                );
                const id = await createExpense.mutateAsync({ ...data, reference });
                update.mutate({ id: machine.id, data: { expense_id: id } });
                setCreating(false);
              }}
            />
          </Suspense>
        </Modal>
      )}
      {linked && <div className="text-xs text-muted">{formatDisplayDate(linked.invoice_date)}</div>}
    </div>
  );
}
