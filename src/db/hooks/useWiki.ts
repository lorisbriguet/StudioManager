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
import { qk } from "../queryKeys";
import { nowMs } from "../../lib/clock";
import type { WikiArticleWithTags } from "../../types/wiki";

// ── Folders ──────────────────────────────────────────────────

export function useWikiFolders() {
  return useQuery({
    queryKey: qk.wiki.folders,
    queryFn: getWikiFolders,
  });
}

export function useCreateWikiFolder() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_folder" },
    mutationFn: (name: string) => createWikiFolder(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.wiki.folders }),
  });
}

export function useUpdateWikiFolder() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_folder" },
    mutationFn: ({ id, data }: { id: number; data: { name?: string; sort_order?: number } }) =>
      updateWikiFolder(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.wiki.folders }),
  });
}

export function useDeleteWikiFolder() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_delete_folder" },
    mutationFn: (id: number) => deleteWikiFolder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.wiki.folders });
      qc.invalidateQueries({ queryKey: qk.wiki.allArticles });
    },
  });
}

// ── Articles ─────────────────────────────────────────────────

export function useWikiArticles(folderId?: number) {
  return useQuery({
    queryKey: qk.wiki.articles(folderId ?? "all"),
    queryFn: () => getWikiArticles(folderId),
  });
}

export function useWikiArticle(id: number | null) {
  return useQuery({
    queryKey: qk.wiki.article(id),
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
      qc.invalidateQueries({ queryKey: qk.wiki.allArticles });
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
    onSuccess: (_result, { id, data }) => {
      // A move (folder, project, order) changes which lists hold the article
      // and its project name: read them again.
      if (data.folder_id !== undefined || data.project_id !== undefined || data.sort_order !== undefined) {
        qc.invalidateQueries({ queryKey: qk.wiki.allArticles });
        qc.invalidateQueries({ queryKey: qk.wiki.article(id) });
        qc.invalidateQueries({ queryKey: qk.wiki.allByProject });
        return;
      }
      // A title or text save: patch the article where it is cached, without
      // reading the whole wiki again on every autosave.
      const patch: Partial<WikiArticleWithTags> = { updated_at: sqliteNow() };
      if (data.title !== undefined) patch.title = data.title;
      if (data.content !== undefined) patch.content = data.content;
      const patchList = (list: WikiArticleWithTags[] | undefined) =>
        list?.map((a) => (a.id === id ? { ...a, ...patch } : a));
      qc.setQueriesData<WikiArticleWithTags[]>({ queryKey: qk.wiki.allArticles }, patchList);
      qc.setQueriesData<WikiArticleWithTags[]>({ queryKey: qk.wiki.allByProject }, patchList);
      qc.setQueryData<WikiArticleWithTags | null>(qk.wiki.article(id), (a) => (a ? { ...a, ...patch } : a));
    },
  });
}

/** `datetime('now')` as SQLite writes it: UTC, "YYYY-MM-DD HH:MM:SS". */
function sqliteNow(): string {
  return new Date(nowMs()).toISOString().slice(0, 19).replace("T", " ");
}

export function useDeleteWikiArticle() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.wiki.allArticles });
    qc.invalidateQueries({ queryKey: qk.wiki.allByProject });
    qc.invalidateQueries({ queryKey: qk.wiki.tags });
    qc.invalidateQueries({ queryKey: qk.wiki.anyArticle });
    qc.invalidateQueries({ queryKey: qk.wiki.allArticleTags });
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
    queryKey: qk.wiki.articleTags(articleId),
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
      qc.invalidateQueries({ queryKey: qk.wiki.articleTags(variables.articleId) });
      qc.invalidateQueries({ queryKey: qk.wiki.allArticles });
      qc.invalidateQueries({ queryKey: qk.wiki.tags });
    },
  });
}

export function useAllWikiTags() {
  return useQuery({
    queryKey: qk.wiki.tags,
    queryFn: getAllWikiTags,
  });
}

// ── Project-linked articles ──────────────────────────────────

export function useWikiArticlesByProject(projectId: number | null) {
  return useQuery({
    queryKey: qk.wiki.byProject(projectId),
    queryFn: () => (projectId != null ? getWikiArticlesByProject(projectId) : []),
    enabled: projectId != null,
  });
}
