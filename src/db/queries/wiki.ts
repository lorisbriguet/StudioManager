import { getDb } from "../index";
import type { WikiFolder, WikiArticle, WikiArticleWithTags } from "../../types/wiki";

// ── Folders ──────────────────────────────────────────────────

export async function getWikiFolders(): Promise<WikiFolder[]> {
  const db = await getDb();
  return db.select<WikiFolder[]>(
    "SELECT * FROM wiki_folders ORDER BY sort_order ASC, created_at ASC"
  );
}

export async function createWikiFolder(name: string): Promise<number> {
  const db = await getDb();
  const maxOrder = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM wiki_folders"
  );
  const nextOrder = (maxOrder[0]?.m ?? -1) + 1;
  const result = await db.execute(
    "INSERT INTO wiki_folders (name, sort_order) VALUES ($1, $2)",
    [name, nextOrder]
  );
  return result.lastInsertId ?? 0;
}

export async function updateWikiFolder(
  id: number,
  data: { name?: string; sort_order?: number }
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(data.name);
  }
  if (data.sort_order !== undefined) {
    fields.push(`sort_order = $${idx++}`);
    values.push(data.sort_order);
  }
  if (fields.length === 0) return;

  values.push(id);
  const db = await getDb();
  await db.execute(
    `UPDATE wiki_folders SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}

export async function deleteWikiFolder(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM wiki_folders WHERE id = $1", [id]);
}

// ── Articles ─────────────────────────────────────────────────

export async function getWikiArticles(folderId?: number): Promise<WikiArticleWithTags[]> {
  const db = await getDb();
  let sql = `
    SELECT a.*, p.name AS project_name
    FROM wiki_articles a
    LEFT JOIN projects p ON p.id = a.project_id
  `;
  const params: unknown[] = [];
  if (folderId !== undefined) {
    sql += " WHERE a.folder_id = $1";
    params.push(folderId);
  }
  sql += " ORDER BY a.sort_order ASC, a.updated_at DESC";

  const rows = await db.select<(WikiArticle & { project_name: string | null })[]>(sql, params);

  // Attach tags for each article
  const articles: WikiArticleWithTags[] = [];
  for (const row of rows) {
    const tagRows = await db.select<{ tag: string }[]>(
      "SELECT tag FROM wiki_article_tags WHERE article_id = $1",
      [row.id]
    );
    articles.push({
      ...row,
      project_name: row.project_name ?? undefined,
      tags: tagRows.map((t) => t.tag),
    });
  }
  return articles;
}

export async function getWikiArticle(id: number): Promise<WikiArticleWithTags | null> {
  const db = await getDb();
  const rows = await db.select<(WikiArticle & { project_name: string | null })[]>(
    `SELECT a.*, p.name AS project_name
     FROM wiki_articles a
     LEFT JOIN projects p ON p.id = a.project_id
     WHERE a.id = $1`,
    [id]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  const tagRows = await db.select<{ tag: string }[]>(
    "SELECT tag FROM wiki_article_tags WHERE article_id = $1",
    [id]
  );
  return {
    ...row,
    project_name: row.project_name ?? undefined,
    tags: tagRows.map((t) => t.tag),
  };
}

export async function createWikiArticle(data: {
  folder_id?: number | null;
  project_id?: number | null;
  title?: string;
}): Promise<number> {
  const db = await getDb();
  const folderId = data.folder_id ?? null;
  const projectId = data.project_id ?? null;
  const title = data.title ?? "Untitled";

  const maxOrder = folderId != null
    ? await db.select<[{ m: number }]>("SELECT COALESCE(MAX(sort_order), -1) as m FROM wiki_articles WHERE folder_id = $1", [folderId])
    : await db.select<[{ m: number }]>("SELECT COALESCE(MAX(sort_order), -1) as m FROM wiki_articles WHERE folder_id IS NULL");
  const nextOrder = (maxOrder[0]?.m ?? -1) + 1;

  const result = await db.execute(
    "INSERT INTO wiki_articles (folder_id, project_id, title, sort_order) VALUES ($1, $2, $3, $4)",
    [folderId, projectId, title, nextOrder]
  );
  return result.lastInsertId ?? 0;
}

export async function updateWikiArticle(
  id: number,
  data: {
    folder_id?: number | null;
    project_id?: number | null;
    title?: string;
    content?: string;
    sort_order?: number;
  }
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.folder_id !== undefined) {
    fields.push(`folder_id = $${idx++}`);
    values.push(data.folder_id);
  }
  if (data.project_id !== undefined) {
    fields.push(`project_id = $${idx++}`);
    values.push(data.project_id);
  }
  if (data.title !== undefined) {
    fields.push(`title = $${idx++}`);
    values.push(data.title);
  }
  if (data.content !== undefined) {
    fields.push(`content = $${idx++}`);
    values.push(data.content);
  }
  if (data.sort_order !== undefined) {
    fields.push(`sort_order = $${idx++}`);
    values.push(data.sort_order);
  }
  if (fields.length === 0) return;

  fields.push(`updated_at = datetime('now')`);
  values.push(id);

  const db = await getDb();
  await db.execute(
    `UPDATE wiki_articles SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}

export async function deleteWikiArticle(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM wiki_articles WHERE id = $1", [id]);
}

// ── Tags ─────────────────────────────────────────────────────

export async function getWikiArticleTags(articleId: number): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ tag: string }[]>(
    "SELECT tag FROM wiki_article_tags WHERE article_id = $1",
    [articleId]
  );
  return rows.map((r) => r.tag);
}

export async function setWikiArticleTags(articleId: number, tags: string[]): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM wiki_article_tags WHERE article_id = $1", [articleId]);
  for (const tag of tags) {
    await db.execute(
      "INSERT INTO wiki_article_tags (article_id, tag) VALUES ($1, $2)",
      [articleId, tag]
    );
  }
}

export async function getAllWikiTags(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ tag: string }[]>(
    "SELECT DISTINCT tag FROM wiki_article_tags ORDER BY tag ASC"
  );
  return rows.map((r) => r.tag);
}

// ── Project-linked articles ──────────────────────────────────

export async function getWikiArticlesByProject(projectId: number): Promise<WikiArticleWithTags[]> {
  const db = await getDb();
  const rows = await db.select<(WikiArticle & { project_name: string | null })[]>(
    `SELECT a.*, p.name AS project_name
     FROM wiki_articles a
     LEFT JOIN projects p ON p.id = a.project_id
     WHERE a.project_id = $1
     ORDER BY a.sort_order ASC, a.updated_at DESC`,
    [projectId]
  );
  const articles: WikiArticleWithTags[] = [];
  for (const row of rows) {
    const tagRows = await db.select<{ tag: string }[]>(
      "SELECT tag FROM wiki_article_tags WHERE article_id = $1",
      [row.id]
    );
    articles.push({
      ...row,
      project_name: row.project_name ?? undefined,
      tags: tagRows.map((t) => t.tag),
    });
  }
  return articles;
}
