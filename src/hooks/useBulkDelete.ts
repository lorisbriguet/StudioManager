import { useT } from "../i18n/useT";
import { plural } from "../i18n/plural";
import { useConfirm } from "../lib/confirm";
import { batchUndo, undoableAction } from "../lib/undo";

export type BulkDeleteEntity =
  | "clients"
  | "projects"
  | "tasks"
  | "invoices"
  | "quotes"
  | "expenses"
  | "income"
  | "resources";

/**
 * Deleting a selection: one confirmation ("Delete 3 expenses?"), the deletes
 * one after the other, then ONE toast whose Undo restores them all (one undo
 * entry, so Cmd+Z also brings the whole selection back).
 *
 *   const bulkDelete = useBulkDelete("expenses", (id: number) => deleteExpense.mutateAsync(id));
 *   { label: t.delete, onClick: () => bulkDelete([...bulk.selected] as number[], bulk.clearSelection) }
 *
 * `message` adds a sentence under the question (what else goes with them).
 * A failed delete is reported by its mutation; the rest still run.
 */
export function useBulkDelete<Id>(
  entity: BulkDeleteEntity,
  remove: (id: Id) => Promise<unknown>,
  options: { message?: string } = {}
) {
  const t = useT();
  const confirm = useConfirm();
  return async (ids: Id[], onDone?: () => void): Promise<boolean> => {
    if (ids.length === 0) return false;
    const ok = await confirm({
      title: plural(ids.length, t[`confirm_delete_${entity}_one`], t[`confirm_delete_${entity}_other`]),
      message: options.message,
      confirmLabel: t.delete,
      tone: "danger",
    });
    if (!ok) return false;
    let deleted = 0;
    const label = plural(ids.length, t[`bulk_deleted_${entity}_one`], t[`bulk_deleted_${entity}_other`]);
    const action = await batchUndo(label, async () => {
      for (const id of ids) {
        try {
          await remove(id);
          deleted++;
        } catch {
          // the mutation's onError already told the user
        }
      }
    });
    onDone?.();
    if (deleted > 0) {
      undoableAction(plural(deleted, t[`bulk_deleted_${entity}_one`], t[`bulk_deleted_${entity}_other`]), action);
    }
    return true;
  };
}
