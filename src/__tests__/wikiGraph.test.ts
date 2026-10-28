import { describe, it, expect } from "vitest";
import {
  buildLinkIndex,
  findUnlinkedMentions,
  linkFirstMention,
  extractOutline,
  wordCount,
  layoutGraph,
  createSim,
  placeLabels,
  buildWikiGraph,
  neighbourhood,
  type WikiArticleLike,
} from "../lib/wikiGraph";

function art(id: number, title: string, content: string, project_id: number | null = 1): WikiArticleLike {
  return { id, title, content, project_id, folder_id: null };
}

const overview = art(1, "Overview", '<p>See <a href="/wiki?article=2">Run</a> and <a href="/wiki?article=3">Decisions</a>.</p>');
const run = art(2, "Run", '<ul><li><p>Back to <a href="/wiki?article=1">Overview</a>. Why: <a href="/wiki?article=3">Decisions</a>, 2026-09-14.</p></li></ul>');
const decisions = art(3, "Decisions", "<p>Built with Tauri. The run steps changed.</p>");
const other = art(4, "Overview", "<p>Another project's overview mentions Decisions.</p>", 2);

describe("buildLinkIndex", () => {
  it("counts outgoing links and collects backlinks with their sentence", () => {
    const index = buildLinkIndex([overview, run, decisions, other]);
    expect([...index.outgoing.get(1)!]).toEqual([[2, 1], [3, 1]]);
    expect(index.outgoing.has(3)).toBe(false);

    const back = index.backlinks.get(3)!;
    expect(back.map((b) => b.sourceId)).toEqual([1, 2]);
    expect(back[1].snippets[0]).toEqual({ before: "Back to Overview. Why: ", mark: "Decisions", after: ", 2026-09-14." });
  });

  it("ignores links to itself, web links and missing articles", () => {
    const a = art(5, "A", '<p><a href="/wiki?article=5">me</a> <a href="https://x.ch">web</a> <a href="/wiki?article=99">gone</a></p>');
    const index = buildLinkIndex([a]);
    expect(index.outgoing.size).toBe(0);
    expect(index.backlinks.size).toBe(0);
  });

  it("shortens long context on word boundaries", () => {
    const long = "word ".repeat(40);
    const a = art(6, "A", `<p>${long}<a href="/wiki?article=1">x</a>${long}</p>`);
    const s = buildLinkIndex([a, overview]).backlinks.get(1)![0].snippets[0];
    expect(s.before.startsWith("…")).toBe(true);
    expect(s.after.endsWith("…")).toBe(true);
    expect(s.before.length).toBeLessThanOrEqual(61);
  });
});

describe("findUnlinkedMentions", () => {
  it("finds plain-text mentions, skipping articles that already link", () => {
    const articles = [overview, run, decisions, other];
    const index = buildLinkIndex(articles);
    // "Decisions" is unique; Overview and Run link it, the other overview only names it.
    const hits = findUnlinkedMentions(articles, decisions, index);
    expect(hits.map((h) => h.sourceId)).toEqual([4]);
    expect(hits[0].snippet.mark).toBe("Decisions");
  });

  it("limits a shared title to its own project", () => {
    const articles = [overview, run, decisions, other, art(7, "Notes", "<p>the overview is short</p>", 2)];
    const index = buildLinkIndex(articles);
    // Two "Overview" articles: article 7 (project 2) only counts for project 2's one.
    expect(findUnlinkedMentions(articles, overview, index).map((h) => h.sourceId)).toEqual([]);
    expect(findUnlinkedMentions(articles, other, index).map((h) => h.sourceId)).toEqual([7]);
  });

  it("needs a whole-word match outside links and code", () => {
    const target = art(8, "Run", "");
    const articles = [target, art(9, "B", "<p>Running <code>run</code> now</p>")];
    expect(findUnlinkedMentions(articles, target, buildLinkIndex(articles))).toEqual([]);
  });
});

describe("linkFirstMention", () => {
  it("wraps the first plain mention in a link", () => {
    expect(linkFirstMention("<p>See decisions and Decisions.</p>", "Decisions", 3)).toBe(
      '<p>See <a href="/wiki?article=3">decisions</a> and Decisions.</p>'
    );
  });

  it("returns null when there is nothing to link", () => {
    expect(linkFirstMention('<p><a href="/x">Decisions</a></p>', "Decisions", 3)).toBeNull();
  });
});

describe("extractOutline and wordCount", () => {
  it("lists headings in order", () => {
    expect(extractOutline("<h2>Run</h2><p>x</p><h3>Gotchas</h3>")).toEqual([
      { level: 2, text: "Run", index: 0 },
      { level: 3, text: "Gotchas", index: 1 },
    ]);
  });

  it("counts words", () => {
    expect(wordCount("<p>One two&nbsp;three</p><ul><li>four</li></ul>")).toBe(4);
  });
});

describe("layoutGraph", () => {
  const nodes = [1, 2, 3, 4, 5, 6].map((id) => ({ id, cluster: id <= 3 ? "a" : "b", radius: 5 }));
  const edges: [number, number][] = [[1, 2], [2, 3], [1, 3], [4, 5], [5, 6], [4, 6]];
  const d = (m: Map<number, { x: number; y: number }>, x: number, y: number) =>
    Math.hypot(m.get(x)!.x - m.get(y)!.x, m.get(x)!.y - m.get(y)!.y);

  it("is deterministic and keeps projects together", () => {
    const a = layoutGraph(nodes, edges);
    expect([...a]).toEqual([...layoutGraph(nodes, edges)]);
    expect(d(a, 1, 2)).toBeLessThan(d(a, 1, 5));
    for (const p of a.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it("does not overlap dots", () => {
    const a = layoutGraph(nodes, edges);
    for (const x of nodes) for (const y of nodes) if (x.id < y.id) expect(d(a, x.id, y.id)).toBeGreaterThan(9);
  });

  it("settles from an earlier layout without reshuffling it", () => {
    const first = layoutGraph(nodes, edges);
    const again = layoutGraph(nodes, edges, first);
    for (const id of [1, 2, 3, 4, 5, 6]) expect(Math.hypot(first.get(id)!.x - again.get(id)!.x, first.get(id)!.y - again.get(id)!.y)).toBeLessThan(20);
  });

  it("holds a dragged dot where it is put and its neighbours follow", () => {
    const start = layoutGraph(nodes, edges);
    const sim = createSim(nodes, edges, start);
    const target = { x: start.get(1)!.x + 300, y: start.get(1)!.y };
    sim.fix(1, target);
    for (let i = 0; i < 120; i++) sim.tick(0.3);
    const after = sim.positions();
    expect(after.get(1)).toEqual(target);
    expect(after.get(2)!.x).toBeGreaterThan(start.get(2)!.x + 50);
  });
});

describe("placeLabels", () => {
  it("drops a lower-priority label that would cover another", () => {
    const shown = placeLabels([
      { id: 1, x: 0, y: 0, text: "Overview", size: 10, priority: 1 },
      { id: 2, x: 5, y: 2, text: "Structure", size: 10, priority: 5 },
      { id: 3, x: 300, y: 0, text: "Far away", size: 10, priority: 0 },
    ]);
    expect([...shown].sort()).toEqual([2, 3]);
  });
});

describe("buildWikiGraph", () => {
  it("joins articles and project files: article→file and file→file links", () => {
    const a = art(1, "Structure", '<p><a href="/wiki?file=4:DESIGN-SYSTEM.md">ds</a> <a href="/wiki?article=2">run</a></p>', 4);
    const b = art(2, "Run", "", 4);
    const docs = [
      { key: "file:4:DESIGN-SYSTEM.md", projectId: 4, projectName: "SM", rel: "DESIGN-SYSTEM.md", title: "Design", links: ["docs/a.md"] },
      { key: "file:4:docs/a.md", projectId: 4, projectName: "SM", rel: "docs/a.md", title: "A", links: ["missing.md"] },
    ];
    const g = buildWikiGraph([a, b], docs, buildLinkIndex([a, b]));
    const id = (ref: number | string) => g.items.find((i) => i.ref === ref)!.id;
    expect(g.items.filter((i) => i.file).map((i) => i.title)).toEqual(["DESIGN-SYSTEM.md", "a.md"]);
    const has = (x: number, y: number) => g.edges.some(([p, q]) => (p === x && q === y) || (p === y && q === x));
    expect(has(1, 2)).toBe(true);
    expect(has(1, id("file:4:DESIGN-SYSTEM.md"))).toBe(true);
    expect(has(id("file:4:DESIGN-SYSTEM.md"), id("file:4:docs/a.md"))).toBe(true);
    expect(g.edges).toHaveLength(3);
    expect([...neighbourhood(1, g.edges)].sort()).toEqual([id("file:4:DESIGN-SYSTEM.md"), 1, 2].sort());
  });
});
