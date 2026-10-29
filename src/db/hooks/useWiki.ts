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
import { snapshotRows, pushRestore } from "../undoRestore";
import { getLabels } from "../../lib/notify";

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
    meta: { errorLabel: "error_save_folder" },
    mutationFn: (name: string) => createWikiFolder(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki-folders"] }),
  });
}

export function useUpdateWikiFolder() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_folder" },
    mutationFn: ({ id, data }: { id: number; data: { name?: string; sort_order?: number } }) =>
      updateWikiFolder(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki-folders"] }),
  });
}

export function useDeleteWikiFolder() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_delete_folder" },
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
    meta: { errorLabel: "error_save_article" },
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
    meta: { errorLabel: "error_save_article" },
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
    qc.invalidateQueries({ queryKey: ["wiki-article"] });
    qc.invalidateQueries({ queryKey: ["wiki-article-tags"] });
  };
  return useMutation({
    meta: { errorLabel: "error_delete_article" },
    // Undo puts the very same rows back: the id (links in other articles and
    // open tabs point at it), sort_order, dates, content and tags.
    mutationFn: async (id: number) => {
      const snap = await snapshotRows([
        { table: "wiki_articles", where: "id = $1", params: [id] },
        { table: "wiki_article_tags", where: "article_id = $1", params: [id] },
      ]);
      await deleteWikiArticle(id);
      const title = String(snap[0].rows[0]?.title ?? "");
      pushRestore(`${getLabels().undo_delete_article} "${title}"`, snap, { redo: () => deleteWikiArticle(id), invalidate });
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
    meta: { errorLabel: "error_save_article" },
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
