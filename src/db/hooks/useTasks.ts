import { useQuery, useMutation, useQueryClient, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/tasks";
import type { Task, Subtask } from "../../types/task";
import { useAppStore } from "../../stores/app-store";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "../../lib/appleCalendar";
import { useUndoStore } from "../../stores/undo-store";
import { logError } from "../../lib/log";

// Guards against concurrent calendar syncs for the same item
const pendingTaskSyncs = new Set<number>();
const pendingSubtaskSyncs = new Set<number>();

let _qc: QueryClient | null = null;

/** Fire-and-forget calendar sync — never blocks the UI */
function syncTaskCalendar(id: number) {
  if (!useAppStore.getState().calendarSync) return;
  if (pendingTaskSyncs.has(id)) return;
  pendingTaskSyncs.add(id);
  (async () => {
    try {
      const task = await q.getTaskById(id);
      if (!task) return;
      if ((task.status === "done" || task.due_date === null) && task.calendar_event_id) {
        await deleteCalendarEvent(task.calendar_event_id);
        await q.updateTask(id, { calendar_event_id: null });
      } else if (task.status !== "done" && task.due_date) {
        const projectName = await q.getProjectName(task.project_id);
        const calTitle = `${projectName}: ${task.title}`;
        if (task.calendar_event_id) {
          const newUid = await updateCalendarEvent(task.calendar_event_id, {
            title: calTitle,
            date: task.due_date,
            startTime: task.start_time,
            endTime: task.end_time,
          });
          await q.updateTask(id, { calendar_event_id: newUid });
        } else {
          const uid = await createCalendarEvent({
            title: calTitle,
            date: task.due_date,
            startTime: task.start_time,
            endTime: task.end_time,
          });
          await q.updateTask(id, { calendar_event_id: uid });
        }
      }
    } catch (e) {
      logError("Calendar sync failed:", e);
    } finally {
      pendingTaskSyncs.delete(id);
      _qc?.invalidateQueries({ queryKey: ["tasks"] });
    }
  })();
}

function syncSubtaskCalendar(id: number) {
  if (!useAppStore.getState().calendarSync) return;
  if (pendingSubtaskSyncs.has(id)) return;
  pendingSubtaskSyncs.add(id);
  (async () => {
    try {
      const sub = await q.getSubtaskById(id);
      if (!sub) return;
      if ((sub.status === "done" || sub.due_date === null) && sub.calendar_event_id) {
        await deleteCalendarEvent(sub.calendar_event_id);
        await q.updateSubtask(id, { calendar_event_id: null });
      } else if (sub.status !== "done" && sub.due_date) {
        const parentTask = await q.getTaskById(sub.task_id);
        const projectName = parentTask ? await q.getProjectName(parentTask.project_id) : "";
        const calTitle = `${projectName}: ${sub.title}`;
        if (sub.calendar_event_id) {
          const newUid = await updateCalendarEvent(sub.calendar_event_id, {
            title: calTitle,
            date: sub.due_date,
            startTime: sub.start_time,
            endTime: sub.end_time,
          });
          await q.updateSubtask(id, { calendar_event_id: newUid });
        } else {
          const uid = await createCalendarEvent({
            title: calTitle,
            date: sub.due_date,
            startTime: sub.start_time,
            endTime: sub.end_time,
          });
          await q.updateSubtask(id, { calendar_event_id: uid });
        }
      }
    } catch (e) {
      logError("Calendar sync failed:", e);
    } finally {
      pendingSubtaskSyncs.delete(id);
      _qc?.invalidateQueries({ queryKey: ["subtasks"] });
    }
  })();
}

export function useTasksByProject(projectId: number) {
  return useQuery({
    queryKey: ["tasks", "project", projectId],
    queryFn: () => q.getTasksByProject(projectId),
    enabled: !!projectId,
  });
}

export function useAllTasks() {
  return useQuery({ queryKey: ["tasks"], queryFn: q.getAllTasks });
}

export function useTasksWithDueDate() {
  return useQuery({
    queryKey: ["tasks", "with-due-date"],
    queryFn: q.getTasksWithDueDate,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  _qc = qc;
  return useMutation({
    mutationFn: async (data: Omit<Task, "id" | "created_at" | "updated_at" | "calendar_event_id" | "planned_minutes" | "tracked_minutes" | "workload_cells" | "workload_sort_order">) => {
      const id = await q.createTask(data);
      syncTaskCalendar(id);
      useUndoStore.getState().push({
        label: `Create task "${data.title}"`,
        execute: async () => {
          await q.deleteTask(id);
          qc.invalidateQueries({ queryKey: ["tasks"] });
        },
        redo: async () => {
          await q.createTask(data);
          qc.invalidateQueries({ queryKey: ["tasks"] });
        },
      });
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["workload-rows"] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: Partial<Omit<Task, "id" | "created_at" | "updated_at">>;
    }) => {
      const prev = await q.getTaskById(id);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `Update task "${prev.title}"`,
          execute: async () => {
            await q.updateTask(id, prevData as Partial<Omit<Task, "id" | "created_at" | "updated_at">>);
            syncTaskCalendar(id);
            qc.invalidateQueries({ queryKey: ["tasks"] });
          },
        });
      }
      // When marking as done, update due_date to today if it differs
      if (data.status === "done") {
        const today = new Date().toISOString().slice(0, 10);
        if (prev?.due_date && prev.due_date !== today) {
          data = { ...data, due_date: today };
        }
      }
      await q.updateTask(id, data);
      syncTaskCalendar(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["workload-rows"] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await q.getTaskById(id);
      const calId = useAppStore.getState().calendarSync ? prev?.calendar_event_id : null;
      await q.deleteTask(id);
      if (calId) {
        deleteCalendarEvent(calId).catch((e) => logError("Calendar sync failed:", e));
      }
      if (prev) {
        useUndoStore.getState().push({
          label: `Delete task "${prev.title}"`,
          execute: async () => {
            const { id: _id, created_at, updated_at, calendar_event_id, ...data } = prev;
            const newId = await q.createTask(data);
            syncTaskCalendar(newId);
            qc.invalidateQueries({ queryKey: ["tasks"] });
          },
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["workload-rows"] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useSubtasksByProject(projectId: number) {
  return useQuery({
    queryKey: ["subtasks", "project", projectId],
    queryFn: () => q.getSubtasksByProject(projectId),
    enabled: !!projectId,
  });
}

export function useCreateSubtask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<Subtask, "id" | "created_at" | "updated_at" | "calendar_event_id">) => {
      const id = await q.createSubtask(data);
      syncSubtaskCalendar(id);
      useUndoStore.getState().push({
        label: `Create subtask "${data.title}"`,
        execute: async () => {
          await q.deleteSubtask(id);
          qc.invalidateQueries({ queryKey: ["subtasks"] });
        },
        redo: async () => {
          await q.createSubtask(data);
          qc.invalidateQueries({ queryKey: ["subtasks"] });
        },
      });
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subtasks"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateSubtask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: Partial<Omit<Subtask, "id" | "created_at" | "updated_at">>;
    }) => {
      const prev = await q.getSubtaskById(id);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `Update subtask "${prev.title}"`,
          execute: async () => {
            await q.updateSubtask(id, prevData as Partial<Omit<Subtask, "id" | "created_at" | "updated_at">>);
            syncSubtaskCalendar(id);
            qc.invalidateQueries({ queryKey: ["subtasks"] });
          },
        });
      }
      if (data.status === "done") {
        const today = new Date().toISOString().slice(0, 10);
        if (prev?.due_date && prev.due_date !== today) {
          data = { ...data, due_date: today };
        }
      }
      await q.updateSubtask(id, data);
      syncSubtaskCalendar(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subtasks"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteSubtask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await q.getSubtaskById(id);
      const calId = useAppStore.getState().calendarSync ? prev?.calendar_event_id : null;
      await q.deleteSubtask(id);
      if (calId) {
        deleteCalendarEvent(calId).catch((e) => logError("Calendar sync failed:", e));
      }
      if (prev) {
        useUndoStore.getState().push({
          label: `Delete subtask "${prev.title}"`,
          execute: async () => {
            const { id: _id, created_at, updated_at, calendar_event_id, ...data } = prev;
            const newId = await q.createSubtask(data);
            syncSubtaskCalendar(newId);
            qc.invalidateQueries({ queryKey: ["subtasks"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subtasks"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useReorderSubtasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => q.reorderSubtasks(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subtasks"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}
