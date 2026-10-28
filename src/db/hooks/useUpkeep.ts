import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as m from "../queries/machines";
import * as u from "../queries/upkeepItems";
import { useUndoStore } from "../../stores/undo-store";
import { getLabels } from "../../lib/notifyError";
import type {
  Machine,
  MachineFile,
  MachineInput,
  MachineTemplateItemInput,
  ServiceLogEntry,
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
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_machine} "${data.name}"`,
        execute: async () => {
          await m.deleteMachine(id);
          invalidate();
        },
        redo: async () => {
          id = await m.createMachine(data, items ?? []);
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
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `${getLabels().undo_update_machine} "${prev.name}"`,
          execute: async () => {
            await m.updateMachine(id, prevData as Partial<MachineInput>);
            invalidate();
          },
          redo: async () => {
            await m.updateMachine(id, data);
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
      const prevItems = prev ? await u.getUpkeepItems(id) : [];
      await m.deleteMachine(id);
      if (prev) {
        // Restore assigns a fresh id; redo deletes exactly that one.
        let restoredId: number | null = null;
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_machine} "${prev.name}"`,
          execute: async () => {
            restoredId = await m.createMachine(pickMachineInput(prev), prevItems.map(pickItemInput));
            invalidate();
          },
          redo: async () => {
            if (restoredId !== null) {
              await m.deleteMachine(restoredId);
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
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_upkeep_item} "${data.title}"`,
        execute: async () => {
          await u.deleteUpkeepItem(id);
          invalidate();
        },
        redo: async () => {
          id = await u.createUpkeepItem(data);
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
            invalidate();
          },
          redo: async () => {
            await u.updateUpkeepItem(id, data);
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
        let restoredId: number | null = null;
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_upkeep_item} "${prev.title}"`,
          execute: async () => {
            restoredId = await u.createUpkeepItem({ ...pickItemInput(prev), machine_id: prev.machine_id });
            invalidate();
          },
          redo: async () => {
            if (restoredId !== null) {
              await u.deleteUpkeepItem(restoredId);
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
    mutationFn: (id: number) => u.archiveUpkeepItem(id),
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useMarkUpkeepDone() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, doneOn, reading, note }: { id: number; doneOn: string; reading: number | null; note?: string }) =>
      u.markUpkeepDone(id, doneOn, reading, note),
    onSuccess: (item) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["service-log", item.machine_id] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useSnoozeUpkeep() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, days, todayISO }: { id: number; days: 1 | 3 | 7; todayISO: string }) =>
      u.snoozeUpkeep(id, days, todayISO),
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}
