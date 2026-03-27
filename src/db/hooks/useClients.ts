import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/clients";
import type { Client, ClientContact, ClientAddress } from "../../types/client";
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
        redo: async () => {
          await q.createClient(data);
          qc.invalidateQueries({ queryKey: ["clients"] });
        },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
    onError: (e) => { toast.error(String(e)); },
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
          redo: async () => {
            await q.updateClient(id, data);
            qc.invalidateQueries({ queryKey: ["clients"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
    onError: (e) => { toast.error(String(e)); },
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
          redo: async () => {
            await q.deleteClient(prev.id);
            qc.invalidateQueries({ queryKey: ["clients"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useCreateClientContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<ClientContact, "id">) => {
      await q.createClientContact(data);
      // Find newly created contact to get its ID for undo
      const contacts = await q.getClientContacts(data.client_id);
      const created = contacts.find(
        (c) => c.first_name === data.first_name && c.last_name === data.last_name && c.email === data.email
      );
      if (created) {
        useUndoStore.getState().push({
          label: `Create contact "${data.first_name} ${data.last_name}"`,
          execute: async () => {
            await q.deleteClientContact(created.id);
            qc.invalidateQueries({ queryKey: ["client-contacts", data.client_id] });
          },
          redo: async () => {
            await q.createClientContact(data);
            qc.invalidateQueries({ queryKey: ["client-contacts", data.client_id] });
          },
        });
      }
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-contacts", vars.client_id] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateClientContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: number;
      clientId: string;
      data: Partial<Omit<ClientContact, "id" | "client_id">>;
    }) => {
      const prev = await q.getClientContact(vars.id);
      await q.updateClientContact(vars.id, vars.data);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(vars.data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `Update contact "${prev.first_name} ${prev.last_name}"`,
          execute: async () => {
            await q.updateClientContact(vars.id, prevData as Partial<Omit<ClientContact, "id" | "client_id">>);
            qc.invalidateQueries({ queryKey: ["client-contacts", vars.clientId] });
          },
          redo: async () => {
            await q.updateClientContact(vars.id, vars.data);
            qc.invalidateQueries({ queryKey: ["client-contacts", vars.clientId] });
          },
        });
      }
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-contacts", vars.clientId] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteClientContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: number; clientId: string }) => {
      const prev = await q.getClientContact(vars.id);
      await q.deleteClientContact(vars.id);
      if (prev) {
        const { id: _id, ...data } = prev;
        useUndoStore.getState().push({
          label: `Delete contact "${prev.first_name} ${prev.last_name}"`,
          execute: async () => {
            await q.createClientContact(data as Omit<ClientContact, "id">);
            qc.invalidateQueries({ queryKey: ["client-contacts", vars.clientId] });
          },
          redo: async () => {
            // Find the restored contact by matching fields
            const contacts = await q.getClientContacts(vars.clientId);
            const restored = contacts.find(
              (c) => c.first_name === prev.first_name && c.last_name === prev.last_name && c.email === prev.email
            );
            if (restored) {
              await q.deleteClientContact(restored.id);
              qc.invalidateQueries({ queryKey: ["client-contacts", vars.clientId] });
            }
          },
        });
      }
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-contacts", vars.clientId] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

// ── Client Addresses ───────────────────────────────────────

export function useClientAddresses(clientId: string) {
  return useQuery({
    queryKey: ["client-addresses", clientId],
    queryFn: () => q.getClientAddresses(clientId),
    enabled: !!clientId,
  });
}

export function useCreateClientAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<ClientAddress, "id">) => {
      const newId = await q.createClientAddress(data);
      useUndoStore.getState().push({
        label: `Create address "${data.label}"`,
        execute: async () => {
          await q.deleteClientAddress(newId);
          qc.invalidateQueries({ queryKey: ["client-addresses", data.client_id] });
        },
        redo: async () => {
          await q.createClientAddress(data);
          qc.invalidateQueries({ queryKey: ["client-addresses", data.client_id] });
        },
      });
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-addresses", vars.client_id] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateClientAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: number;
      clientId: string;
      data: Partial<Omit<ClientAddress, "id" | "client_id">>;
    }) => {
      const prev = await q.getClientAddress(vars.id);
      await q.updateClientAddress(vars.id, vars.data);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(vars.data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `Update address "${prev.label}"`,
          execute: async () => {
            await q.updateClientAddress(vars.id, prevData as Partial<Omit<ClientAddress, "id" | "client_id">>);
            qc.invalidateQueries({ queryKey: ["client-addresses", vars.clientId] });
          },
          redo: async () => {
            await q.updateClientAddress(vars.id, vars.data);
            qc.invalidateQueries({ queryKey: ["client-addresses", vars.clientId] });
          },
        });
      }
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-addresses", vars.clientId] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteClientAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: number; clientId: string }) => {
      const prev = await q.getClientAddress(vars.id);
      await q.deleteClientAddress(vars.id);
      if (prev) {
        const { id: _id, ...data } = prev;
        useUndoStore.getState().push({
          label: `Delete address "${prev.label}"`,
          execute: async () => {
            await q.createClientAddress(data as Omit<ClientAddress, "id">);
            qc.invalidateQueries({ queryKey: ["client-addresses", vars.clientId] });
          },
          redo: async () => {
            const addrs = await q.getClientAddresses(vars.clientId);
            const restored = addrs.find(
              (a) => a.label === prev.label && a.billing_name === prev.billing_name
            );
            if (restored) {
              await q.deleteClientAddress(restored.id);
              qc.invalidateQueries({ queryKey: ["client-addresses", vars.clientId] });
            }
          },
        });
      }
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["client-addresses", vars.clientId] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

// ── Client Activity Timeline ─────────────────────────────────

export function useClientActivity(clientId: string) {
  return useQuery({
    queryKey: ["client-activity", clientId],
    queryFn: () => q.getClientActivity(clientId),
    enabled: !!clientId,
  });
}

export { getNextClientId } from "../queries/clients";
