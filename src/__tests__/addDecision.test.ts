import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";
import { addDecision } from "../db/queries/wiki";

const prep = (sql: string) => rawDb().prepare(sql.replace(/\$(\d+)/g, "?$1"));
const content = (id: number) => (prep("SELECT content FROM wiki_articles WHERE id = $1").get(id) as { content: string }).content;
const count = () => (prep("SELECT COUNT(*) AS n FROM wiki_articles").get() as { n: number }).n;

let projectId: number;

beforeEach(async () => {
  await freshRealDb();
  prep("INSERT INTO clients (id, name) VALUES ('c1', 'Studio A')").run();
  projectId = Number(prep("INSERT INTO projects (client_id, name) VALUES ('c1', 'Identity')").run().lastInsertRowid);
});

describe("addDecision", () => {
  it("creates the Decisions article, then appends, with the MCP server's HTML", async () => {
    const r = await addDecision(projectId, "2026-10-01", "Use blue");
    expect(r.added).toBe(true);
    expect(content(r.articleId)).toBe("<ul><li><p><strong>2026-10-01</strong> Use blue</p></li></ul>");
    const row = prep("SELECT title, project_id, folder_id FROM wiki_articles WHERE id = $1").get(r.articleId) as Record<string, number | string>;
    expect(row).toMatchObject({ title: "Decisions", project_id: projectId });
    expect(prep("SELECT name FROM wiki_folders WHERE id = $1").get(row.folder_id)).toEqual({ name: "Identity" });
    expect(prep("SELECT tag FROM wiki_article_tags WHERE article_id = $1 ORDER BY tag").all(r.articleId)).toEqual([{ tag: "Identity" }, { tag: "decisions" }]);

    const r2 = await addDecision(projectId, "2026-10-02", "Keep it <simple> & short");
    expect(r2.articleId).toBe(r.articleId);
    expect(content(r.articleId)).toBe(
      "<ul><li><p><strong>2026-10-01</strong> Use blue</p></li>" +
        "<li><p><strong>2026-10-02</strong> Keep it &lt;simple&gt; &amp; short</p></li></ul>",
    );
  });

  it("adds the same decision once", async () => {
    await addDecision(projectId, "2026-10-01", "Use blue");
    const before = (prep("SELECT content FROM wiki_articles").get() as { content: string }).content;
    const r = await addDecision(projectId, "2026-10-01", "Use blue");
    expect(r.added).toBe(false);
    expect(content(r.articleId)).toBe(before);
    expect(count()).toBe(1);
  });

  it("recognises a decision after the editor's tight list round trip", async () => {
    const r = await addDecision(projectId, "2026-10-01", 'Use "blue" & grey');
    prep("UPDATE wiki_articles SET content = $1 WHERE id = $2").run(
      "<ul>\n<li><strong>2026-10-01</strong> Use &quot;blue&quot; &amp; grey</li>\n</ul>", r.articleId,
    );
    expect((await addDecision(projectId, "2026-10-01", 'Use "blue" & grey')).added).toBe(false);
    expect((await addDecision(projectId, "2026-10-02", "Keep it short")).added).toBe(true);
    const html = content(r.articleId);
    expect(html).toContain("<li><strong>2026-10-02</strong> Keep it short</li>");
    expect(html).not.toContain("<li><p>");
  });

  it("finds the article by its title, accents and case folded", async () => {
    const id = Number(prep("INSERT INTO wiki_articles (project_id, title, content) VALUES ($1, ' decisions ', '')").run(projectId).lastInsertRowid);
    const r = await addDecision(projectId, "2026-10-01", "Use blue");
    expect(r.articleId).toBe(id);
    expect(content(id)).toBe("<ul><li><p><strong>2026-10-01</strong> Use blue</p></li></ul>");
  });

  it("refuses a bad date, empty text and text over 1 MB, and writes nothing", async () => {
    await expect(addDecision(projectId, "01.10.2026", "x")).rejects.toThrow("Dates use YYYY-MM-DD.");
    await expect(addDecision(projectId, "2026-02-30", "x")).rejects.toThrow();
    await expect(addDecision(projectId, "2026-10-01", "   ")).rejects.toThrow();
    await expect(addDecision(projectId, "2026-10-01", "x".repeat(1024 * 1024 + 1))).rejects.toThrow();
    expect(count()).toBe(0);
  });
});
