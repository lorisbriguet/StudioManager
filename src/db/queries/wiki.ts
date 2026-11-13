import { getDb, validateFields, TransactionBatch } from "../index";
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

  const fieldNames: string[] = [];
  if (data.name !== undefined) {
    fieldNames.push("name");
    fields.push(`name = $${idx++}`);
    values.push(data.name);
  }
  if (data.sort_order !== undefined) {
    fieldNames.push("sort_order");
    fields.push(`sort_order = $${idx++}`);
    values.push(data.sort_order);
  }
  if (fields.length === 0) return;
  validateFields(fieldNames);

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
    SELECT a.*, GROUP_CONCAT(t.tag, ',') AS tags_csv, p.name AS project_name
    FROM wiki_articles a
    LEFT JOIN wiki_article_tags t ON t.article_id = a.id
    LEFT JOIN projects p ON p.id = a.project_id
  `;
  const params: unknown[] = [];
  if (folderId !== undefined) {
    sql += " WHERE a.folder_id = $1";
    params.push(folderId);
  }
  sql += " GROUP BY a.id ORDER BY a.sort_order ASC, a.updated_at DESC";

  const rows = await db.select<(WikiArticle & { project_name: string | null; tags_csv: string | null })[]>(sql, params);

  return rows.map((row) => ({
    ...row,
    project_name: row.project_name ?? undefined,
    tags: row.tags_csv ? row.tags_csv.split(",") : [],
  }));
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
  const fieldNames: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.folder_id !== undefined) {
    fieldNames.push("folder_id");
    fields.push(`folder_id = $${idx++}`);
    values.push(data.folder_id);
  }
  if (data.project_id !== undefined) {
    fieldNames.push("project_id");
    fields.push(`project_id = $${idx++}`);
    values.push(data.project_id);
  }
  if (data.title !== undefined) {
    fieldNames.push("title");
    fields.push(`title = $${idx++}`);
    values.push(data.title);
  }
  if (data.content !== undefined) {
    fieldNames.push("content");
    fields.push(`content = $${idx++}`);
    values.push(data.content);
  }
  if (data.sort_order !== undefined) {
    fieldNames.push("sort_order");
    fields.push(`sort_order = $${idx++}`);
    values.push(data.sort_order);
  }
  if (fields.length === 0) return;
  validateFields(fieldNames);

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
  // Use TransactionBatch for atomic delete+insert (raw BEGIN/COMMIT is unsafe
  // on the pooled plugin connection — each IPC call may hit a different connection)
  const batch = new TransactionBatch();
  batch.add("DELETE FROM wiki_article_tags WHERE article_id = $1", [articleId]);
  for (const tag of tags) {
    batch.add(
      "INSERT INTO wiki_article_tags (article_id, tag) VALUES ($1, $2)",
      [articleId, tag]
    );
  }
  await batch.commit();
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
  const rows = await db.select<(WikiArticle & { project_name: string | null; tags_csv: string | null })[]>(
    `SELECT a.*, GROUP_CONCAT(t.tag, ',') AS tags_csv, p.name AS project_name
     FROM wiki_articles a
     LEFT JOIN wiki_article_tags t ON t.article_id = a.id
     LEFT JOIN projects p ON p.id = a.project_id
     WHERE a.project_id = $1
     GROUP BY a.id
     ORDER BY a.sort_order ASC, a.updated_at DESC`,
    [projectId]
  );
  return rows.map((row) => ({
    ...row,
    project_name: row.project_name ?? undefined,
    tags: row.tags_csv ? row.tags_csv.split(",") : [],
  }));
}

// ── Decisions ────────────────────────────────────────────────

const MAX_DECISION_BYTES = 1024 * 1024;
const DECISIONS_TITLE = "Decisions";

/** Lowercase and strip accents, as the MCP server's `fold` does for title matching. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Add a dated decision to the project's "Decisions" article, creating the article (in the
 * project's wiki folder, tagged) when missing. Writes exactly what the MCP server's
 * `add_decision` writes; a decision already recorded is not added twice.
 */
export async function addDecision(
  projectId: number,
  date: string,
  text: string,
): Promise<{ articleId: number; added: boolean }> {
  const day = date.trim();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  if (!valid) throw new Error("Dates use YYYY-MM-DD.");
  if (new TextEncoder().encode(text).length > MAX_DECISION_BYTES) throw new Error("Text too long (over 1 MB).");
  const body = text.trim();
  if (!body) throw new Error("Text can't be empty.");

  const head = `<strong>${day}</strong> ${escapeHtml(body)}`;
  const heads = [head, head.replace(/"/g, "&quot;")];
  const recorded = (content: string) => heads.some((h) => content.includes(`${h}</p>`) || content.includes(`${h}</li>`));

  const db = await getDb();
  const projects = await db.select<{ name: string }[]>("SELECT name FROM projects WHERE id = $1", [projectId]);
  if (!projects[0]) throw new Error("Project not found.");
  const project = projects[0].name;

  const articles = await db.select<{ id: number; title: string; content: string }[]>(
    "SELECT id, title, content FROM wiki_articles WHERE project_id = $1 ORDER BY id",
    [projectId],
  );
  const hits = articles.filter((a) => fold(a.title.trim()) === fold(DECISIONS_TITLE));
  if (hits.length > 1) {
    const list = hits.map((a) => `${a.title} (id ${a.id})`).join(", ");
    throw new Error(`Several articles match "${DECISIONS_TITLE}": ${list}. Rename one in StudioManager first.`);
  }

  const found = hits[0];
  if (!found) {
    const name = project.trim();
    const folders = await db.select<{ id: number }[]>(
      "SELECT id FROM wiki_folders WHERE TRIM(name) = $1 ORDER BY id LIMIT 1",
      [name],
    );
    let folderId = folders[0]?.id;
    if (folderId === undefined) {
      const res = await db.execute(
        "INSERT INTO wiki_folders (name, sort_order) VALUES ($1, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM wiki_folders))",
        [name],
      );
      folderId = res.lastInsertId ?? 0;
    }
    const batch = new TransactionBatch();
    batch.add(
      `INSERT INTO wiki_articles (folder_id, project_id, title, content, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM wiki_articles WHERE folder_id = $1))`,
      [folderId, projectId, DECISIONS_TITLE, `<ul><li><p>${head}</p></li></ul>`],
    );
    // A tag row is itself an insert, so each tag finds the article by what it is, not by last id.
    for (const tag of [name, DECISIONS_TITLE.toLowerCase()]) {
      batch.add(
        `INSERT OR IGNORE INTO wiki_article_tags (article_id, tag)
         VALUES ((SELECT MAX(id) FROM wiki_articles WHERE project_id = $1 AND title = $2), $3)`,
        [projectId, DECISIONS_TITLE, tag],
      );
    }
    const { lastInsertId } = await batch.commit();
    const created = await db.select<{ id: number }[]>(
      "SELECT MAX(id) AS id FROM wiki_articles WHERE project_id = $1 AND title = $2",
      [projectId, DECISIONS_TITLE],
    );
    return { articleId: created[0]?.id ?? lastInsertId, added: true };
  }

  if (recorded(found.content)) return { articleId: found.id, added: false };

  const content = found.content;
  const end = content.lastIndexOf("</ul>");
  let next: string;
  if (end === -1) {
    next = `${content}<ul><li><p>${head}</p></li></ul>`;
  } else {
    const lastLi = content.lastIndexOf("<li", end);
    // Same form as the list's last item.
    const tight = lastLi !== -1 && !content.slice(lastLi).startsWith("<li><p>");
    const li = tight ? `<li>${head}</li>\n` : `<li><p>${head}</p></li>`;
    next = `${content.slice(0, end)}${li}${content.slice(end)}`;
  }
  await updateWikiArticle(found.id, { content: next });
  return { articleId: found.id, added: true };
}
