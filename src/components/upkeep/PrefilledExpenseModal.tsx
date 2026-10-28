import { lazy, Suspense } from "react";
import { Modal } from "../ui";
import { useT } from "../../i18n/useT";
import { notifyError } from "../../lib/notifyError";
import { useCreateExpense, useDistinctSuppliers, useExpenseCategories } from "../../db/hooks/useExpenses";
import { getNextExpenseReference } from "../../db/queries/expenses";
import { todayLocalISO } from "../../utils/localDate";

// The expense form is the Expenses page's own; load it only when asked for.
const NewExpenseForm = lazy(() =>
  import("../../pages/ExpensesPage").then((m) => ({ default: m.NewExpenseForm }))
);

interface Props {
  title: string;
  supplier?: string;
  amount?: number;
  date?: string;
  /** Closing without saving: nothing was written. */
  onCancel: () => void;
  /** The expense was created; its id is handed back so the caller can link it. */
  onSaved: (expenseId: number) => void | Promise<void>;
}

/** The Expenses page's own new-expense form in a modal, prefilled; the user still saves it. */
export function PrefilledExpenseModal({ title, supplier, amount, date, onCancel, onSaved }: Props) {
  const { data: categories = [] } = useExpenseCategories();
  const { data: suppliers = [] } = useDistinctSuppliers();
  const createExpense = useCreateExpense();
  const t = useT();

  return (
    <Modal open onClose={onCancel} title={title} size="lg">
      <Suspense fallback={null}>
        <NewExpenseForm
          categories={categories}
          pastSuppliers={suppliers}
          prefill={{ supplier, amount, invoice_date: date ?? todayLocalISO() }}
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
              notifyError(t.upkeep_expense_link_failed, e);
              onCancel();
            }
          }}
        />
      </Suspense>
    </Modal>
  );
}
