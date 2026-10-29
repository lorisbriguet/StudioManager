import { useEffect, useRef, useState } from "react";
import { notify } from "../../lib/notify";
import { useT } from "../../i18n/useT";
import { useCreateConnection, useDeleteConnection, useUpdateConnection } from "../../db/hooks/useConnections";
import { getConnection, type ConnectionInput } from "../../db/queries/connections";
import { saveConnectionSecret, testConnection } from "../../lib/upkeep/connections";
import type { Connection } from "../../types/upkeep";

/**
 * Errors of the app's own checks before any connector runs (`connectors::
 * guard`, `check_org`, the blocking task): the secret was never read.
 */
function isRefusedByApp(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return m.startsWith("organisation changed:")
    || m.startsWith("connections are off in test and presentation modes")
    || m.startsWith("connection task failed:");
}

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

  /**
   * A secret meant for one sign-in only (Bambu's password or emailed code) is
   * in the Keychain: Rust removes it once a sign-in runs. If none runs, the
   * form wipes it itself.
   */
  const oneTimeRef = useRef(false);
  const wipeOneTime = async (id: number) => {
    if (!oneTimeRef.current) return;
    oneTimeRef.current = false;
    await saveConnectionSecret(id, "{}").catch(() => {});
  };

  /**
   * Create the connection on the first save, update it after; returns its id.
   * `oneTime`: the secret is for one sign-in only (see `test`).
   */
  const save = async (data: ConnectionInput, secret?: string, opts: { oneTime?: boolean } = {}): Promise<number> => {
    if (idRef.current == null) {
      idRef.current = await create.mutateAsync({ data, secret });
    } else {
      await update.mutateAsync({ id: idRef.current, data, secret });
    }
    if (secret && opts.oneTime) oneTimeRef.current = true;
    return idRef.current;
  };

  /** Store a one-time secret (e.g. an emailed code) for the next test. */
  const saveOneTime = async (id: number, secret: string) => {
    await saveConnectionSecret(id, secret);
    oneTimeRef.current = true;
  };

  /**
   * Test the saved connection: "It works" and `onDone`, or the error to
   * `onError`. When the connector never ran (the connection is gone, the app
   * refused the call, the test threw first), a one-time secret is wiped.
   */
  const test = async (id: number, onError: (e: unknown) => void, opts: { recheckCert?: boolean } = {}) => {
    let ran = false;
    try {
      const conn = await getConnection(id);
      if (!conn) return;
      try {
        const devices = await testConnection(conn, opts);
        ran = true;
        doneRef.current = true;
        notify.success(t.upkeep_connection_test_ok.replace("{count}", String(devices.length)));
        onDone();
      } catch (e) {
        ran = !isRefusedByApp(e);
        onError(e);
      }
    } finally {
      if (ran) oneTimeRef.current = false;
      else await wipeOneTime(id);
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
    saveOneTime,
    test,
    update,
    /** The connection's id once saved. */
    id: () => idRef.current,
  };
}
