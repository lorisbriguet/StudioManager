import { openExternal, revealPath } from "../../lib/openExternal";
import { notify } from "../../lib/notify";
import { useT } from "../../i18n/useT";
import { parseWikiArticleId, parseWikiFileKey } from "../../lib/wikiLinks";
import { useProjectDoc, type ProjectDoc } from "../../db/hooks/useProjectDocs";
import type { WikiRef } from "../../lib/wikiTabs";
import { EmptyState, FORM_WIDTH, IconButton, HEADING_1, ICONS } from "../ui";
import { WIKI_HEADER_ROW } from "./wikiLayout";
import { Skeleton } from "../ui/Skeleton";

/** True when the rendered Markdown opens with its own level-1 title (`# …`). */
function startsWithH1(html: string): boolean {
  return /^\s*<h1[\s>]/i.test(html);
}

/**
 * A project's Markdown file, read-only, straight from disk. The HTML comes
 * from the app's Rust side, which escapes raw HTML and keeps only web links
 * and links to other Markdown files, so it is safe to insert as is.
 */
export function DocView({
  doc,
  nav,
  onOpenRef,
}: {
  doc: ProjectDoc;
  nav: { canBack: boolean; canForward: boolean; onBack: () => void; onForward: () => void };
  onOpenRef: (ref: WikiRef) => void;
}) {
  const t = useT();
  const { data: content, isLoading, isError } = useProjectDoc(doc);
  const path = `${doc.folder.replace(/\/$/, "")}/${doc.rel}`;
  const fileName = doc.rel.split("/").pop() ?? doc.rel;

  const handleClick = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    const fileKey = parseWikiFileKey(href);
    if (fileKey) return onOpenRef(fileKey);
    const id = parseWikiArticleId(href);
    if (id !== null) return onOpenRef(id);
    if (/^https?:\/\//i.test(href)) {
      openExternal(href).catch((err) => {
        notify.error(t.failed_to_open_url, err);
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* One header row over the header line, like the article's. */}
      <div className={WIKI_HEADER_ROW}>
        <IconButton icon={ICONS.prev} label={t.wiki_back} onClick={nav.onBack} disabled={!nav.canBack} />
        <IconButton icon={ICONS.next} label={t.wiki_forward} onClick={nav.onForward} disabled={!nav.canForward} />
        <div className="flex-1 min-w-0 truncate">
          {doc.projectName} <span className="opacity-50">/</span> <span className="text-[var(--color-text)]">{doc.rel}</span>
        </div>
        <IconButton
          icon={ICONS.openFolder}
          label={t.wiki_show_in_finder}
          onClick={() =>
            revealPath(path).catch((err) => {
              notify.error(t.failed_open_folder, err);
            })
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto py-6">
        <div className={FORM_WIDTH}>
          <p className="text-xs text-muted mb-6">{t.wiki_file_read_only}</p>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton width="50%" height={20} rounded="md" />
              <Skeleton width="90%" height={14} rounded="md" />
              <Skeleton width="80%" height={14} rounded="md" />
            </div>
          ) : isError || !content ? (
            <EmptyState message={t.wiki_file_unreadable} />
          ) : (
            <>
              {/* The file's title, like an article title, unless the file opens with its own `# …`. */}
              {!startsWithH1(content.html) && <h2 className={`${HEADING_1} mb-3`}>{fileName}</h2>}
              <div className="tiptap-editor is-reading" onClick={handleClick}>
                <div className="ProseMirror wiki-doc" dangerouslySetInnerHTML={{ __html: content.html }} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
