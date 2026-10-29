import { ChevronLeft, ChevronRight, FolderOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { notify } from "../../lib/notify";
import { useT } from "../../i18n/useT";
import { parseWikiArticleId, parseWikiFileKey } from "../../lib/wikiLinks";
import { useProjectDoc, type ProjectDoc } from "../../db/hooks/useProjectDocs";
import type { WikiRef } from "../../lib/wikiTabs";
import { EmptyState, PANEL_TOP_BAR, IconButton, HEADING_1 } from "../ui";
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
  onOpenRef: (ref: WikiRef, newTab: boolean) => void;
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
    const newTab = e.metaKey || e.ctrlKey;
    const fileKey = parseWikiFileKey(href);
    if (fileKey) return onOpenRef(fileKey, newTab);
    const id = parseWikiArticleId(href);
    if (id !== null) return onOpenRef(id, newTab);
    if (/^https?:\/\//i.test(href)) {
      openUrl(href).catch((err) => {
        notify.error(t.failed_to_open_url, err);
      });
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={`${PANEL_TOP_BAR} gap-1 px-3 border-[var(--color-border-divider)]`}>
        <IconButton icon={ChevronLeft} label={t.wiki_back} onClick={nav.onBack} disabled={!nav.canBack} />
        <IconButton icon={ChevronRight} label={t.wiki_forward} onClick={nav.onForward} disabled={!nav.canForward} />
        <div className="flex-1 min-w-0 text-center text-xs text-muted truncate">
          {doc.projectName} <span className="opacity-50">/</span> <span className="text-[var(--color-text)]">{doc.rel}</span>
        </div>
        <IconButton
          icon={FolderOpen}
          label={t.wiki_show_in_finder}
          onClick={() =>
            invoke("open_in_finder", { path }).catch((err) => {
              notify.error(t.failed_open_folder, err);
            })
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-[720px] mx-auto">
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
              {/* The page's h1, like an article title, unless the file opens with its own `# …`. */}
              {!startsWithH1(content.html) && <h1 className={`${HEADING_1} mb-3`}>{fileName}</h1>}
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
