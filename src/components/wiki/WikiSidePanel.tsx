import { useMemo, type ReactNode } from "react";
import { useT } from "../../i18n/useT";
import type { WikiArticleWithTags } from "../../types/wiki";
import { extractOutline, findUnlinkedMentions, type LinkIndex, type OutlineItem, type Snippet } from "../../lib/wikiGraph";
import { colorFor } from "./wikiColors";
import { Button, SectionLabel, Tooltip, ICONS, ICON_SIZE } from "../ui";
import { useProjectDoc, type ProjectDoc } from "../../db/hooks/useProjectDocs";

function SnippetText({ s }: { s: Snippet }) {
  return (
    <span className="block text-xs leading-relaxed">
      {s.before}
      <mark className="bg-accent-light text-accent-text rounded px-0.5">{s.mark}</mark>
      {s.after}
    </span>
  );
}

/**
 * The side column is flat like a Table: each section is a group row (SectionLabel
 * and its plain count, over the header line), then 36px rows with hairlines.
 */
const ROW =
  "focus-accent w-full h-9 flex items-center gap-1.5 px-2 border-b border-[var(--color-border-divider)] text-sm text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] transition-colors";
/** A section's message when it has nothing (no backlinks yet). */
const EMPTY_ROW = "h-9 flex items-center px-2 border-b border-[var(--color-border-divider)] text-xs text-muted";

function Section({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <div className="h-8 flex items-center px-2 border-b border-[var(--color-border)]">
        <SectionLabel as="h2" count={count}>
          {label}
        </SectionLabel>
      </div>
      {children}
    </section>
  );
}

/** A row that opens an article; its snippets show in a tooltip. */
function SourceRow({
  src,
  snippets,
  colors,
  projectName,
  onClick,
  action,
}: {
  src: WikiArticleWithTags;
  snippets: Snippet[];
  colors: Map<number, string>;
  /** Shown on the right when the source is in another project. */
  projectName?: string | null;
  onClick: () => void;
  /** A button on the right of the row (Link it). */
  action?: ReactNode;
}) {
  const row = (
    <button type="button" onClick={onClick} className={`${ROW} ${action ? "pr-16" : ""}`}>
      <span aria-hidden="true" className="dot-sm shrink-0" style={{ background: colorFor(colors, src.project_id) }} />
      <span className="flex-1 truncate">{src.title}</span>
      {projectName && <span className="text-xs text-muted truncate max-w-24">{projectName}</span>}
    </button>
  );
  const shown = snippets.slice(0, 2);
  return (
    <div className="relative">
      {shown.length > 0 ? (
        <Tooltip
          content={
            <span className="block space-y-1 max-w-64">
              {shown.map((s, i) => (
                <SnippetText key={i} s={s} />
              ))}
            </span>
          }
        >
          {row}
        </Tooltip>
      ) : (
        row
      )}
      {action && <span className="absolute right-2 top-1/2 -translate-y-1/2">{action}</span>}
    </div>
  );
}

function OutlineRows({ outline, onOutline }: { outline: OutlineItem[]; onOutline: (headingIndex: number) => void }) {
  const t = useT();
  return (
    <Section label={t.wiki_outline}>
      {outline.length === 0 ? (
        <p className={EMPTY_ROW}>{t.wiki_no_headings}</p>
      ) : (
        outline.map((h) => (
          <button
            key={h.index}
            type="button"
            onClick={() => onOutline(h.index)}
            className={ROW}
            style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
          >
            <span className="truncate">{h.text}</span>
          </button>
        ))
      )}
    </Section>
  );
}

/** The side column's frame: beside the article, split from it by the column line. */
function Column({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <aside
      aria-label={t.wiki_side_panel}
      className="w-58 shrink-0 flex flex-col min-h-0 overflow-y-auto space-y-3 border-l border-[var(--color-border-divider)] pl-8"
    >
      {children}
    </aside>
  );
}

export function WikiSidePanel({
  article,
  articles,
  content,
  index,
  colors,
  onOpen,
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
  onOpen: (id: number) => void;
  onLinkIt: (sourceId: number) => void;
  onOutline: (headingIndex: number) => void;
  /** Project files, to name the ones this article links to. */
  docs?: ProjectDoc[];
  onOpenFile?: (key: string) => void;
}) {
  const t = useT();
  const docsByKey = useMemo(() => new Map(docs.map((d) => [d.key, d])), [docs]);
  const outgoingFiles = [...(index.fileOutgoing.get(article.id) ?? new Map<string, number>()).keys()];
  const byId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const backlinks = index.backlinks.get(article.id) ?? [];
  const outgoing = [...(index.outgoing.get(article.id) ?? new Map<number, number>())];
  const unlinked = useMemo(() => findUnlinkedMentions(articles, article, index), [articles, article, index]);
  const html = content ?? article.content;
  const outline = useMemo(() => extractOutline(html), [html]);

  return (
    <Column>
      <Section label={t.wiki_backlinks} count={backlinks.length}>
        {backlinks.length === 0 ? (
          <p className={EMPTY_ROW}>{t.wiki_no_backlinks}</p>
        ) : (
          backlinks.map((b) => {
            const src = byId.get(b.sourceId);
            if (!src) return null;
            return (
              <SourceRow
                key={b.sourceId}
                src={src}
                snippets={b.snippets}
                colors={colors}
                projectName={src.project_id !== article.project_id ? src.project_name : null}
                onClick={() => onOpen(b.sourceId)}
              />
            );
          })
        )}
      </Section>

      <Section label={t.wiki_outgoing} count={outgoing.length + outgoingFiles.length}>
        {outgoing.length + outgoingFiles.length === 0 ? (
          <p className={EMPTY_ROW}>{t.wiki_no_outgoing}</p>
        ) : (
          <>
            {outgoing.map(([id, count]) => {
              const dst = byId.get(id);
              if (!dst) return null;
              return (
                <button key={id} type="button" onClick={() => onOpen(id)} className={ROW}>
                  <span className="flex-1 truncate">{dst.title}</span>
                  {dst.project_id !== article.project_id && dst.project_name && (
                    <span className="text-xs text-muted truncate max-w-24">{dst.project_name}</span>
                  )}
                  {count > 1 && <span className="text-xs text-muted tabular-nums">{count}</span>}
                </button>
              );
            })}
            {outgoingFiles.map((key) => (
              <button key={key} type="button" onClick={() => onOpenFile?.(key)} className={ROW}>
                <ICONS.file size={ICON_SIZE.menu} className="shrink-0 text-muted" />
                <span className="flex-1 truncate">{docsByKey.get(key)?.rel ?? key.split(":").slice(2).join(":")}</span>
              </button>
            ))}
          </>
        )}
      </Section>

      <OutlineRows outline={outline} onOutline={onOutline} />

      {unlinked.length > 0 && (
        <Section label={t.wiki_unlinked} count={unlinked.length}>
          {unlinked.map((u) => {
            const src = byId.get(u.sourceId);
            if (!src) return null;
            return (
              <SourceRow
                key={u.sourceId}
                src={src}
                snippets={[u.snippet]}
                colors={colors}
                onClick={() => onOpen(u.sourceId)}
                action={
                  <Button variant="link" onClick={() => onLinkIt(u.sourceId)}>
                    {t.wiki_link_it}
                  </Button>
                }
              />
            );
          })}
        </Section>
      )}
    </Column>
  );
}

/** Side column of a project file: which articles link to it, the files it links to, its outline. */
export function DocSidePanel({
  doc,
  docs,
  articles,
  index,
  colors,
  onOpen,
  onOpenFile,
  onOutline,
}: {
  doc: ProjectDoc;
  docs: ProjectDoc[];
  articles: WikiArticleWithTags[];
  index: LinkIndex;
  colors: Map<number, string>;
  onOpen: (id: number) => void;
  onOpenFile: (key: string) => void;
  onOutline: (headingIndex: number) => void;
}) {
  const t = useT();
  const { data: content } = useProjectDoc(doc);
  const byId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const linkedFrom = index.fileBacklinks.get(doc.key) ?? [];
  const outline = useMemo(() => extractOutline(content?.html ?? ""), [content?.html]);
  const linkedFiles = docs.filter((d) => doc.links.includes(d.rel) && d.projectId === doc.projectId);

  return (
    <Column>
      <Section label={t.wiki_linked_from} count={linkedFrom.length}>
        {linkedFrom.length === 0 ? (
          <p className={EMPTY_ROW}>{t.wiki_no_file_links}</p>
        ) : (
          linkedFrom.map((b) => {
            const src = byId.get(b.sourceId);
            if (!src) return null;
            return <SourceRow key={b.sourceId} src={src} snippets={b.snippets} colors={colors} onClick={() => onOpen(b.sourceId)} />;
          })
        )}
      </Section>
      {linkedFiles.length > 0 && (
        <Section label={t.wiki_outgoing} count={linkedFiles.length}>
          {linkedFiles.map((d) => (
            <button key={d.key} type="button" onClick={() => onOpenFile(d.key)} className={ROW}>
              <ICONS.file size={ICON_SIZE.menu} className="shrink-0 text-muted" />
              <span className="flex-1 truncate">{d.rel}</span>
            </button>
          ))}
        </Section>
      )}
      <OutlineRows outline={outline} onOutline={onOutline} />
    </Column>
  );
}
