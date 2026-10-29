import { useMemo, useState } from "react";
import { ArrowUpRight, File, Maximize2 } from "lucide-react";
import { useT } from "../../i18n/useT";
import type { WikiArticleWithTags } from "../../types/wiki";
import {
  buildWikiGraph,
  extractOutline,
  findUnlinkedMentions,
  neighbourhood,
  type LinkIndex,
  type Snippet,
} from "../../lib/wikiGraph";
import { GraphView } from "./GraphView";
import { colorFor } from "./wikiColors";
import { PANEL_TOP_BAR, TabItem, IconButton, SectionLabel, Tooltip, EmptyState, Card } from "../ui";
import { useProjectDoc, type ProjectDoc } from "../../db/hooks/useProjectDocs";

function SnippetText({ s }: { s: Snippet }) {
  return (
    <span className="block mt-1 text-xs leading-relaxed text-muted">
      {s.before}
      <mark className="bg-accent-light text-accent rounded px-0.5">{s.mark}</mark>
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

export function WikiSidePanel({
  article,
  articles,
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
  const outline = useMemo(() => extractOutline(article.content), [article.content]);

  const local = useMemo(() => localGraph(buildWikiGraph(articles, docs, index), article.id), [articles, docs, index, article.id]);

  const open = (id: number) => (e: React.MouseEvent) => onOpen(id, e.metaKey || e.ctrlKey);

  return (
    <aside
      aria-label={t.wiki_side_panel}
      className="w-72 shrink-0 flex flex-col min-h-0 border-l border-[var(--color-border-divider)]"
    >
      <div role="tablist" aria-label={t.wiki_side_panel} className={`${PANEL_TOP_BAR} px-1.5 border-[var(--color-border-divider)]`}>
        <TabItem role="tab" label={t.wiki_links} active={tab === "links"} onActivate={() => setTab("links")} />
        <TabItem role="tab" label={t.wiki_outline} active={tab === "outline"} onActivate={() => setTab("outline")} />
      </div>

      {tab === "outline" ? (
        <div className="flex-1 overflow-y-auto p-3">
          <SectionLabel className="mb-2">{t.wiki_outline}</SectionLabel>
          {outline.length === 0 ? (
            <EmptyState size="sm" message={t.wiki_no_headings} />
          ) : (
            outline.map((h) => (
              <button
                key={h.index}
                onClick={() => onOutline(h.index)}
                className="w-full text-left truncate h-7 px-2 rounded-md text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
                style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
              >
                {h.text}
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-5">
          <section aria-label={t.wiki_local_graph}>
            <SectionLabel as="span" className="mb-2" action={<IconButton icon={Maximize2} label={t.wiki_open_graph} onClick={onOpenGraph} />}>
              {t.wiki_local_graph}
            </SectionLabel>
            <div className="h-44 rounded-xl border border-[var(--color-border-divider)] bg-[var(--color-bg)]">
              <GraphView
                compact
                nodes={local.nodes}
                edges={local.edges}
                colors={colors}
                focusId={article.id}
                onOpen={(id, newTab) => {
                  const ref = local.refOf.get(id);
                  if (typeof ref === "number") onOpen(ref, newTab);
                  else if (ref) onOpenFile?.(ref, newTab);
                }}
                label={`${t.wiki_local_graph}: ${article.title}`}
              />
            </div>
          </section>

          <section aria-label={t.wiki_backlinks}>
            <SectionLabel className="mb-2">
              {t.wiki_backlinks} · {backlinks.length}
            </SectionLabel>
            {backlinks.length === 0 ? (
              <EmptyState size="sm" message={t.wiki_no_backlinks} />
            ) : (
              <div className="space-y-1.5">
                {backlinks.map((b) => {
                  const src = byId.get(b.sourceId);
                  if (!src) return null;
                  return (
                    <Tooltip key={b.sourceId} content={t.wiki_new_tab_hint}>
                    <Card
                      as="button"
                      tone="inset"
                      padding="sm"
                      interactive
                      onClick={open(b.sourceId)}
                      className="w-full text-left"
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
                    </Card>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-label={t.wiki_outgoing}>
            <SectionLabel className="mb-2">
              {t.wiki_outgoing} · {outgoing.length + outgoingFiles.length}
            </SectionLabel>
            {outgoingFiles.map((key) => (
              <button
                key={key}
                type="button"
                onClick={(e) => onOpenFile?.(key, e.metaKey || e.ctrlKey)}
                className="w-full flex items-center gap-1.5 py-1.5 px-3 rounded-md text-xs text-left text-muted hover:bg-[var(--color-hover-row)]"
              >
                <File size={14} className="shrink-0" />
                <span className="flex-1 truncate">{docsByKey.get(key)?.rel ?? key.split(":").slice(2).join(":")}</span>
              </button>
            ))}
            {outgoing.length + outgoingFiles.length === 0 ? (
              <EmptyState size="sm" message={t.wiki_no_outgoing} />
            ) : (
              outgoing.map(([id, count]) => {
                const dst = byId.get(id);
                if (!dst) return null;
                return (
                  <button
                    key={id}
                    onClick={open(id)}
                    className="w-full flex items-center gap-1.5 h-7 px-2 rounded-md text-sm text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
                  >
                    <ArrowUpRight size={14} className="shrink-0 text-muted" />
                    <span className="flex-1 truncate">{dst.title}</span>
                    {dst.project_id !== article.project_id && dst.project_name && (
                      <span className="text-xs text-muted truncate max-w-24">{dst.project_name}</span>
                    )}
                    {count > 1 && <span className="text-xs text-muted">{count}</span>}
                  </button>
                );
              })
            )}
          </section>

          {unlinked.length > 0 && (
            <section aria-label={t.wiki_unlinked}>
              <SectionLabel className="mb-2">
                {t.wiki_unlinked} · {unlinked.length}
              </SectionLabel>
              <div className="space-y-1.5">
                {unlinked.map((u) => {
                  const src = byId.get(u.sourceId);
                  if (!src) return null;
                  return (
                    <Card key={u.sourceId} tone="dashed" padding="sm">
                      <button onClick={open(u.sourceId)} className="text-sm font-medium text-[var(--color-text)] hover:underline">
                        {src.title}
                      </button>
                      <SnippetText s={u.snippet} />
                      <button onClick={() => onLinkIt(u.sourceId)} className="mt-1.5 text-xs text-accent hover:underline">
                        {t.wiki_link_it}
                      </button>
                    </Card>
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
      <div role="tablist" aria-label={t.wiki_side_panel} className={`${PANEL_TOP_BAR} px-1.5 border-[var(--color-border-divider)]`}>
        <TabItem role="tab" label={t.wiki_links} active={tab === "links"} onActivate={() => setTab("links")} />
        <TabItem role="tab" label={t.wiki_outline} active={tab === "outline"} onActivate={() => setTab("outline")} />
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === "outline" ? (
          <>
            <SectionLabel className="mb-2">{t.wiki_outline}</SectionLabel>
            {outline.length === 0 ? (
              <EmptyState size="sm" message={t.wiki_no_headings} />
            ) : (
              outline.map((h) => (
                <button
                  key={h.index}
                  type="button"
                  onClick={() => onOutline(h.index)}
                  className="w-full text-left truncate py-1.5 px-3 rounded-md text-xs text-muted hover:bg-[var(--color-hover-row)]"
                  style={{ paddingLeft: 12 + (h.level - 1) * 12 }}
                >
                  {h.text}
                </button>
              ))
            )}
          </>
        ) : (
          <div className="space-y-5">
          {local && (
            <section aria-label={t.wiki_local_graph}>
              <SectionLabel as="span" className="mb-2" action={<IconButton icon={Maximize2} label={t.wiki_open_graph} onClick={onOpenGraph} />}>
                {t.wiki_local_graph}
              </SectionLabel>
              <div className="h-44 rounded-xl border border-[var(--color-border-divider)] bg-[var(--color-bg)]">
                <GraphView
                  compact
                  nodes={local.nodes}
                  edges={local.edges}
                  colors={colors}
                  focusId={local.id}
                  onOpen={(id, newTab) => {
                    const ref = local.refOf.get(id);
                    if (typeof ref === "number") onOpen(ref, newTab);
                    else if (ref) onOpenFile(ref, newTab);
                  }}
                  label={`${t.wiki_local_graph}: ${doc.rel}`}
                />
              </div>
            </section>
          )}
          <section aria-label={t.wiki_linked_from}>
            <SectionLabel className="mb-2">
              {t.wiki_linked_from} · {linkedFrom.length}
            </SectionLabel>
            {linkedFrom.length === 0 ? (
              <EmptyState size="sm" message={t.wiki_no_file_links} />
            ) : (
              <div className="space-y-1.5">
                {linkedFrom.map((b) => {
                  const src = byId.get(b.sourceId);
                  if (!src) return null;
                  return (
                    <Card
                      key={b.sourceId}
                      as="button"
                      tone="inset"
                      padding="sm"
                      interactive
                      onClick={(e) => onOpen(b.sourceId, e.metaKey || e.ctrlKey)}
                      className="w-full text-left"
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
                        <span aria-hidden="true" className="dot-sm shrink-0" style={{ background: colorFor(colors, src.project_id) }} />
                        <span className="truncate">{src.title}</span>
                      </span>
                      {b.snippets.slice(0, 2).map((s, i) => (
                        <SnippetText key={i} s={s} />
                      ))}
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
          {linkedFiles.length > 0 && (
            <section aria-label={t.wiki_outgoing}>
              <SectionLabel className="mb-2">
                {t.wiki_outgoing} · {linkedFiles.length}
              </SectionLabel>
              {linkedFiles.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={(e) => onOpenFile(d.key, e.metaKey || e.ctrlKey)}
                  className="w-full flex items-center gap-1.5 py-1.5 px-3 rounded-md text-xs text-left text-muted hover:bg-[var(--color-hover-row)]"
                >
                  <File size={14} className="shrink-0" />
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
