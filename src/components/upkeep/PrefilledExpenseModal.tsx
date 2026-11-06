import { lazy, Suspense, useEffect, useRef } from "react";
import { useT } from "../../i18n/useT";
import { notify } from "../../lib/notify";
import { useCreateExpense, useDistinctSuppliers, useExpenseCategories } from "../../db/hooks/useExpenses";
import { getNextExpenseReference } from "../../db/queries/expenses";
import { todayLocalISO } from "../../utils/localDate";
import { asCurrency } from "../../lib/expenseCurrency";

// The expense form is the Expenses page's own (a FormModal); load it only when asked for.
const NewExpenseForm = lazy(() =>
  import("../../pages/ExpensesPage").then((m) => ({ default: m.NewExpenseForm }))
);

interface Props {
  /** The dialog title (e.g. "Add renewal to expenses"); "New expense" when omitted. */
  title?: string;
  supplier?: string;
  amount?: number;
  /**
   * Currency of `amount`; CHF when empty. The form converts it at today's
   * rate (editable); a currency the app can't convert is refused.
   */
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
  const code = (currency ?? "").trim() || "CHF";
  const supported = asCurrency(code);
  useRefusal(supported ? null : code, onCancel);
  if (!supported) return null;

  return (
    <Suspense fallback={null}>
      <NewExpenseForm
        categories={categories}
        pastSuppliers={suppliers}
        title={title}
        prefill={{ supplier, amount, currency: supported, invoice_date: date ?? todayLocalISO() }}
        onCancel={onCancel}
        onSave={async (data) => {
          const reference = await getNextExpenseReference(
            Number((data.invoice_date || todayLocalISO()).slice(0, 4))
          );
          const id = await createExpense.mutateAsync({ ...data, reference });
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

/** A currency the app can't convert: say so and close, never book the raw number as CHF. */
function useRefusal(unsupported: string | null, onCancel: () => void) {
  const t = useT();
  const latest = useRef({ t, onCancel });
  latest.current = { t, onCancel };
  useEffect(() => {
    if (!unsupported) return;
    const { t, onCancel } = latest.current;
    notify.error(t.upkeep_expense_unsupported_currency.replace("{currency}", unsupported.toUpperCase()));
    onCancel();
  }, [unsupported]);
}
