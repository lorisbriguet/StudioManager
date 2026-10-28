import { describe, it, expect } from "vitest";
import type Database from "@tauri-apps/plugin-sql";
import { seedUserGuide, resolveGuideLinks, USER_GUIDE_TITLES } from "../db/seeds/user-guide";

// Guide articles link to each other by title in the seed; seeding swaps each
// title for the id the article got, so links survive a guide reset.

function fakeDb() {
  let nextId = 100;
  const articles = new Map<number, { title: string; content: string }>();
  const db = {
    execute: async (sql: string, params: unknown[] = []) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.startsWith("INSERT INTO wiki_articles")) {
        const id = nextId++;
        articles.set(id, { title: params[1] as string, content: params[2] as string });
        return { lastInsertId: id, rowsAffected: 1 };
      }
      if (flat.startsWith("UPDATE wiki_articles SET content")) {
        const row = articles.get(params[1] as number);
        if (row) row.content = params[0] as string;
        return { lastInsertId: 0, rowsAffected: 1 };
      }
      return { lastInsertId: nextId++, rowsAffected: 1 };
    },
    select: async () => [],
  };
  return { db: db as unknown as Database, articles };
}

describe("user guide links", () => {
  it("links every seeded article to real guide articles", async () => {
    const { db, articles } = fakeDb();
    await seedUserGuide(db);

    const idByTitle = new Map([...articles].map(([id, a]) => [a.title, id]));
    expect([...idByTitle.keys()]).toEqual(USER_GUIDE_TITLES);

    for (const [, a] of articles) {
      expect(a.content, a.title).not.toContain("guide:");
      const targets = [...a.content.matchAll(/href="\/wiki\?article=(\d+)"/g)].map((m) =>
        Number(m[1])
      );
      expect(targets.length, a.title).toBeGreaterThan(0);
      for (const id of targets) expect(articles.has(id), `${a.title} -> ${id}`).toBe(true);
    }
  });

  it("lists every other article from Getting Started", async () => {
    const { db, articles } = fakeDb();
    await seedUserGuide(db);
    const start = [...articles.values()].find((a) => a.title === "Getting Started")!;
    for (const title of USER_GUIDE_TITLES.filter((t) => t !== "Getting Started")) {
      const escaped = title.replace(/&/g, "&amp;");
      expect(start.content).toContain(`>${escaped}</a>`);
    }
  });

  it("keeps the text of a link to an unknown title", () => {
    const html = '<p><a href="guide:Gone">Gone</a> and <a href="guide:Finance%20%26%20P%26L">P&amp;L</a></p>';
    expect(resolveGuideLinks(html, new Map([["Finance & P&L", 7]]))).toBe(
      '<p>Gone and <a href="/wiki?article=7">P&amp;L</a></p>'
    );
  });
});
