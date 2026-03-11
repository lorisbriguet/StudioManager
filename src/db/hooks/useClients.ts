import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/clients";
import type { Client, ClientContact } from "../../types/client";
import { useUndoStore } from "../../stores/undo-store";

export function useClients() {
  return useQuery({ queryKey: ["clients"], queryFn: q.getClients });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: ["clients", id],
    queryFn: () => q.getClient(id),
    enabled: !!id,
  });
}

export function useClientContacts(clientId: string) {
  return useQuery({
    queryKey: ["client-contacts", clientId],
    queryFn: () => q.getClientContacts(clientId),
    enabled: !!clientId,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<Client, "created_at" | "updated_at">) => {
      await q.createClient(data);
      useUndoStore.getState().push({
        label: `Create client "${data.name}"`,
        execute: async () => {
          await q.deleteClient(data.id);
          qc.invalidateQueries({ queryKey: ["clients"] });
        },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Omit<Client, "id" | "created_at" | "updated_at">>;
    }) => {
      const prev = await q.getClient(id);
      await q.updateClient(id, data);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `Update client "${prev.name}"`,
          execute: async () => {
            await q.updateClient(id, prevData as Partial<Omit<Client, "id" | "created_at" | "updated_at">>);
            qc.invalidateQueries({ queryKey: ["clients"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const prev = await q.getClient(id);
      await q.deleteClient(id);
      if (prev) {
        useUndoStore.getState().push({
          label: `Delete client "${prev.name}"`,
          execute: async () => {
            const { created_at, updated_at, ...data } = prev;
            await q.createClient(data);
            qc.invalidateQueries({ queryKey: ["clients"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });
}

export function useCreateClientContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<ClientContact, "id">) => q.createClientContact(data),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-contacts", vars.client_id] }),
  });
}

export function useUpdateClientContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: number;
      clientId: string;
      data: Partial<Omit<ClientContact, "id" | "client_id">>;
    }) => q.updateClientContact(vars.id, vars.data),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-contacts", vars.clientId] }),
  });
}

export function useDeleteClientContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; clientId: string }) =>
      q.deleteClientContact(vars.id),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-contacts", vars.clientId] }),
  });
}

export { getNextClientId } from "../queries/clients";
