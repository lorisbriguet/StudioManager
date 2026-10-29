import { useId, useMemo, useState } from "react";
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
import { Button, PANEL_TOP_BAR, TabItem, IconButton, SectionLabel, Tooltip, EmptyState, Card, ICONS, ICON_SIZE } from "../ui";
import { TabList, tabIds } from "../ui/TabItem";
import { useProjectDoc, type ProjectDoc } from "../../db/hooks/useProjectDocs";

function SnippetText({ s }: { s: Snippet }) {
  return (
    <span className="block mt-1 text-xs leading-relaxed text-muted">
      {s.before}
      <mark className="bg-accent-light text-accent-text rounded px-0.5">{s.mark}</mark>
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

/** One-line rows (outgoing links, outline). */
const ROW =
  "w-full flex items-center gap-1.5 h-7 px-2 rounded-md text-sm text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] transition-colors";

type PanelTab = "links" | "outline";

/** The side panel's tabs; `idBase` (from useId) wires each tab to the panel below it. */
function PanelTabs({ tab, onTab, idBase }: { tab: PanelTab; onTab: (tab: PanelTab) => void; idBase: string }) {
  const t = useT();
  const links = tabIds(idBase, "links");
  const outline = tabIds(idBase, "outline");
  return (
    <TabList label={t.wiki_side_panel} className={`${PANEL_TOP_BAR} px-1.5 border-[var(--color-border)]`}>
      <TabItem role="tab" id={links.tab} controls={links.panel} label={t.wiki_links} active={tab === "links"} onActivate={() => onTab("links")} />
      <TabItem role="tab" id={outline.tab} controls={outline.panel} label={t.wiki_outline} active={tab === "outline"} onActivate={() => onTab("outline")} />
    </TabList>
  );
}

/** role/id/aria-labelledby for the panel of the active tab. */
function panelProps(idBase: string, tab: PanelTab) {
  const ids = tabIds(idBase, tab);
  return { role: "tabpanel", id: ids.panel, "aria-labelledby": ids.tab } as const;
}

function OutlineList({ outline, onOutline }: { outline: OutlineItem[]; onOutline: (headingIndex: number) => void }) {
  const t = useT();
  return (
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
            className={`${ROW} block truncate`}
            style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
          >
            {h.text}
          </button>
        ))
      )}
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
      <SectionLabel as="span" className="mb-2" action={<IconButton icon={ICONS.maximize} label={t.wiki_open_graph} onClick={onOpenGraph} />}>
        {t.wiki_local_graph}
      </SectionLabel>
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

/** An article that links here, with up to two snippets: an inset card. */
function SourceCard({
  src,
  snippets,
  colors,
  projectName,
  onClick,
}: {
  src: WikiArticleWithTags;
  snippets: Snippet[];
  colors: Map<number, string>;
  /** Shown on the right when the source is in another project. */
  projectName?: string | null;
  onClick: (e: React.MouseEvent) => void;
}) {
  const t = useT();
  return (
    <Tooltip content={t.wiki_new_tab_hint}>
      <Card as="button" tone="inset" padding="sm" interactive onClick={onClick} className="w-full text-left">
        <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
          <span aria-hidden="true" className="dot-sm shrink-0" style={{ background: colorFor(colors, src.project_id) }} />
          <span className="truncate">{src.title}</span>
          {projectName && <span className="ml-auto text-xs font-normal text-muted truncate">{projectName}</span>}
        </span>
        {snippets.slice(0, 2).map((s, i) => (
          <SnippetText key={i} s={s} />
        ))}
      </Card>
    </Tooltip>
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
  const [tab, setTab] = useState<PanelTab>("links");
  const idBase = useId();
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
      <PanelTabs tab={tab} onTab={setTab} idBase={idBase} />

      {tab === "outline" ? (
        <div {...panelProps(idBase, tab)} className="flex-1 overflow-y-auto p-3">
          <OutlineList outline={outline} onOutline={onOutline} />
        </div>
      ) : (
        <div {...panelProps(idBase, tab)} className="flex-1 overflow-y-auto p-3 space-y-5">
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
                    <SourceCard
                      key={b.sourceId}
                      src={src}
                      snippets={b.snippets}
                      colors={colors}
                      projectName={src.project_id !== article.project_id ? src.project_name : null}
                      onClick={open(b.sourceId)}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <section aria-label={t.wiki_outgoing}>
            <SectionLabel className="mb-2">
              {t.wiki_outgoing} · {outgoing.length + outgoingFiles.length}
            </SectionLabel>
            {outgoing.length + outgoingFiles.length === 0 ? (
              <EmptyState size="sm" message={t.wiki_no_outgoing} />
            ) : (
              <>
                {outgoing.map(([id, count]) => {
                  const dst = byId.get(id);
                  if (!dst) return null;
                  return (
                    <button key={id} type="button" onClick={open(id)} className={ROW}>
                      <ICONS.goToLinked size={ICON_SIZE.menu} className="shrink-0 text-muted" />
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
                    className={ROW}
                  >
                    <ICONS.file size={ICON_SIZE.menu} className="shrink-0 text-muted" />
                    <span className="flex-1 truncate">{docsByKey.get(key)?.rel ?? key.split(":").slice(2).join(":")}</span>
                  </button>
                ))}
              </>
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
                      <button
                        type="button"
                        onClick={open(u.sourceId)}
                        className="flex items-center gap-1.5 max-w-full text-sm font-medium text-left text-[var(--color-text)] hover:underline"
                      >
                        <span aria-hidden="true" className="dot-sm shrink-0" style={{ background: colorFor(colors, src.project_id) }} />
                        <span className="truncate">{src.title}</span>
                      </button>
                      <SnippetText s={u.snippet} />
                      <Button variant="link" onClick={() => onLinkIt(u.sourceId)} className="mt-1.5">
                        {t.wiki_link_it}
                      </Button>
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
  const [tab, setTab] = useState<PanelTab>("links");
  const idBase = useId();
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
      <PanelTabs tab={tab} onTab={setTab} idBase={idBase} />
      <div {...panelProps(idBase, tab)} className="flex-1 overflow-y-auto p-3">
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
                      <SourceCard
                        key={b.sourceId}
                        src={src}
                        snippets={b.snippets}
                        colors={colors}
                        onClick={(e) => onOpen(b.sourceId, e.metaKey || e.ctrlKey)}
                      />
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
                    className={ROW}
                  >
                    <ICONS.file size={ICON_SIZE.menu} className="shrink-0 text-muted" />
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
