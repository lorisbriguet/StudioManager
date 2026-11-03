import { useQuery, useMutation, useQueryClient, QueryClient } from "@tanstack/react-query";
import * as q from "../queries/tasks";
import type { Task, Subtask } from "../../types/task";
import { useAppStore } from "../../stores/app-store";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "../../lib/appleCalendar";
import { useUndoStore } from "../../stores/undo-store";
import { snapshotRows, restoreRows } from "../undoRestore";
import { getLabels, notify } from "../../lib/notify";
import { todayLocalISO } from "../../utils/localDate";

// Guards against concurrent calendar syncs for the same item
// In-flight syncs per item. A sync requested meanwhile is chained after it (so
// the latest state is synced), and undo awaits it before reading the row.
const pendingTaskSyncs = new Map<number, Promise<void>>();
const pendingSubtaskSyncs = new Map<number, Promise<void>>();

function chainSync(
  pending: Map<number, Promise<void>>,
  id: number,
  run: () => Promise<void>
): Promise<void> {
  const p: Promise<void> = (pending.get(id) ?? Promise.resolve()).then(run).finally(() => {
    if (pending.get(id) === p) pending.delete(id);
  });
  pending.set(id, p);
  return p;
}

// notify.error logs AND toasts (deduped); no separate logError needed
const notifyCalendarSyncFailure = (e: unknown) =>
  notify.error(getLabels().calendar_sync_failed, e);

let _qc: QueryClient | null = null;

/** Fire-and-forget calendar sync — never blocks the UI */
function syncTaskCalendar(id: number): Promise<void> {
  if (!useAppStore.getState().calendarSync) return Promise.resolve();
  return chainSync(pendingTaskSyncs, id, async () => {
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
      notifyCalendarSyncFailure(e);
    } finally {
      _qc?.invalidateQueries({ queryKey: ["tasks"] });
    }
  });
}

function syncSubtaskCalendar(id: number): Promise<void> {
  if (!useAppStore.getState().calendarSync) return Promise.resolve();
  return chainSync(pendingSubtaskSyncs, id, async () => {
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
      notifyCalendarSyncFailure(e);
    } finally {
      _qc?.invalidateQueries({ queryKey: ["subtasks"] });
    }
  });
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

/** Tasks excluding those of cancelled/completed projects (V1.11 C1) — for
 *  cross-project surfaces (dashboard task lists, TasksPage). Project-scoped
 *  views keep useTasksByProject / useAllTasks. Invalidations on the ["tasks"]
 *  prefix cover this key too. */
export function useVisibleTasks() {
  return useQuery({ queryKey: ["tasks", "visible"], queryFn: q.getVisibleTasks });
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
    meta: { errorLabel: "error_save_task" },
    mutationFn: async (data: Omit<Task, "id" | "created_at" | "updated_at" | "calendar_event_id" | "planned_minutes" | "tracked_minutes" | "workload_cells" | "workload_sort_order">) => {
      const id = await q.createTask(data);
      syncTaskCalendar(id);
      // Undo snapshots the row (and what the delete cascades), redo puts the
      // very same rows back with their ids, so later undo entries stay valid.
      let snap: Awaited<ReturnType<typeof snapshotRows>> = [];
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_task} "${data.title}"`,
        execute: async () => {
          // Let an in-flight calendar sync store its event id first
          await pendingTaskSyncs.get(id);
          snap = await snapshotRows([{ table: "tasks", where: "id = $1", params: [id] }, { table: "subtasks", where: "task_id = $1", params: [id] }]);
          const cur = await q.getTaskById(id);
          const calId = useAppStore.getState().calendarSync ? cur?.calendar_event_id : null;
          await q.deleteTask(id);
          if (calId) deleteCalendarEvent(calId).catch(notifyCalendarSyncFailure);
          for (const t of snap) for (const r of t.rows) if ("calendar_event_id" in r) r.calendar_event_id = null;
          qc.invalidateQueries({ queryKey: ["tasks"] });
          qc.invalidateQueries({ queryKey: ["workload-rows"] });
        },
        redo: async () => {
          await restoreRows(snap);
          syncTaskCalendar(id);
          qc.invalidateQueries({ queryKey: ["tasks"] });
          qc.invalidateQueries({ queryKey: ["workload-rows"] });
        },
      });
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["workload-rows"] });
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_task" },
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: Partial<Omit<Task, "id" | "created_at" | "updated_at">>;
    }) => {
      const prev = await q.getTaskById(id);
      // Marking done also moves the due date to today: apply that before
      // capturing the previous values so undo restores it too.
      if (data.status === "done") {
        const today = todayLocalISO();
        if (prev?.due_date && prev.due_date !== today) {
          data = { ...data, due_date: today };
        }
      }
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        const nextData = data;
        useUndoStore.getState().push({
          label: `${getLabels().undo_update_task} "${prev.title}"`,
          execute: async () => {
            await pendingTaskSyncs.get(id);
            await q.updateTask(id, prevData as Partial<Omit<Task, "id" | "created_at" | "updated_at">>);
            syncTaskCalendar(id);
            qc.invalidateQueries({ queryKey: ["tasks"] });
            qc.invalidateQueries({ queryKey: ["workload-rows"] });
          },
          redo: async () => {
            await q.updateTask(id, nextData);
            syncTaskCalendar(id);
            qc.invalidateQueries({ queryKey: ["tasks"] });
            qc.invalidateQueries({ queryKey: ["workload-rows"] });
          },
        });
      }
      await q.updateTask(id, data);
      syncTaskCalendar(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["workload-rows"] });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_delete_task" },
    mutationFn: async (id: number) => {
      const prev = await q.getTaskById(id);
      // Snapshot subtasks before delete — the schema cascade removes them
      // with the task, and undo must bring them back too.
      const subtasks = prev ? await q.getSubtasksByTask(id) : [];
      const calId = useAppStore.getState().calendarSync ? prev?.calendar_event_id : null;
      await q.deleteTask(id);
      if (calId) {
        deleteCalendarEvent(calId).catch(notifyCalendarSyncFailure);
      }
      if (prev) {
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_task} "${prev.title}"`,
          execute: async () => {
            const {
              id: _id, created_at, updated_at, calendar_event_id,
              planned_minutes, tracked_minutes, workload_cells, workload_sort_order,
              ...data
            } = prev;
            const newId = await q.createTask(data);
            // createTask doesn't insert time/workload fields — restore them
            await q.updateTask(newId, {
              planned_minutes,
              tracked_minutes,
              workload_cells,
              workload_sort_order,
            });
            for (const sub of subtasks) {
              const { id: _sid, created_at: _c, updated_at: _u, calendar_event_id: _cal, ...subData } = sub;
              await q.createSubtask({ ...subData, task_id: newId });
            }
            syncTaskCalendar(newId);
            qc.invalidateQueries({ queryKey: ["tasks"] });
            qc.invalidateQueries({ queryKey: ["subtasks"] });
            qc.invalidateQueries({ queryKey: ["workload-rows"] });
          },
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["workload-rows"] });
    },
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
    meta: { errorLabel: "error_save_subtask" },
    mutationFn: async (data: Omit<Subtask, "id" | "created_at" | "updated_at" | "calendar_event_id">) => {
      const id = await q.createSubtask(data);
      syncSubtaskCalendar(id);
      // Undo snapshots the row (and what the delete cascades), redo puts the
      // very same rows back with their ids, so later undo entries stay valid.
      let snap: Awaited<ReturnType<typeof snapshotRows>> = [];
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_subtask} "${data.title}"`,
        execute: async () => {
          // Let an in-flight calendar sync store its event id first
          await pendingSubtaskSyncs.get(id);
          snap = await snapshotRows([{ table: "subtasks", where: "id = $1", params: [id] }]);
          const cur = await q.getSubtaskById(id);
          const calId = useAppStore.getState().calendarSync ? cur?.calendar_event_id : null;
          await q.deleteSubtask(id);
          if (calId) deleteCalendarEvent(calId).catch(notifyCalendarSyncFailure);
          for (const t of snap) for (const r of t.rows) if ("calendar_event_id" in r) r.calendar_event_id = null;
          qc.invalidateQueries({ queryKey: ["subtasks"] });
          qc.invalidateQueries({ queryKey: ["workload-rows"] });
        },
        redo: async () => {
          await restoreRows(snap);
          syncSubtaskCalendar(id);
          qc.invalidateQueries({ queryKey: ["subtasks"] });
          qc.invalidateQueries({ queryKey: ["workload-rows"] });
        },
      });
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subtasks"] }),
  });
}

export function useUpdateSubtask() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_subtask" },
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: Partial<Omit<Subtask, "id" | "created_at" | "updated_at">>;
    }) => {
      const prev = await q.getSubtaskById(id);
      // Marking done also moves the due date to today: apply that before
      // capturing the previous values so undo restores it too.
      if (data.status === "done") {
        const today = todayLocalISO();
        if (prev?.due_date && prev.due_date !== today) {
          data = { ...data, due_date: today };
        }
      }
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        const nextData = data;
        useUndoStore.getState().push({
          label: `${getLabels().undo_update_subtask} "${prev.title}"`,
          execute: async () => {
            await pendingSubtaskSyncs.get(id);
            await q.updateSubtask(id, prevData as Partial<Omit<Subtask, "id" | "created_at" | "updated_at">>);
            syncSubtaskCalendar(id);
            qc.invalidateQueries({ queryKey: ["subtasks"] });
          },
          redo: async () => {
            await q.updateSubtask(id, nextData);
            syncSubtaskCalendar(id);
            qc.invalidateQueries({ queryKey: ["subtasks"] });
          },
        });
      }
      await q.updateSubtask(id, data);
      syncSubtaskCalendar(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subtasks"] }),
  });
}

export function useDeleteSubtask() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_delete_subtask" },
    mutationFn: async (id: number) => {
      const prev = await q.getSubtaskById(id);
      const calId = useAppStore.getState().calendarSync ? prev?.calendar_event_id : null;
      await q.deleteSubtask(id);
      if (calId) {
        deleteCalendarEvent(calId).catch(notifyCalendarSyncFailure);
      }
      if (prev) {
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_subtask} "${prev.title}"`,
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
  });
}

export function useReorderSubtasks() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_subtask" },
    mutationFn: (ids: number[]) => q.reorderSubtasks(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subtasks"] }),
  });
}
