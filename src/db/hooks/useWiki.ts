import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getWikiFolders,
  createWikiFolder,
  updateWikiFolder,
  deleteWikiFolder,
  getWikiArticles,
  getWikiArticle,
  createWikiArticle,
  updateWikiArticle,
  deleteWikiArticle,
  getWikiArticleTags,
  setWikiArticleTags,
  getAllWikiTags,
  getWikiArticlesByProject,
} from "../queries/wiki";
import { useUndoStore } from "../../stores/undo-store";

// ── Folders ──────────────────────────────────────────────────

export function useWikiFolders() {
  return useQuery({
    queryKey: ["wiki-folders"],
    queryFn: getWikiFolders,
  });
}

export function useCreateWikiFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createWikiFolder(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki-folders"] }),
  });
}

export function useUpdateWikiFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; sort_order?: number } }) =>
      updateWikiFolder(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki-folders"] }),
  });
}

export function useDeleteWikiFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteWikiFolder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wiki-folders"] });
      qc.invalidateQueries({ queryKey: ["wiki-articles"] });
    },
  });
}

// ── Articles ─────────────────────────────────────────────────

export function useWikiArticles(folderId?: number) {
  return useQuery({
    queryKey: ["wiki-articles", folderId ?? "all"],
    queryFn: () => getWikiArticles(folderId),
  });
}

export function useWikiArticle(id: number | null) {
  return useQuery({
    queryKey: ["wiki-article", id],
    queryFn: () => (id != null ? getWikiArticle(id) : null),
    enabled: id != null,
  });
}

export function useCreateWikiArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { folder_id?: number | null; project_id?: number | null; title?: string }) =>
      createWikiArticle(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wiki-articles"] });
    },
  });
}

export function useUpdateWikiArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: {
        folder_id?: number | null;
        project_id?: number | null;
        title?: string;
        content?: string;
        sort_order?: number;
      };
    }) => updateWikiArticle(id, data),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ["wiki-articles"] });
      qc.invalidateQueries({ queryKey: ["wiki-article", variables.id] });
      qc.invalidateQueries({ queryKey: ["wiki-articles-by-project"] });
    },
  });
}

export function useDeleteWikiArticle() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["wiki-articles"] });
    qc.invalidateQueries({ queryKey: ["wiki-articles-by-project"] });
    qc.invalidateQueries({ queryKey: ["wiki-tags"] });
  };
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await getWikiArticle(id);
      const prevTags = await getWikiArticleTags(id);
      await deleteWikiArticle(id);
      if (prev) {
        useUndoStore.getState().push({
          label: `Article deleted`,
          execute: async () => {
            const newId = await createWikiArticle({
              folder_id: prev.folder_id,
              project_id: prev.project_id,
              title: prev.title,
            });
            await updateWikiArticle(newId, { content: prev.content });
            await setWikiArticleTags(newId, prevTags);
            invalidate();
          },
          redo: async () => {
            const articles = await getWikiArticles();
            const restored = articles.find(
              (a) => a.title === prev.title && a.folder_id === prev.folder_id
            );
            if (restored) {
              await deleteWikiArticle(restored.id);
              invalidate();
            }
          },
        });
      }
    },
    onSuccess: invalidate,
  });
}

// ── Tags ─────────────────────────────────────────────────────

export function useWikiArticleTags(articleId: number | null) {
  return useQuery({
    queryKey: ["wiki-article-tags", articleId],
    queryFn: () => (articleId != null ? getWikiArticleTags(articleId) : []),
    enabled: articleId != null,
  });
}

export function useSetWikiArticleTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ articleId, tags }: { articleId: number; tags: string[] }) =>
      setWikiArticleTags(articleId, tags),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ["wiki-article-tags", variables.articleId] });
      qc.invalidateQueries({ queryKey: ["wiki-articles"] });
      qc.invalidateQueries({ queryKey: ["wiki-tags"] });
    },
  });
}

export function useAllWikiTags() {
  return useQuery({
    queryKey: ["wiki-tags"],
    queryFn: getAllWikiTags,
  });
}

// ── Project-linked articles ──────────────────────────────────

export function useWikiArticlesByProject(projectId: number | null) {
  return useQuery({
    queryKey: ["wiki-articles-by-project", projectId],
    queryFn: () => (projectId != null ? getWikiArticlesByProject(projectId) : []),
    enabled: projectId != null,
  });
}
