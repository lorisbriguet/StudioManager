import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/useT";
import { notify } from "../../lib/notify";
import { useCreateExpense, useDistinctSuppliers, useExpenseCategories } from "../../db/hooks/useExpenses";
import { getNextExpenseReference } from "../../db/queries/expenses";
import { todayLocalISO } from "../../utils/localDate";
import { conversionHint, conversionNote, refusalText, toBaseAmount } from "../../lib/upkeep/expenseAmount";

// The expense form is the Expenses page's own (a FormModal); load it only when asked for.
const NewExpenseForm = lazy(() =>
  import("../../pages/ExpensesPage").then((m) => ({ default: m.NewExpenseForm }))
);

interface Props {
  /** The dialog title (e.g. "Add renewal to expenses"); "New expense" when omitted. */
  title?: string;
  supplier?: string;
  amount?: number;
  /** Currency of `amount`: converted to CHF (expenses have no currency), or refused without a rate. */
  currency?: string | null;
  date?: string;
  /** Closing without saving: nothing was written. */
  onCancel: () => void;
  /** The expense was created; its id is handed back so the caller can link it. */
  onSaved: (expenseId: number) => void | Promise<void>;
}

/** The Expenses page's own new-expense dialog, prefilled; the user still saves it. */
export function PrefilledExpenseModal({ title, supplier, amount, currency, date, onCancel, onSaved }: Props) {
  const { data: categories = [] } = useExpenseCategories();
  const { data: suppliers = [] } = useDistinctSuppliers();
  const createExpense = useCreateExpense();
  const t = useT();
  const base = useBaseAmount(amount, currency, onCancel);
  if (!base) return null;

  return (
    <Suspense fallback={null}>
      <NewExpenseForm
        categories={categories}
        pastSuppliers={suppliers}
        title={title}
        prefill={{ supplier, amount: base.amount, invoice_date: date ?? todayLocalISO() }}
        amountHint={base.hint ?? undefined}
        onCancel={onCancel}
        onSave={async (data) => {
          const reference = await getNextExpenseReference(
            Number((data.invoice_date || todayLocalISO()).slice(0, 4))
          );
          const notes = [data.notes, base.note].filter(Boolean).join("\n");
          const id = await createExpense.mutateAsync({ ...data, notes, reference });
          try {
            await onSaved(id);
          } catch (e) {
            // The expense exists; close so a second save cannot duplicate it.
            notify.error(t.upkeep_expense_link_failed, e);
            onCancel();
          }
        }}
      />
    </Suspense>
  );
}

/**
 * `amount` in CHF, with the hint and note on what was converted; null until known.
 * Another currency is converted at today's rate and said so under the amount; with
 * no rate the dialog closes with the reason instead of booking the raw number.
 */
function useBaseAmount(amount: number | undefined, currency: string | null | undefined, onCancel: () => void) {
  const t = useT();
  const [base, setBase] = useState<{ amount?: number; hint: string | null; note: string | null } | null>(
    amount == null ? { amount, hint: null, note: null } : null
  );
  const latest = useRef({ t, onCancel });
  latest.current = { t, onCancel };
  useEffect(() => {
    if (amount == null) return;
    let live = true;
    void toBaseAmount(amount, currency).then((r) => {
      if (!live) return;
      const { t, onCancel } = latest.current;
      if (!r.ok) {
        notify.error(refusalText(r, t));
        onCancel();
        return;
      }
      setBase({
        amount: r.amount,
        hint: r.converted ? conversionHint(r.converted, r.amount, t) : null,
        note: r.converted ? conversionNote(r.converted, todayLocalISO(), t) : null,
      });
    });
    return () => { live = false; };
  }, [amount, currency]);
  return base;
}
