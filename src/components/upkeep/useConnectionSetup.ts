import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "../../i18n/useT";
import { useCreateConnection, useDeleteConnection, useUpdateConnection } from "../../db/hooks/useConnections";
import { getConnection, type ConnectionInput } from "../../db/queries/connections";
import { testConnection } from "../../lib/upkeep/connections";
import type { Connection } from "../../types/upkeep";

/**
 * The save → test → retry cycle shared by the connection setup forms
 * (`SynologyForm`, `BambuForm`). The first save creates the connection (and
 * its Keychain secret), later ones update it. A new connection closed before
 * a test succeeded (Cancel, Escape, the dialog's close button, another kind
 * picked) is removed with its secret; with `connection` (Reconnect) nothing is
 * ever created or removed.
 */
export function useConnectionSetup(connection: Connection | undefined, onDone: () => void) {
  const t = useT();
  const create = useCreateConnection();
  const update = useUpdateConnection();
  const remove = useDeleteConnection();
  const existing = connection != null;
  const idRef = useRef<number | null>(connection?.id ?? null);
  const doneRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const removeRef = useRef(remove.mutate);
  removeRef.current = remove.mutate;
  useEffect(() => () => {
    if (!existing && idRef.current != null && !doneRef.current) removeRef.current(idRef.current);
  }, [existing]);

  /** Create the connection on the first save, update it after; returns its id. */
  const save = async (data: ConnectionInput, secret?: string): Promise<number> => {
    if (idRef.current == null) {
      idRef.current = await create.mutateAsync({ data, secret });
    } else {
      await update.mutateAsync({ id: idRef.current, data, secret });
    }
    return idRef.current;
  };

  /** Test the saved connection: "It works" and `onDone`, or the error to `onError`. */
  const test = async (id: number, onError: (e: unknown) => void) => {
    const conn = await getConnection(id);
    if (!conn) return;
    try {
      const devices = await testConnection(conn);
      doneRef.current = true;
      toast.success(t.upkeep_connection_test_ok.replace("{count}", String(devices.length)));
      onDone();
    } catch (e) {
      onError(e);
    }
  };

  /** Run `work` with the primary button spinning. Mutation errors are already toasted. */
  const busyWhile = (work: () => Promise<void>) => {
    setBusy(true);
    void work()
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return {
    existing,
    busy,
    busyWhile,
    save,
    test,
    update,
    /** The connection's id once saved. */
    id: () => idRef.current,
  };
}
