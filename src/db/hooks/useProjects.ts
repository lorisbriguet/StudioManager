import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/projects";
import * as tq from "../queries/tasks";
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
      });
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
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
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await q.getProject(id);
      // Snapshot tasks and subtasks before cascade delete destroys them
      const tasks = await tq.getTasksByProject(id);
      const subtasks = await tq.getSubtasksByProject(id);
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
            qc.invalidateQueries({ queryKey: ["projects"] });
            qc.invalidateQueries({ queryKey: ["tasks"] });
            qc.invalidateQueries({ queryKey: ["subtasks"] });
          },
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["subtasks"] });
    },
  });
}
