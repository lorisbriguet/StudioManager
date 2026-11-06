import { useT } from "../i18n/useT";
import { useConfirm, confirmDelete } from "../lib/confirm";
import { batchUndo, deleteWithUndo, undoableAction } from "../lib/undo";
import { countIssuedInvoices } from "../db/queries/clients";
import { useDeleteClient, useSetClientArchived } from "../db/hooks/useClients";
import type { Client } from "../types/client";

/**
 * Deleting, archiving and restoring a client from the Clients list and the
 * client page.
 *
 * `remove` deletes a client that only has draft invoices. A client with issued
 * invoices can't be deleted (they're kept 10 years), so the dialog offers to
 * archive it instead.
 */
export function useClientRemoval() {
  const t = useT();
  const confirm = useConfirm();
  const deleteClient = useDeleteClient();
  const setArchived = useSetClientArchived();

  const archive = (client: Pick<Client, "id">, onDone?: () => void) =>
    deleteWithUndo(setArchived, { id: client.id, archived: true }, t.toast_client_archived, onDone);

  const restore = (client: Pick<Client, "id">) =>
    deleteWithUndo(setArchived, { id: client.id, archived: false }, t.toast_client_restored);

  const remove = async (client: Pick<Client, "id" | "name">, onDeleted?: () => void) => {
    if ((await countIssuedInvoices(client.id)) > 0) {
      const ok = await confirm({
        title: t.client_keep_invoices_title.replace("{name}", client.name),
        message: t.client_keep_invoices_message,
        confirmLabel: t.archive_client,
      });
      if (ok) archive(client);
      return;
    }
    if (!(await confirmDelete(client.name, t.delete_client_cascade))) return;
    deleteWithUndo(deleteClient, client.id, t.toast_client_deleted, onDeleted);
  };

  /** Archive a selection: one toast whose Undo restores them all. */
  const archiveMany = async (ids: string[], onDone?: () => void) => {
    if (ids.length === 0) return;
    let archived = 0;
    const action = await batchUndo(t.undo_archive_client, async () => {
      for (const id of ids) {
        try {
          await setArchived.mutateAsync({ id, archived: true });
          archived++;
        } catch {
          // the mutation's error toast already told the user
        }
      }
    });
    onDone?.();
    if (archived > 0) {
      undoableAction(
        archived === 1 ? t.toast_client_archived : t.toast_clients_archived.replace("{count}", String(archived)),
        action
      );
    }
  };

  return { remove, archive, restore, archiveMany };
}
