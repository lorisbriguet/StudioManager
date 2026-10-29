import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/connections";
import { updateMachine } from "../queries/machines";
import { recordManualReading, runConnectionSyncs, saveConnectionSecret } from "../../lib/upkeep/connections";
import type { Machine } from "../../types/upkeep";

export function useConnections() {
  return useQuery({ queryKey: ["connections"], queryFn: q.getConnections });
}

export function useMachineDisks(machineId: number) {
  return useQuery({ queryKey: ["machine-disks", machineId], queryFn: () => q.getMachineDisks(machineId) });
}

export function useCurrentReading(machineId: number, metric = "print_hours") {
  return useQuery({
    queryKey: ["machine-readings", machineId, metric],
    queryFn: () => q.currentReading(machineId, metric),
  });
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["connections", "machines", "upkeep-items", "machine-readings", "machine-disks"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

/** Create a connection, then put its secret in the Keychain. */
export function useCreateConnection() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async ({ data, secret }: { data: q.ConnectionInput; secret?: string }) => {
      const id = await q.createConnection(data);
      if (secret) {
        try {
          await saveConnectionSecret(id, secret);
        } catch (e) {
          // No half-made connection without its secret.
          await q.deleteConnectionRow(id).catch(() => {});
          throw e;
        }
      }
      return id;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateConnection() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async ({ id, data, secret }: { id: number; data: Partial<q.ConnectionInput>; secret?: string }) => {
      await q.updateConnection(id, data);
      if (secret) await saveConnectionSecret(id, secret);
    },
    onSuccess: invalidate,
  });
}

export function useDeleteConnection() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: q.deleteConnection,
    // Refresh either way: a failed Keychain delete keeps the row, and the list must show it.
    onSettled: invalidate,
  });
}

/** "Sync now": forced, for one connection or all. Failures land on the connection row. */
export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId?: number) => runConnectionSyncs(qc, { force: true, connectionId }),
  });
}

/** Link a machine to a connection's device (or unlink with nulls). */
export function useLinkMachine() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, connection_id, device_id, reading_baseline, linked_at }: {
      id: number;
      connection_id: number | null;
      device_id: string | null;
      reading_baseline: number | null;
      /** ISO UTC time of the link; null when unlinking. */
      linked_at: string | null;
    }) => updateMachine(id, { connection_id, device_id, reading_baseline, linked_at }),
    onSuccess: invalidate,
  });
}

export function useRecordManualReading() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ machine, value }: { machine: Machine; value: number }) => recordManualReading(machine, value),
    onSuccess: invalidate,
  });
}
