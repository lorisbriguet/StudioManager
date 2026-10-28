import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as m from "../queries/machines";
import * as u from "../queries/upkeepItems";
import * as c from "../queries/consumables";
import * as s from "../queries/subscriptions";
import { useMemo } from "react";
import { useAppStore } from "../../stores/app-store";
import { todayLocalISO } from "../../utils/localDate";
import { buildUpkeepOverview, type UpkeepOverview } from "../../lib/upkeep/overview";
import { useUndoStore } from "../../stores/undo-store";
import { getLabels } from "../../lib/notifyError";
import {
  removeItemEvents,
  removeSubscriptionEvent,
  syncItemCalendar,
  syncMachineItemsCalendar,
  syncSubscriptionCalendar,
} from "../../lib/upkeep/calendar";
import { markDoneWithForecast, syncItemWithForecast } from "../../lib/upkeep/connections";
import type {
  Machine,
  MachineFile,
  MachineInput,
  MachineTemplateItemInput,
  ServiceLogEntry,
  Subscription,
  UpkeepItem,
  UpkeepItemInput,
} from "../../types/upkeep";

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["upkeep-items"] });
    qc.invalidateQueries({ queryKey: ["machines"] });
  };
}

// Calendar work is fire-and-forget: the save never waits for (or fails
// because of) Apple Calendar; failures surface once through notifyError.

/** After a machine edit: a rename re-titles its events; retiring removes them, un-retiring brings them back. */
function syncMachineCalendar(id: number, prev: Machine | null, data: Partial<MachineInput>) {
  const renamed = data.name !== undefined && data.name !== prev?.name;
  const retiredChanged =
    data.status !== undefined && (data.status === "retired") !== (prev?.status === "retired");
  if (renamed || retiredChanged) void syncMachineItemsCalendar(id, { force: renamed });
}

/** Delete a machine's events (rows read before they go), then the machine. */
async function deleteMachineWithEvents(id: number) {
  const items = await u.getUpkeepItems(id);
  await m.deleteMachine(id);
  void removeItemEvents(items);
}

async function deleteItemWithEvent(id: number) {
  const item = await u.getUpkeepItem(id);
  await u.deleteUpkeepItem(id);
  if (item) void removeItemEvents([item]);
}

async function deleteSubscriptionWithEvent(id: number) {
  const sub = await s.getSubscription(id);
  await s.deleteSubscription(id);
  if (sub) void removeSubscriptionEvent(sub);
}

/** Title or alert changes re-create the event even when its date stays. */
const itemNeedsRecreate = (data: object) => "title" in data || "alert" in data;
/** Subscriptions don't store the event date: any renews_on change moves it. */
const subNeedsRecreate = (data: object) =>
  "name" in data || "alert" in data || "renews_on" in data;

function pickMachineInput(row: Machine): MachineInput {
  const {
    id: _id, created_at: _c, updated_at: _u, warranty_notified_for: _w, ...input
  } = row;
  void _id; void _c; void _u; void _w;
  return input;
}

function pickItemInput(row: UpkeepItem): MachineTemplateItemInput {
  return {
    title: row.title,
    notes: row.notes,
    schedule: row.schedule,
    interval_n: row.interval_n,
    interval_unit: row.interval_unit,
    anchor_day: row.anchor_day,
    usage_metric: row.usage_metric,
    usage_every: row.usage_every,
    last_done_on: row.last_done_on,
    in_calendar: row.in_calendar,
    alert: row.alert,
    archived: row.archived,
    start_on: row.next_due_on ?? undefined,
  };
}

// ── Queries ─────────────────────────────────────────────────

export function useMachines() {
  return useQuery({ queryKey: ["machines"], queryFn: m.getMachines });
}

export function useMachine(id: number | null) {
  return useQuery({
    queryKey: ["machines", id],
    queryFn: () => m.getMachine(id as number),
    enabled: id !== null,
  });
}

export function useMachinesByProject(projectId: number) {
  return useQuery({
    queryKey: ["machines", "project", projectId],
    queryFn: () => m.getMachinesByProject(projectId),
  });
}

export function useMachineProjectIds(machineId: number) {
  return useQuery({
    queryKey: ["machines", machineId, "projects"],
    queryFn: () => m.getMachineProjectIds(machineId),
  });
}

export function useMachineFiles(machineId: number) {
  return useQuery({
    queryKey: ["machines", machineId, "files"],
    queryFn: () => m.getMachineFiles(machineId),
  });
}

export function useServiceLog(machineId: number) {
  return useQuery({
    queryKey: ["service-log", machineId],
    queryFn: () => m.getServiceLog(machineId),
  });
}

export function useUpkeepItems(machineId?: number) {
  return useQuery({
    queryKey: ["upkeep-items", machineId ?? "all"],
    queryFn: () => u.getUpkeepItems(machineId),
  });
}

export function useActiveUpkeepItems() {
  return useQuery({ queryKey: ["upkeep-items", "active"], queryFn: u.getActiveUpkeepItems });
}

// ── Machine mutations ───────────────────────────────────────

export function useCreateMachine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ data, items }: { data: MachineInput; items?: MachineTemplateItemInput[] }) => {
      let id = await m.createMachine(data, items ?? []);
      void syncMachineItemsCalendar(id);
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_machine} "${data.name}"`,
        execute: async () => {
          await deleteMachineWithEvents(id);
          invalidate();
        },
        redo: async () => {
          id = await m.createMachine(data, items ?? []);
          void syncMachineItemsCalendar(id);
          invalidate();
        },
      });
      return id;
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateMachine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<MachineInput> }) => {
      const prev = await m.getMachine(id);
      await m.updateMachine(id, data);
      syncMachineCalendar(id, prev, data);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        const after = { ...prev, ...data } as Machine;
        useUndoStore.getState().push({
          label: `${getLabels().undo_update_machine} "${prev.name}"`,
          execute: async () => {
            await m.updateMachine(id, prevData as Partial<MachineInput>);
            syncMachineCalendar(id, after, prevData as Partial<MachineInput>);
            invalidate();
          },
          redo: async () => {
            await m.updateMachine(id, data);
            syncMachineCalendar(id, prev, data);
            invalidate();
          },
        });
      }
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteMachine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await m.getMachine(id);
      const prevItems = await u.getUpkeepItems(id);
      await m.deleteMachine(id);
      void removeItemEvents(prevItems);
      if (prev) {
        // Restore assigns a fresh id; redo deletes exactly that one.
        let restoredId: number | null = null;
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_machine} "${prev.name}"`,
          execute: async () => {
            restoredId = await m.createMachine(pickMachineInput(prev), prevItems.map(pickItemInput));
            void syncMachineItemsCalendar(restoredId);
            invalidate();
          },
          redo: async () => {
            if (restoredId !== null) {
              await deleteMachineWithEvents(restoredId);
              invalidate();
            }
          },
        });
      }
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useSetMachineProjects() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, projectIds }: { id: number; projectIds: number[] }) =>
      m.setMachineProjects(id, projectIds),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["machines", "project"] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useAddMachineFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, file }: { machineId: number; file: Pick<MachineFile, "label" | "kind" | "path_or_url"> }) =>
      m.addMachineFile(machineId, file),
    onSuccess: (_, { machineId }) => {
      qc.invalidateQueries({ queryKey: ["machines", machineId, "files"] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useRemoveMachineFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId }: { fileId: number; machineId: number }) => m.removeMachineFile(fileId),
    onSuccess: (_, { machineId }) => {
      qc.invalidateQueries({ queryKey: ["machines", machineId, "files"] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useAddServiceLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: Omit<ServiceLogEntry, "id" | "created_at">) => m.addServiceLog(entry),
    onSuccess: (_, entry) => {
      qc.invalidateQueries({ queryKey: ["service-log", entry.machine_id] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

// ── Upkeep item mutations ───────────────────────────────────

export function useCreateUpkeepItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (data: UpkeepItemInput) => {
      let id = await u.createUpkeepItem(data);
      void syncItemWithForecast(id);
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_upkeep_item} "${data.title}"`,
        execute: async () => {
          await deleteItemWithEvent(id);
          invalidate();
        },
        redo: async () => {
          id = await u.createUpkeepItem(data);
          void syncItemCalendar(id);
          invalidate();
        },
      });
      return id;
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateUpkeepItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<UpkeepItemInput> }) => {
      const prev = await u.getUpkeepItem(id);
      await u.updateUpkeepItem(id, data);
      const force = itemNeedsRecreate(data);
      void syncItemWithForecast(id, { force });
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          if (key === "start_on") continue;
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `${getLabels().undo_update_upkeep_item} "${prev.title}"`,
          execute: async () => {
            await u.updateUpkeepItem(id, prevData as Partial<UpkeepItemInput>);
            void syncItemCalendar(id, { force });
            invalidate();
          },
          redo: async () => {
            await u.updateUpkeepItem(id, data);
            void syncItemCalendar(id, { force });
            invalidate();
          },
        });
      }
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteUpkeepItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await u.getUpkeepItem(id);
      await u.deleteUpkeepItem(id);
      if (prev) {
        void removeItemEvents([prev]);
        let restoredId: number | null = null;
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_upkeep_item} "${prev.title}"`,
          execute: async () => {
            restoredId = await u.createUpkeepItem({ ...pickItemInput(prev), machine_id: prev.machine_id });
            void syncItemCalendar(restoredId);
            invalidate();
          },
          redo: async () => {
            if (restoredId !== null) {
              await deleteItemWithEvent(restoredId);
              invalidate();
            }
          },
        });
      }
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useArchiveUpkeepItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: number) => {
      await u.archiveUpkeepItem(id);
      void syncItemCalendar(id);
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useMarkUpkeepDone() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, doneOn, reading, note }: { id: number; doneOn: string; reading: number | null; note?: string }) => {
      // Usage items take the current reading and are re-forecast at once;
      // the Calendar event follows.
      return markDoneWithForecast(id, doneOn, reading, note);
    },
    onSuccess: (item) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["service-log", item.machine_id] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

// ── Consumables ─────────────────────────────────────────────

export function useConsumables() {
  return useQuery({ queryKey: ["consumables"], queryFn: c.getConsumables });
}

export function useProjectMaterialCost(projectId: number) {
  return useQuery({
    queryKey: ["project-material-cost", projectId],
    queryFn: () => c.getProjectMaterialCost(projectId),
  });
}

function useInvalidateConsumables() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["consumables"] });
  };
}

export function useCreateConsumable() {
  const invalidate = useInvalidateConsumables();
  return useMutation({
    mutationFn: async (data: c.ConsumableInput) => {
      let id = await c.createConsumable(data);
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_consumable} "${data.name}"`,
        execute: async () => {
          await c.deleteConsumable(id);
          invalidate();
        },
        redo: async () => {
          id = await c.createConsumable(data);
          invalidate();
        },
      });
      return id;
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateConsumable() {
  const invalidate = useInvalidateConsumables();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<c.ConsumableInput> }) => {
      const prev = await c.getConsumable(id);
      await c.updateConsumable(id, data);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `${getLabels().undo_update_consumable} "${prev.name}"`,
          execute: async () => {
            await c.updateConsumable(id, prevData as Partial<c.ConsumableInput>);
            invalidate();
          },
          redo: async () => {
            await c.updateConsumable(id, data);
            invalidate();
          },
        });
      }
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteConsumable() {
  const invalidate = useInvalidateConsumables();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await c.getConsumable(id);
      await c.deleteConsumable(id);
      if (prev) {
        let restoredId: number | null = null;
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_consumable} "${prev.name}"`,
          execute: async () => {
            restoredId = await c.createConsumable({
              name: prev.name,
              unit: prev.unit,
              machine_id: prev.machine_id,
              stock: prev.stock,
              reorder_level: prev.reorder_level,
              supplier: prev.supplier,
              product_url: prev.product_url,
              unit_price: prev.unit_price,
              currency: prev.currency,
            });
            invalidate();
          },
          redo: async () => {
            if (restoredId !== null) {
              await c.deleteConsumable(restoredId);
              invalidate();
            }
          },
        });
      }
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useLogConsumableUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, projectId, usedOn }: { id: number; amount: number; projectId: number | null; usedOn: string }) =>
      c.logConsumableUsage(id, amount, projectId, usedOn),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ["consumables"] });
      qc.invalidateQueries({ queryKey: ["project-material-cost", projectId] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useRestockConsumable() {
  const invalidate = useInvalidateConsumables();
  return useMutation({
    mutationFn: ({ id, amount }: { id: number; amount: number }) => c.restockConsumable(id, amount),
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

// ── Subscriptions ───────────────────────────────────────────

export function useSubscriptions() {
  return useQuery({ queryKey: ["subscriptions"], queryFn: s.getSubscriptions });
}

export function usePendingRenewals() {
  return useQuery({ queryKey: ["subscription-renewals"], queryFn: s.getPendingRenewals });
}

function useInvalidateSubscriptions() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["subscriptions"] });
    qc.invalidateQueries({ queryKey: ["subscription-renewals"] });
  };
}

export function useCreateSubscription() {
  const invalidate = useInvalidateSubscriptions();
  return useMutation({
    mutationFn: async (data: s.SubscriptionInput) => {
      let id = await s.createSubscription(data);
      void syncSubscriptionCalendar(id);
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_subscription} "${data.name}"`,
        execute: async () => {
          await deleteSubscriptionWithEvent(id);
          invalidate();
        },
        redo: async () => {
          id = await s.createSubscription(data);
          void syncSubscriptionCalendar(id);
          invalidate();
        },
      });
      return id;
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateSubscription() {
  const invalidate = useInvalidateSubscriptions();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<s.SubscriptionInput> }) => {
      const prev = await s.getSubscription(id);
      await s.updateSubscription(id, data);
      const force = subNeedsRecreate(data);
      void syncSubscriptionCalendar(id, { force });
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `${getLabels().undo_update_subscription} "${prev.name}"`,
          execute: async () => {
            await s.updateSubscription(id, prevData as Partial<s.SubscriptionInput>);
            void syncSubscriptionCalendar(id, { force });
            invalidate();
          },
          redo: async () => {
            await s.updateSubscription(id, data);
            void syncSubscriptionCalendar(id, { force });
            invalidate();
          },
        });
      }
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useCancelSubscription() {
  const invalidate = useInvalidateSubscriptions();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await s.getSubscription(id);
      await s.cancelSubscription(id);
      void syncSubscriptionCalendar(id);
      if (prev) {
        useUndoStore.getState().push({
          label: `${getLabels().undo_update_subscription} "${prev.name}"`,
          execute: async () => {
            await s.updateSubscription(id, { status: prev.status });
            void syncSubscriptionCalendar(id);
            invalidate();
          },
          redo: async () => {
            await s.cancelSubscription(id);
            void syncSubscriptionCalendar(id);
            invalidate();
          },
        });
      }
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteSubscription() {
  const invalidate = useInvalidateSubscriptions();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await s.getSubscription(id);
      await s.deleteSubscription(id);
      if (prev) {
        void removeSubscriptionEvent(prev);
        let restoredId: number | null = null;
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_subscription} "${prev.name}"`,
          execute: async () => {
            restoredId = await s.createSubscription({
              name: prev.name, plan: prev.plan, vendor: prev.vendor, url: prev.url,
              renews_on: prev.renews_on, anchor_day: prev.anchor_day, period: prev.period,
              cost: prev.cost, currency: prev.currency, status: prev.status,
              in_calendar: prev.in_calendar, alert: prev.alert, notes: prev.notes,
            });
            void syncSubscriptionCalendar(restoredId);
            invalidate();
          },
          redo: async () => {
            if (restoredId !== null) {
              await deleteSubscriptionWithEvent(restoredId);
              invalidate();
            }
          },
        });
      }
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useApplyRenewals() {
  const invalidate = useInvalidateSubscriptions();
  return useMutation({
    mutationFn: async ({ sub, todayISO }: { sub: Subscription; todayISO: string }) => {
      const count = await s.applyRenewals(sub, todayISO);
      // renews_on moved forward: move the renewal event with it.
      if (count > 0) void syncSubscriptionCalendar(sub.id, { force: true });
      return count;
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDecideRenewal() {
  const invalidate = useInvalidateSubscriptions();
  return useMutation({
    mutationFn: ({ id, decision, expenseId }: { id: number; decision: "added" | "skipped"; expenseId?: number }) =>
      s.decideRenewal(id, decision, expenseId),
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useSnoozeUpkeep() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, days, todayISO }: { id: number; days: 1 | 3 | 7; todayISO: string }) => {
      await u.snoozeUpkeep(id, days, todayISO);
      void syncItemCalendar(id);
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

// ── Overview ────────────────────────────────────────────────

export type { DueRow } from "../../lib/upkeep/overview";

/** Everything the Overview tab, the sidebar badge and the dashboard widget show. */
export function useUpkeepOverview(): UpkeepOverview {
  const { data: items } = useActiveUpkeepItems();
  const { data: machines } = useMachines();
  const { data: consumables } = useConsumables();
  const { data: subscriptions } = useSubscriptions();
  const soonDays = useAppStore((s) => s.upkeepSoonDays);
  const warrantyWindowDays = useAppStore((s) => s.warrantyWindowDays);
  const renewalWindowDays = useAppStore((s) => s.renewalWindowDays);
  const todayISO = todayLocalISO();
  return useMemo(
    () =>
      buildUpkeepOverview({
        items: items ?? [],
        machines: machines ?? [],
        consumables: consumables ?? [],
        subscriptions: subscriptions ?? [],
        todayISO,
        soonDays,
        warrantyWindowDays,
        renewalWindowDays,
      }),
    [items, machines, consumables, subscriptions, todayISO, soonDays, warrantyWindowDays, renewalWindowDays]
  );
}
