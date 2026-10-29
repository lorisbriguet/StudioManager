import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/resources";
import { useUndoStore } from "../../stores/undo-store";
import { getLabels } from "../../lib/notify";

export function useResources() {
  return useQuery({ queryKey: ["resources"], queryFn: q.getResources });
}

export function useAllTags() {
  return useQuery({ queryKey: ["resource-tags"], queryFn: q.getAllTags });
}

export function useResourcesByProject(projectId: number) {
  return useQuery({
    queryKey: ["resources", "project", projectId],
    queryFn: () => q.getResourcesByProject(projectId),
  });
}

export function useCreateResource() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["resources"] });
    qc.invalidateQueries({ queryKey: ["resource-tags"] });
  };
  return useMutation({
    meta: { errorLabel: "error_save_resource" },
    mutationFn: async (data: { name: string; url: string; price: string; tags: string[] }) => {
      const id = await q.createResource(data);
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_resource} "${data.name}"`,
        execute: async () => {
          await q.deleteResource(id);
          invalidate();
        },
        redo: async () => {
          await q.createResource(data);
          invalidate();
        },
      });
      return id;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateResource() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["resources"] });
    qc.invalidateQueries({ queryKey: ["resource-tags"] });
  };
  return useMutation({
    meta: { errorLabel: "error_save_resource" },
    mutationFn: async ({
      id,
      data,
      tags,
    }: {
      id: number;
      data: Partial<{ name: string; url: string; price: string }>;
      tags?: string[];
    }) => {
      const prev = await q.getResourceById(id);
      const prevTags = await q.getResourceTags(id);
      await q.updateResource(id, data);
      if (tags !== undefined) {
        await q.setResourceTags(id, tags);
      }
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `${getLabels().undo_update_resource} "${prev.name}"`,
          execute: async () => {
            await q.updateResource(id, prevData as Partial<{ name: string; url: string; price: string }>);
            if (tags !== undefined) {
              await q.setResourceTags(id, prevTags.map((t) => t.tag));
            }
            invalidate();
          },
          redo: async () => {
            await q.updateResource(id, data);
            if (tags !== undefined) {
              await q.setResourceTags(id, tags);
            }
            invalidate();
          },
        });
      }
    },
    onSuccess: invalidate,
  });
}

export function useDeleteResource() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["resources"] });
    qc.invalidateQueries({ queryKey: ["resource-tags"] });
  };
  return useMutation({
    meta: { errorLabel: "error_delete_resource" },
    mutationFn: async (id: number) => {
      const prev = await q.getResourceById(id);
      const prevTags = await q.getResourceTags(id);
      await q.deleteResource(id);
      if (prev) {
        // The restore assigns a fresh rowid; redo targets exactly that id —
        // a name+url lookup could hit a different row with the same values.
        let restoredId: number | null = null;
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_resource} "${prev.name}"`,
          execute: async () => {
            restoredId = await q.createResource({
              name: prev.name,
              url: prev.url,
              price: prev.price,
              tags: prevTags.map((t) => t.tag),
            });
            invalidate();
          },
          redo: async () => {
            if (restoredId !== null) {
              await q.deleteResource(restoredId);
              invalidate();
            }
          },
        });
      }
    },
    onSuccess: invalidate,
  });
}

export function useLinkResourceToProject() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_link_resource" },
    mutationFn: async ({ resourceId, projectId }: { resourceId: number; projectId: number }) => {
      await q.linkResourceToProject(resourceId, projectId);
    },
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ["resources", "project", projectId] });
    },
  });
}

export function useUnlinkResourceFromProject() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_unlink_resource" },
    mutationFn: async ({ resourceId, projectId }: { resourceId: number; projectId: number }) => {
      await q.unlinkResourceFromProject(resourceId, projectId);
      useUndoStore.getState().push({
        label: getLabels().undo_unlink_resource,
        execute: async () => {
          await q.linkResourceToProject(resourceId, projectId);
          qc.invalidateQueries({ queryKey: ["resources", "project", projectId] });
        },
        redo: async () => {
          await q.unlinkResourceFromProject(resourceId, projectId);
          qc.invalidateQueries({ queryKey: ["resources", "project", projectId] });
        },
      });
    },
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ["resources", "project", projectId] });
    },
  });
}
