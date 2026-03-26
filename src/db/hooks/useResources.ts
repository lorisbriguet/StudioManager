import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/resources";
import { useUndoStore } from "../../stores/undo-store";

export function useResources() {
  return useQuery({ queryKey: ["resources"], queryFn: q.getResources });
}

export function useAllTags() {
  return useQuery({ queryKey: ["resource-tags"], queryFn: q.getAllTags });
}

export function useResourceTags(resourceId: number) {
  return useQuery({
    queryKey: ["resource-tags", resourceId],
    queryFn: () => q.getResourceTags(resourceId),
  });
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
    mutationFn: async (data: { name: string; url: string; price: string; tags: string[] }) => {
      const id = await q.createResource(data);
      useUndoStore.getState().push({
        label: `Create resource "${data.name}"`,
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
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateResource() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["resources"] });
    qc.invalidateQueries({ queryKey: ["resource-tags"] });
  };
  return useMutation({
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
          label: `Update resource "${prev.name}"`,
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
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteResource() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["resources"] });
    qc.invalidateQueries({ queryKey: ["resource-tags"] });
  };
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await q.getResourceById(id);
      const prevTags = await q.getResourceTags(id);
      await q.deleteResource(id);
      if (prev) {
        useUndoStore.getState().push({
          label: `Delete resource "${prev.name}"`,
          execute: async () => {
            await q.createResource({
              name: prev.name,
              url: prev.url,
              price: prev.price,
              tags: prevTags.map((t) => t.tag),
            });
            invalidate();
          },
          redo: async () => {
            const resources = await q.getResources();
            const restored = resources.find((r) => r.name === prev.name && r.url === prev.url);
            if (restored) {
              await q.deleteResource(restored.id);
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

export function useLinkResourceToProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ resourceId, projectId }: { resourceId: number; projectId: number }) => {
      await q.linkResourceToProject(resourceId, projectId);
    },
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ["resources", "project", projectId] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUnlinkResourceFromProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ resourceId, projectId }: { resourceId: number; projectId: number }) => {
      await q.unlinkResourceFromProject(resourceId, projectId);
    },
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ["resources", "project", projectId] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}
