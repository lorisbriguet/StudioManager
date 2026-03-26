import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/projects";
import * as tq from "../queries/tasks";
import * as wq from "../queries/workload";
import type { Project } from "../../types/project";
import { useUndoStore } from "../../stores/undo-store";

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: q.getProjects });
}

export function useProjectsByClient(clientId: string) {
  return useQuery({
    queryKey: ["projects", "client", clientId],
    queryFn: () => q.getProjectsByClient(clientId),
    enabled: !!clientId,
  });
}

export function useProject(id: number) {
  return useQuery({
    queryKey: ["projects", id],
    queryFn: () => q.getProject(id),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<Project, "id" | "created_at" | "updated_at">) => {
      const id = await q.createProject(data);
      useUndoStore.getState().push({
        label: `Create project "${data.name}"`,
        execute: async () => {
          await q.deleteProject(id);
          qc.invalidateQueries({ queryKey: ["projects"] });
        },
        redo: async () => {
          await q.createProject(data);
          qc.invalidateQueries({ queryKey: ["projects"] });
        },
      });
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: Partial<Omit<Project, "id" | "created_at" | "updated_at">>;
    }) => {
      const prev = await q.getProject(id);
      await q.updateProject(id, data);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `Update project "${prev.name}"`,
          execute: async () => {
            await q.updateProject(id, prevData as Partial<Omit<Project, "id" | "created_at" | "updated_at">>);
            qc.invalidateQueries({ queryKey: ["projects"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await q.getProject(id);
      // Snapshot tasks, subtasks, and workload rows before cascade delete destroys them
      const tasks = await tq.getTasksByProject(id);
      const subtasks = await tq.getSubtasksByProject(id);
      const workloadRows = await wq.getWorkloadRows(id);
      const workloadConfig = await wq.getProjectWorkloadConfig(id);
      await q.deleteProject(id);
      if (prev) {
        useUndoStore.getState().push({
          label: `Delete project "${prev.name}"`,
          execute: async () => {
            const { id: _id, created_at, updated_at, ...data } = prev;
            const newProjectId = await q.createProject(data);
            // Restore tasks with new project ID, mapping old task IDs to new ones
            const taskIdMap = new Map<number, number>();
            for (const task of tasks) {
              const { id: oldTaskId, created_at: _c, updated_at: _u, calendar_event_id: _cal, ...taskData } = task;
              const newTaskId = await tq.createTask({ ...taskData, project_id: newProjectId });
              taskIdMap.set(oldTaskId, newTaskId);
            }
            // Restore subtasks with mapped task IDs
            for (const sub of subtasks) {
              const newTaskId = taskIdMap.get(sub.task_id);
              if (!newTaskId) continue;
              const { id: _sid, created_at: _c, updated_at: _u, calendar_event_id: _cal, ...subData } = sub;
              await tq.createSubtask({ ...subData, task_id: newTaskId });
            }
            // Restore workload config
            if (workloadConfig.columns) {
              await wq.setProjectWorkloadConfig(newProjectId, workloadConfig.template_id, workloadConfig.columns);
            }
            // Restore workload rows
            for (const row of workloadRows) {
              const newTaskId = row.task_id ? taskIdMap.get(row.task_id) ?? null : null;
              await wq.createWorkloadRow({
                project_id: newProjectId,
                template_id: row.template_id,
                task_id: newTaskId,
                cells: row.cells,
                sort_order: row.sort_order,
              });
            }
            qc.invalidateQueries({ queryKey: ["projects"] });
            qc.invalidateQueries({ queryKey: ["tasks"] });
            qc.invalidateQueries({ queryKey: ["subtasks"] });
            qc.invalidateQueries({ queryKey: ["workload-rows"] });
            qc.invalidateQueries({ queryKey: ["workload-config"] });
          },
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["subtasks"] });
      qc.invalidateQueries({ queryKey: ["workload-rows"] });
      qc.invalidateQueries({ queryKey: ["workload-config"] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}
