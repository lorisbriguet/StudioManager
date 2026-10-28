import { useMemo, useState } from "react";
import { File, FileText, Maximize2 } from "lucide-react";
import { useT } from "../../i18n/useT";
import type { WikiArticleWithTags } from "../../types/wiki";
import {
  buildWikiGraph,
  extractOutline,
  findUnlinkedMentions,
  neighbourhood,
  type LinkIndex,
  type OutlineItem,
  type Snippet,
} from "../../lib/wikiGraph";
import { GraphView } from "./GraphView";
import { colorFor } from "./wikiColors";
import { Button, PANEL_TOP_BAR, SectionLabel, TabItem } from "../ui";
import { useProjectDoc, type ProjectDoc } from "../../db/hooks/useProjectDocs";

function SnippetText({ s }: { s: Snippet }) {
  return (
    <span className="block mt-1 text-xs leading-relaxed text-muted">
      {s.before}
      <mark className="bg-accent-light text-accent rounded-md px-0.5">{s.mark}</mark>
      {s.after}
    </span>
  );
}

/** The graph around one item (`id`), for the side panel. */
function localGraph(graph: ReturnType<typeof buildWikiGraph>, id: number) {
  const keep = neighbourhood(id, graph.edges);
  return {
    nodes: graph.items.filter((i) => keep.has(i.id)),
    edges: graph.edges.filter(([a, b]) => keep.has(a) && keep.has(b)),
    refOf: new Map(graph.items.map((i) => [i.id, i.ref])),
  };
}

/** Panel cards (backlinks, mentions): the compact card of DESIGN-SYSTEM.md. */
const CARD = "w-full text-left px-3 py-2.5 rounded-xl bg-[var(--color-surface)] transition-colors";
/** One-line rows (outgoing links, outline). */
const ROW =
  "w-full flex items-center gap-1.5 h-7 px-2 rounded-md text-sm text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] transition-colors";

function PanelTabs({ tab, onTab }: { tab: "links" | "outline"; onTab: (tab: "links" | "outline") => void }) {
  const t = useT();
  return (
    <div role="tablist" aria-label={t.wiki_side_panel} className={`${PANEL_TOP_BAR} px-1.5 border-[var(--color-border-header)]`}>
      <TabItem role="tab" label={t.wiki_links} active={tab === "links"} onActivate={() => onTab("links")} />
      <TabItem role="tab" label={t.wiki_outline} active={tab === "outline"} onActivate={() => onTab("outline")} />
    </div>
  );
}

function OutlineList({ outline, onOutline }: { outline: OutlineItem[]; onOutline: (headingIndex: number) => void }) {
  const t = useT();
  if (outline.length === 0) return <p className="text-xs text-muted">{t.wiki_no_headings}</p>;
  return (
    <>
      {outline.map((h) => (
        <button
          key={h.index}
          type="button"
          onClick={() => onOutline(h.index)}
          className="block w-full h-7 px-2 rounded-md text-sm text-left truncate text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] transition-colors"
          style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
        >
          {h.text}
        </button>
      ))}
    </>
  );
}

function LocalGraph({
  graph,
  focusId,
  colors,
  title,
  onOpenGraph,
  onOpen,
  onOpenFile,
}: {
  graph: ReturnType<typeof localGraph>;
  focusId: number;
  colors: Map<number, string>;
  title: string;
  onOpenGraph: () => void;
  onOpen: (id: number, newTab: boolean) => void;
  onOpenFile?: (key: string, newTab: boolean) => void;
}) {
  const t = useT();
  return (
    <section aria-label={t.wiki_local_graph}>
      <div className="flex items-center justify-between mb-2">
        <SectionLabel className="">{t.wiki_local_graph}</SectionLabel>
        <button
          type="button"
          onClick={onOpenGraph}
          className="text-muted hover:text-[var(--color-text-secondary)] transition-colors"
          aria-label={t.wiki_open_graph}
          title={t.wiki_open_graph}
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <div className="h-44 rounded-xl border border-[var(--color-border-divider)] bg-[var(--color-bg)]">
        <GraphView
          compact
          nodes={graph.nodes}
          edges={graph.edges}
          colors={colors}
          focusId={focusId}
          onOpen={(id, newTab) => {
            const ref = graph.refOf.get(id);
            if (typeof ref === "number") onOpen(ref, newTab);
            else if (ref) onOpenFile?.(ref, newTab);
          }}
          label={`${t.wiki_local_graph}: ${title}`}
        />
      </div>
    </section>
  );
}

export function WikiSidePanel({
  article,
  articles,
  content,
  index,
  colors,
  onOpen,
  onOpenGraph,
  onLinkIt,
  onOutline,
  docs = [],
  onOpenFile,
}: {
  article: WikiArticleWithTags;
  articles: WikiArticleWithTags[];
  /** The article as it is being typed (defaults to the saved content): the outline follows it. */
  content?: string;
  index: LinkIndex;
  colors: Map<number, string>;
  onOpen: (id: number, newTab: boolean) => void;
  onOpenGraph: () => void;
  onLinkIt: (sourceId: number) => void;
  onOutline: (headingIndex: number) => void;
  /** Project files, to name the ones this article links to. */
  docs?: ProjectDoc[];
  onOpenFile?: (key: string, newTab: boolean) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"links" | "outline">("links");
  const docsByKey = useMemo(() => new Map(docs.map((d) => [d.key, d])), [docs]);
  const outgoingFiles = [...(index.fileOutgoing.get(article.id) ?? new Map<string, number>()).keys()];
  const byId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const backlinks = index.backlinks.get(article.id) ?? [];
  const outgoing = [...(index.outgoing.get(article.id) ?? new Map<number, number>())];
  const unlinked = useMemo(
    () => (tab === "links" ? findUnlinkedMentions(articles, article, index) : []),
    [tab, articles, article, index]
  );
  const html = content ?? article.content;
  const outline = useMemo(() => extractOutline(html), [html]);

  const local = useMemo(() => localGraph(buildWikiGraph(articles, docs, index), article.id), [articles, docs, index, article.id]);

  const open = (id: number) => (e: React.MouseEvent) => onOpen(id, e.metaKey || e.ctrlKey);

  return (
    <aside
      aria-label={t.wiki_side_panel}
      className="w-72 shrink-0 flex flex-col min-h-0 border-l border-[var(--color-border-divider)]"
    >
      <PanelTabs tab={tab} onTab={setTab} />

      {tab === "outline" ? (
        <div className="flex-1 overflow-y-auto p-3">
          <OutlineList outline={outline} onOutline={onOutline} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-5">
          <LocalGraph
            graph={local}
            focusId={article.id}
            colors={colors}
            title={article.title}
            onOpenGraph={onOpenGraph}
            onOpen={onOpen}
            onOpenFile={onOpenFile}
          />

          <section aria-label={t.wiki_backlinks}>
            <SectionLabel>
              {t.wiki_backlinks} · {backlinks.length}
            </SectionLabel>
            {backlinks.length === 0 ? (
              <p className="text-xs text-muted">{t.wiki_no_backlinks}</p>
            ) : (
              <div className="space-y-1.5">
                {backlinks.map((b) => {
                  const src = byId.get(b.sourceId);
                  if (!src) return null;
                  return (
                    <button
                      key={b.sourceId}
                      type="button"
                      onClick={open(b.sourceId)}
                      title={t.wiki_new_tab_hint}
                      className={`${CARD} hover:bg-[var(--color-hover-row)]`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
                        <span aria-hidden="true" className="dot-sm shrink-0" style={{ background: colorFor(colors, src.project_id) }} />
                        <span className="truncate">{src.title}</span>
                        {src.project_name && src.project_id !== article.project_id && (
                          <span className="ml-auto text-xs font-normal text-muted truncate">{src.project_name}</span>
                        )}
                      </span>
                      {b.snippets.slice(0, 2).map((s, i) => (
                        <SnippetText key={i} s={s} />
                      ))}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-label={t.wiki_outgoing}>
            <SectionLabel>
              {t.wiki_outgoing} · {outgoing.length + outgoingFiles.length}
            </SectionLabel>
            {outgoing.length + outgoingFiles.length === 0 ? (
              <p className="text-xs text-muted">{t.wiki_no_outgoing}</p>
            ) : (
              <>
                {outgoing.map(([id, count]) => {
                  const dst = byId.get(id);
                  if (!dst) return null;
                  return (
                    <button key={id} type="button" onClick={open(id)} title={t.wiki_new_tab_hint} className={ROW}>
                      <FileText size={14} className="shrink-0 text-muted" />
                      <span className="flex-1 truncate">{dst.title}</span>
                      {dst.project_id !== article.project_id && dst.project_name && (
                        <span className="text-xs text-muted truncate max-w-24">{dst.project_name}</span>
                      )}
                      {count > 1 && <span className="text-xs text-muted">{count}</span>}
                    </button>
                  );
                })}
                {outgoingFiles.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={(e) => onOpenFile?.(key, e.metaKey || e.ctrlKey)}
                    title={t.wiki_new_tab_hint}
                    className={ROW}
                  >
                    <File size={14} className="shrink-0 text-muted" />
                    <span className="flex-1 truncate">{docsByKey.get(key)?.rel ?? key.split(":").slice(2).join(":")}</span>
                  </button>
                ))}
              </>
            )}
          </section>

          {unlinked.length > 0 && (
            <section aria-label={t.wiki_unlinked}>
              <SectionLabel>
                {t.wiki_unlinked} · {unlinked.length}
              </SectionLabel>
              <div className="space-y-1.5">
                {unlinked.map((u) => {
                  const src = byId.get(u.sourceId);
                  if (!src) return null;
                  return (
                    <div key={u.sourceId} className={CARD}>
                      <button
                        type="button"
                        onClick={open(u.sourceId)}
                        title={t.wiki_new_tab_hint}
                        className="flex items-center gap-1.5 max-w-full text-sm font-medium text-left text-[var(--color-text)] hover:text-accent transition-colors"
                      >
                        <span aria-hidden="true" className="dot-sm shrink-0" style={{ background: colorFor(colors, src.project_id) }} />
                        <span className="truncate">{src.title}</span>
                      </button>
                      <SnippetText s={u.snippet} />
                      <Button variant="link" size="sm" onClick={() => onLinkIt(u.sourceId)} className="mt-1.5">
                        {t.wiki_link_it}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}

/** Side panel of a project file: which articles link to it, and its outline. */
export function DocSidePanel({
  doc,
  docs,
  articles,
  index,
  colors,
  onOpen,
  onOpenFile,
  onOpenGraph,
  onOutline,
}: {
  doc: ProjectDoc;
  docs: ProjectDoc[];
  articles: WikiArticleWithTags[];
  index: LinkIndex;
  colors: Map<number, string>;
  onOpen: (id: number, newTab: boolean) => void;
  onOpenFile: (key: string, newTab: boolean) => void;
  onOpenGraph: () => void;
  onOutline: (headingIndex: number) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"links" | "outline">("links");
  const { data: content } = useProjectDoc(doc);
  const byId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const linkedFrom = index.fileBacklinks.get(doc.key) ?? [];
  const outline = useMemo(() => extractOutline(content?.html ?? ""), [content?.html]);
  const local = useMemo(() => {
    const graph = buildWikiGraph(articles, docs, index);
    const id = graph.items.find((i) => i.ref === doc.key)?.id;
    return id === undefined ? null : { ...localGraph(graph, id), id };
  }, [articles, docs, index, doc.key]);
  const linkedFiles = docs.filter((d) => doc.links.includes(d.rel) && d.projectId === doc.projectId);

  return (
    <aside aria-label={t.wiki_side_panel} className="w-72 shrink-0 flex flex-col min-h-0 border-l border-[var(--color-border-divider)]">
      <PanelTabs tab={tab} onTab={setTab} />
      <div className="flex-1 overflow-y-auto p-3">
        {tab === "outline" ? (
          <OutlineList outline={outline} onOutline={onOutline} />
        ) : (
          <div className="space-y-5">
            {local && (
              <LocalGraph
                graph={local}
                focusId={local.id}
                colors={colors}
                title={doc.rel}
                onOpenGraph={onOpenGraph}
                onOpen={onOpen}
                onOpenFile={onOpenFile}
              />
            )}
            <section aria-label={t.wiki_linked_from}>
              <SectionLabel>
                {t.wiki_linked_from} · {linkedFrom.length}
              </SectionLabel>
              {linkedFrom.length === 0 ? (
                <p className="text-xs text-muted">{t.wiki_no_file_links}</p>
              ) : (
                <div className="space-y-1.5">
                  {linkedFrom.map((b) => {
                    const src = byId.get(b.sourceId);
                    if (!src) return null;
                    return (
                      <button
                        key={b.sourceId}
                        type="button"
                        onClick={(e) => onOpen(b.sourceId, e.metaKey || e.ctrlKey)}
                        title={t.wiki_new_tab_hint}
                        className={`${CARD} hover:bg-[var(--color-hover-row)]`}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
                          <span aria-hidden="true" className="dot-sm shrink-0" style={{ background: colorFor(colors, src.project_id) }} />
                          <span className="truncate">{src.title}</span>
                        </span>
                        {b.snippets.slice(0, 2).map((s, i) => (
                          <SnippetText key={i} s={s} />
                        ))}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
            {linkedFiles.length > 0 && (
              <section aria-label={t.wiki_outgoing}>
                <SectionLabel>
                  {t.wiki_outgoing} · {linkedFiles.length}
                </SectionLabel>
                {linkedFiles.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={(e) => onOpenFile(d.key, e.metaKey || e.ctrlKey)}
                    title={t.wiki_new_tab_hint}
                    className={ROW}
                  >
                    <File size={14} className="shrink-0 text-muted" />
                    <span className="flex-1 truncate">{d.rel}</span>
                  </button>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
