/**
 * Links between wiki articles, read from their stored HTML: backlinks with
 * the sentence around each link, unlinked mentions, the outline, and a
 * force layout for the graph view. Pure functions; the DOM is only used to
 * parse HTML strings.
 */
import { parseWikiArticleId, parseWikiFileKey } from "./wikiLinks";

export interface WikiArticleLike {
  id: number;
  title: string;
  content: string;
  project_id: number | null;
  folder_id: number | null;
}

/** Text around a link or mention: `before` + highlighted `mark` + `after`. */
export interface Snippet {
  before: string;
  mark: string;
  after: string;
}

export interface Backlink {
  sourceId: number;
  snippets: Snippet[];
}

export interface LinkIndex {
  /** source id -> target id -> number of links */
  outgoing: Map<number, Map<number, number>>;
  /** target id -> articles linking to it */
  backlinks: Map<number, Backlink[]>;
  /** article id -> project file key (`file:…`) -> number of links */
  fileOutgoing: Map<number, Map<string, number>>;
  /** project file key -> articles linking to it */
  fileBacklinks: Map<string, Backlink[]>;
}

const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT
const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,pre";
const SNIPPET_SIDE = 60;

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ");
}

function cutStart(text: string): string {
  const t = clean(text).trimStart();
  if (t.length <= SNIPPET_SIDE) return t;
  const cut = t.slice(t.length - SNIPPET_SIDE);
  const space = cut.indexOf(" ");
  return "…" + (space > 0 ? cut.slice(space + 1) : cut);
}

function cutEnd(text: string): string {
  const t = clean(text).trimEnd();
  if (t.length <= SNIPPET_SIDE) return t;
  const cut = t.slice(0, SNIPPET_SIDE);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut) + "…";
}

/** The sentence-sized context of `target` (a node inside a block). */
function snippetAround(target: Node, markText?: { node: Text; start: number; end: number }): Snippet {
  const el = target.nodeType === 1 ? (target as Element) : target.parentElement;
  const block = el?.closest(BLOCKS) ?? el ?? target;
  let before = "";
  let mark = "";
  let after = "";
  let seen = false;
  const walker = target.ownerDocument!.createTreeWalker(block, SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? "";
    if (markText && n === markText.node) {
      before += text.slice(0, markText.start);
      mark = text.slice(markText.start, markText.end);
      after += text.slice(markText.end);
      seen = true;
    } else if (!markText && target.contains(n)) {
      mark += text;
      seen = true;
    } else if (!seen) {
      before += text;
    } else {
      after += text;
    }
  }
  return { before: cutStart(before), mark: clean(mark).trim(), after: cutEnd(after) };
}

/** Outgoing links and backlinks for every article. */
export function buildLinkIndex(articles: WikiArticleLike[]): LinkIndex {
  const outgoing = new Map<number, Map<number, number>>();
  const backlinks = new Map<number, Backlink[]>();
  const fileOutgoing = new Map<number, Map<string, number>>();
  const fileBacklinks = new Map<string, Backlink[]>();
  const known = new Set(articles.map((a) => a.id));

  for (const a of articles) {
    if (!a.content || !a.content.includes("/wiki?")) continue;
    const doc = parse(a.content);
    const targets = new Map<number, number>();
    const snippets = new Map<number, Snippet[]>();
    const fileTargets = new Map<string, number>();
    const fileSnippets = new Map<string, Snippet[]>();
    for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
      const href = anchor.getAttribute("href") ?? "";
      const fileKey = parseWikiFileKey(href);
      if (fileKey) {
        fileTargets.set(fileKey, (fileTargets.get(fileKey) ?? 0) + 1);
        const list = fileSnippets.get(fileKey) ?? [];
        list.push(snippetAround(anchor));
        fileSnippets.set(fileKey, list);
        continue;
      }
      const id = parseWikiArticleId(href);
      if (id === null || id === a.id || !known.has(id)) continue;
      targets.set(id, (targets.get(id) ?? 0) + 1);
      const list = snippets.get(id) ?? [];
      list.push(snippetAround(anchor));
      snippets.set(id, list);
    }
    if (fileTargets.size > 0) {
      fileOutgoing.set(a.id, fileTargets);
      for (const [key, list] of fileSnippets) {
        const entry = fileBacklinks.get(key) ?? [];
        entry.push({ sourceId: a.id, snippets: list });
        fileBacklinks.set(key, entry);
      }
    }
    if (targets.size === 0) continue;
    outgoing.set(a.id, targets);
    for (const [id, list] of snippets) {
      const entry = backlinks.get(id) ?? [];
      entry.push({ sourceId: a.id, snippets: list });
      backlinks.set(id, entry);
    }
  }
  return { outgoing, backlinks, fileOutgoing, fileBacklinks };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches `title` as a whole word or phrase, any case. */
function mentionPattern(title: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(title.trim())})(?=$|[^\\p{L}\\p{N}])`, "iu");
}

/** First plain-text occurrence of `pattern`, outside links and code. */
function findMention(doc: Document, pattern: RegExp): { node: Text; start: number; end: number } | null {
  const walker = doc.createTreeWalker(doc.body, SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest("a,code,pre")) continue;
    const m = pattern.exec(n.textContent ?? "");
    if (m) {
      const start = m.index + m[1].length;
      return { node: n as Text, start, end: start + m[2].length };
    }
  }
  return null;
}

/**
 * Articles that name `target` in plain text without linking to it. A title
 * shared by several articles ("Overview") only counts within the same
 * project (or folder), where it most likely means this one.
 */
export function findUnlinkedMentions(
  articles: WikiArticleLike[],
  target: WikiArticleLike,
  index: LinkIndex
): { sourceId: number; snippet: Snippet }[] {
  const title = target.title.trim();
  if (title.length < 3) return [];
  const sameTitle = articles.filter((a) => a.title.trim().toLowerCase() === title.toLowerCase());
  const unique = sameTitle.length <= 1;
  const pattern = mentionPattern(title);
  const out: { sourceId: number; snippet: Snippet }[] = [];
  for (const a of articles) {
    if (a.id === target.id || !a.content) continue;
    if (index.outgoing.get(a.id)?.has(target.id)) continue;
    if (!unique) {
      const near =
        target.project_id != null
          ? a.project_id === target.project_id
          : target.folder_id != null && a.folder_id === target.folder_id;
      if (!near) continue;
    }
    if (!pattern.test(a.content.replace(/<[^>]*>/g, " "))) continue;
    const doc = parse(a.content);
    const hit = findMention(doc, pattern);
    if (hit) out.push({ sourceId: a.id, snippet: snippetAround(hit.node, hit) });
  }
  return out;
}

/** Turns the first plain-text mention of `title` into a link to `targetId`.
 *  Returns the new HTML, or null when there is no mention to link. */
export function linkFirstMention(html: string, title: string, targetId: number): string | null {
  const doc = parse(html);
  const hit = findMention(doc, mentionPattern(title));
  if (!hit) return null;
  const middle = hit.node.splitText(hit.start);
  middle.splitText(hit.end - hit.start);
  const a = doc.createElement("a");
  a.setAttribute("href", `/wiki?article=${targetId}`);
  middle.parentNode!.replaceChild(a, middle);
  a.appendChild(middle);
  return doc.body.innerHTML;
}

export interface OutlineItem {
  level: number;
  text: string;
  /** Position among the article's headings, to find it in the editor. */
  index: number;
}

export function extractOutline(html: string): OutlineItem[] {
  if (!html) return [];
  const doc = parse(html);
  return Array.from(doc.querySelectorAll("h1,h2,h3")).map((h, index) => ({
    level: Number(h.tagName[1]),
    text: clean(h.textContent ?? "").trim(),
    index,
  }));
}

export function wordCount(html: string): number {
  const text = html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  return text.split(/\s+/).filter(Boolean).length;
}

/** Every link once, as an undirected pair. */
export function linkPairs(index: LinkIndex, visible: Set<number>): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const [src, targets] of index.outgoing) {
    if (!visible.has(src)) continue;
    for (const dst of targets.keys()) {
      if (!visible.has(dst)) continue;
      const key = src < dst ? `${src}-${dst}` : `${dst}-${src}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(src < dst ? [src, dst] : [dst, src]);
    }
  }
  return out;
}

export interface Point {
  x: number;
  y: number;
}

export interface SimNode {
  id: number;
  /** Its project ("p:12"), or a group for articles without one. */
  cluster: string;
  /** Dot radius, in graph units (collision). */
  radius: number;
}

/** A force simulation in the manner of d3-force (velocity Verlet, an
 *  `alpha` that cools from 1), as in the Art Basel hub's graph: links pull
 *  to a rest length (longer and weaker between projects), dots push each
 *  other apart and don't overlap, and each project is pulled to its own
 *  spot on a ring. Deterministic: the same graph always settles the same
 *  way, and a layout can start from an earlier one so nothing reshuffles. */
export interface Sim {
  tick(alpha: number): void;
  /** Holds a dot at `at` (a drag), or lets it go with `undefined`. */
  fix(id: number, at: Point | undefined): void;
  positions(): Map<number, Point>;
}

const VELOCITY_DECAY = 0.4;
const ALPHA_DECAY = 0.03;
export const ALPHA_MIN = 0.001;
const CHARGE = -90;
const CHARGE_REACH = 260;
const COLLIDE_GAP = 3;
const PULL = 0.05;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function createSim(
  nodes: SimNode[],
  links: [number, number][],
  start: Map<number, Point> = new Map()
): Sim {
  const n = nodes.length;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const held = new Map<number, Point>();

  // Each project gets a spot on a ring, sized to the whole graph.
  const clusters = [...new Set(nodes.map((node) => node.cluster))];
  const ring = clusters.length > 1 ? 45 * Math.sqrt(n) : 0;
  const centres = new Map(
    clusters.map((c, i) => {
      const a = (i / clusters.length) * Math.PI * 2 - Math.PI / 2;
      return [c, { x: Math.cos(a) * ring, y: Math.sin(a) * ring }];
    })
  );

  const edges = links
    .map(([a, b]) => [index.get(a), index.get(b)] as const)
    .filter((e): e is readonly [number, number] => e[0] !== undefined && e[1] !== undefined && e[0] !== e[1]);
  const degree = new Float64Array(n);
  for (const [a, b] of edges) {
    degree[a]++;
    degree[b]++;
  }
  const springs = edges.map(([a, b]) => {
    const same = nodes[a].cluster === nodes[b].cluster;
    return { a, b, length: same ? 55 : 170, strength: same ? 0.6 : 0.06, bias: degree[a] / (degree[a] + degree[b]) };
  });

  // Start: earlier positions, else beside an already placed neighbour, else
  // a sunflower spiral around the project's spot.
  const placed = new Array<boolean>(n).fill(false);
  nodes.forEach((node, i) => {
    const p = start.get(node.id);
    if (p) {
      xs[i] = p.x;
      ys[i] = p.y;
      placed[i] = true;
    }
  });
  const perCluster = new Map<string, number>();
  nodes.forEach((node, i) => {
    if (placed[i]) return;
    const k = perCluster.get(node.cluster) ?? 0;
    perCluster.set(node.cluster, k + 1);
    const friend = springs.find((s) => (s.a === i && placed[s.b]) || (s.b === i && placed[s.a]));
    const base = friend ? { x: xs[friend.a === i ? friend.b : friend.a], y: ys[friend.a === i ? friend.b : friend.a] } : centres.get(node.cluster)!;
    const r = friend ? 30 : 18 * Math.sqrt(k + 0.5);
    xs[i] = base.x + r * Math.cos(k * GOLDEN + i);
    ys[i] = base.y + r * Math.sin(k * GOLDEN + i);
  });

  const tick = (alpha: number) => {
    for (const [i, p] of held) {
      xs[i] = p.x;
      ys[i] = p.y;
    }
    // Links.
    for (const s of springs) {
      let x = xs[s.b] + vx[s.b] - xs[s.a] - vx[s.a];
      let y = ys[s.b] + vy[s.b] - ys[s.a] - vy[s.a];
      let l = Math.sqrt(x * x + y * y) || 1e-6;
      l = ((l - s.length) / l) * alpha * s.strength;
      x *= l;
      y *= l;
      vx[s.b] -= x * s.bias;
      vy[s.b] -= y * s.bias;
      vx[s.a] += x * (1 - s.bias);
      vy[s.a] += y * (1 - s.bias);
    }
    // Charge and collision.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let x = xs[j] - xs[i];
        let y = ys[j] - ys[i];
        if (x === 0 && y === 0) {
          x = 0.01 * (((i + j) % 3) - 1 || 1);
          y = 0.01;
        }
        const d2 = x * x + y * y;
        if (d2 < CHARGE_REACH * CHARGE_REACH) {
          const w = (CHARGE * alpha) / Math.max(d2, 25);
          vx[i] += x * w;
          vy[i] += y * w;
          vx[j] -= x * w;
          vy[j] -= y * w;
        }
        const r = nodes[i].radius + nodes[j].radius + COLLIDE_GAP;
        if (d2 < r * r) {
          const d = Math.sqrt(d2);
          const push = ((r - d) / d) * 0.5;
          vx[i] -= x * push;
          vy[i] -= y * push;
          vx[j] += x * push;
          vy[j] += y * push;
        }
      }
    }
    // Pull to the project's spot.
    nodes.forEach((node, i) => {
      const c = centres.get(node.cluster)!;
      vx[i] += (c.x - xs[i]) * PULL * alpha;
      vy[i] += (c.y - ys[i]) * PULL * alpha;
    });
    for (let i = 0; i < n; i++) {
      const p = held.get(i);
      if (p) {
        xs[i] = p.x;
        ys[i] = p.y;
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }
      vx[i] *= 1 - VELOCITY_DECAY;
      vy[i] *= 1 - VELOCITY_DECAY;
      xs[i] += vx[i];
      ys[i] += vy[i];
    }
  };

  return {
    tick,
    fix(id, at) {
      const i = index.get(id);
      if (i === undefined) return;
      if (at) {
        held.set(i, at);
        xs[i] = at.x;
        ys[i] = at.y;
        vx[i] = 0;
        vy[i] = 0;
      } else held.delete(i);
    },
    positions() {
      const out = new Map<number, Point>();
      nodes.forEach((node, i) => out.set(node.id, { x: xs[i], y: ys[i] }));
      return out;
    },
  };
}

/** Runs the simulation to rest. With `start`, it only settles (no reshuffle). */
export function layoutGraph(
  nodes: SimNode[],
  links: [number, number][],
  start?: Map<number, Point>
): Map<number, Point> {
  if (nodes.length === 0) return new Map();
  const sim = createSim(nodes, links, start);
  let alpha = start && start.size > 0 ? 0.5 : 1;
  while (alpha >= ALPHA_MIN) {
    alpha += (0 - alpha) * ALPHA_DECAY;
    sim.tick(alpha);
  }
  return sim.positions();
}

export interface LabelCandidate {
  id: number;
  /** Centre of the text's baseline, in graph units. */
  x: number;
  y: number;
  text: string;
  /** Font size, in graph units. */
  size: number;
  priority: number;
  /** Drawn whatever it covers (the selection). */
  force?: boolean;
}

/** Which labels to draw: by priority, a label that would cover one already
 *  placed is left out, so what is written can be read. */
export function placeLabels(candidates: LabelCandidate[]): Set<number> {
  const box = (l: LabelCandidate) => {
    const w = l.text.length * l.size * 0.56 + 0.6 * l.size;
    return { x0: l.x - w / 2, x1: l.x + w / 2, y0: l.y - 1.3 * l.size, y1: l.y + 0.3 * l.size };
  };
  const order = [...candidates].sort((a, b) => Number(!!b.force) - Number(!!a.force) || b.priority - a.priority);
  const placed: ReturnType<typeof box>[] = [];
  const out = new Set<number>();
  for (const l of order) {
    const b = box(l);
    if (!l.force && placed.some((p) => b.x0 < p.x1 && p.x0 < b.x1 && b.y0 < p.y1 && p.y0 < b.y1)) continue;
    placed.push(b);
    out.add(l.id);
  }
  return out;
}

/** A project file as the graph needs it (see useProjectDocs). */
export interface GraphDoc {
  key: string;
  projectId: number;
  projectName: string;
  rel: string;
  title: string;
  /** Other files of the same folder it links to. */
  links: string[];
}

export interface GraphItem {
  /** Articles keep their id; files get negative ids. */
  id: number;
  /** What opening it means: the article id, or the file key. */
  ref: number | string;
  title: string;
  project_id: number | null;
  project_name?: string;
  folder_id: number | null;
  tags: string[];
  file?: boolean;
  /** Text the graph's filter searches. */
  search: string;
}

/** Articles and project files in one graph: links between articles, from
 *  articles to files, and between files (relative Markdown links). */
export function buildWikiGraph(
  articles: (WikiArticleLike & { tags?: string[]; project_name?: string })[],
  docs: GraphDoc[],
  index: LinkIndex
): { items: GraphItem[]; edges: [number, number][] } {
  const items: GraphItem[] = articles.map((a) => ({
    id: a.id,
    ref: a.id,
    title: a.title,
    project_id: a.project_id,
    project_name: a.project_name,
    folder_id: a.folder_id,
    tags: a.tags ?? [],
    search: `${a.title} ${(a.tags ?? []).join(" ")}`.toLowerCase(),
  }));
  const fileId = new Map<string, number>();
  [...docs]
    .sort((x, y) => x.key.localeCompare(y.key))
    .forEach((d, i) => {
      fileId.set(d.key, -(i + 1));
      items.push({
        id: -(i + 1),
        ref: d.key,
        title: d.rel.split("/").pop() ?? d.rel,
        project_id: d.projectId,
        project_name: d.projectName,
        folder_id: null,
        tags: [],
        file: true,
        search: `${d.rel} ${d.title}`.toLowerCase(),
      });
    });

  const seen = new Set<string>();
  const edges: [number, number][] = [];
  const add = (a: number | undefined, b: number | undefined) => {
    if (a === undefined || b === undefined || a === b) return;
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}:${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push([x, y]);
  };
  const articleIds = new Set(articles.map((a) => a.id));
  for (const [src, targets] of index.outgoing) {
    if (!articleIds.has(src)) continue;
    for (const dst of targets.keys()) if (articleIds.has(dst)) add(src, dst);
  }
  for (const [src, files] of index.fileOutgoing) {
    if (!articleIds.has(src)) continue;
    for (const key of files.keys()) add(src, fileId.get(key));
  }
  for (const d of docs) {
    for (const rel of d.links) add(fileId.get(d.key), fileId.get(`file:${d.projectId}:${rel}`));
  }
  return { items, edges };
}

/** `id` and everything one link away from it. */
export function neighbourhood(id: number, edges: [number, number][]): Set<number> {
  const keep = new Set([id]);
  for (const [a, b] of edges) {
    if (a === id) keep.add(b);
    if (b === id) keep.add(a);
  }
  return keep;
}
