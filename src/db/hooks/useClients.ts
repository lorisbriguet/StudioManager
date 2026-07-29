import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/clients";
import type { Client, ClientContact, ClientAddress } from "../../types/client";
import { useUndoStore } from "../../stores/undo-store";
import { getLabels } from "../../lib/notifyError";

// Every query family the deleteClient cascade touches — invalidated after
// delete, undo (restore) and redo so no stale rows linger anywhere.
const CLIENT_GRAPH_QUERY_KEYS = [
  "clients",
  "client-contacts",
  "client-addresses",
  "client-activity",
  "projects",
  "tasks",
  "subtasks",
  "workload-rows",
  "workload-config",
  "invoices",
  "quotes",
  "finance",
  "time-entries",
  "project-tables",
  "project-table-rows",
  "resources",
  "recurring_templates",
] as const;

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
        label: `${getLabels().undo_create_client} "${data.name}"`,
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
          label: `${getLabels().undo_update_client} "${prev.name}"`,
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
  const invalidateGraph = () => {
    for (const key of CLIENT_GRAPH_QUERY_KEYS) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
  return useMutation({
    mutationFn: async (id: string) => {
      // Snapshot the FULL graph before the cascade destroys it, so undo
      // restores every project/task/invoice/quote/etc. with original IDs.
      // Accepted non-transactional read window: the snapshot is 15 separate
      // SELECTs plus a gap before the delete batch, so background writers
      // (e.g. syncTaskCalendar) landing in that window are deleted but not
      // snapshotted — fine for a single-user desktop app.
      const snap = await q.snapshotClientGraph(id);
      await q.deleteClient(id);
      if (snap) {
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_client} "${snap.client.name}"`,
          execute: async () => {
            await q.restoreClientGraph(snap);
            invalidateGraph();
          },
          redo: async () => {
            await q.deleteClient(id);
            invalidateGraph();
          },
        });
      }
    },
    onSuccess: invalidateGraph,
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
          label: `${getLabels().undo_create_contact} "${data.first_name} ${data.last_name}"`,
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
          label: `${getLabels().undo_update_contact} "${prev.first_name} ${prev.last_name}"`,
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
          label: `${getLabels().undo_delete_contact} "${prev.first_name} ${prev.last_name}"`,
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
        label: `${getLabels().undo_create_address} "${data.label}"`,
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
          label: `${getLabels().undo_update_address} "${prev.label}"`,
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
          label: `${getLabels().undo_delete_address} "${prev.label}"`,
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
