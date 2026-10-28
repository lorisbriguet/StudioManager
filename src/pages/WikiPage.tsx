import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { useSearchParams } from "react-router-dom";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { isAllowedWikiLink, parseWikiArticleId, parseWikiFileKey, wikiFileHref } from "../lib/wikiLinks";
import { logError } from "../lib/log";
import {
  Plus,
  BookOpen,
  Trash2,
  Heading1,
  Heading2,
  Heading3,
  List,
  Link as LinkIcon,
  Minus,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  PanelLeft,
  PanelRight,
  Waypoints,
  File,
} from "lucide-react";
import { deleteWithUndo } from "../lib/undo";
import { toast } from "sonner";
import { useT } from "../i18n/useT";
import { notifyError, getLabels } from "../lib/notifyError";
import { Button, BottomBar, EmptyState, PANEL_TOP_BAR, TabItem, Popover, IconButton, Tag, SectionLabel, Input } from "../components/ui";
import { MENU_ITEM } from "../components/ui/Dropdown";
import { Select } from "../components/ui/Select";
import {
  useWikiFolders,
  useWikiArticles,
  useWikiArticle,
  useCreateWikiArticle,
  useUpdateWikiArticle,
  useDeleteWikiArticle,
  useWikiArticleTags,
  useSetWikiArticleTags,
  useAllWikiTags,
} from "../db/hooks/useWiki";
import { useProjects } from "../db/hooks/useProjects";
import type { WikiFolder } from "../types/wiki";
import { useOrgStore } from "../stores/org-store";
import { buildLinkIndex, linkFirstMention, wordCount } from "../lib/wikiGraph";
import { WikiExplorer } from "../components/wiki/WikiExplorer";
import { WikiGraph } from "../components/wiki/WikiGraph";
import { WikiSidePanel, DocSidePanel } from "../components/wiki/WikiSidePanel";
import { projectColors } from "../components/wiki/wikiColors";
import { closeTab, EMPTY_TABS, openInTabs, pruneTabs, tabArticleId, tabRef, type TabsState, type WikiRef } from "../lib/wikiTabs";
import { useProjectDocs, type ProjectDoc } from "../db/hooks/useProjectDocs";
import { DocView } from "../components/wiki/DocView";

// ─── Slash Command Menu ───────────────────────────────────────────
interface SlashMenuItem {
  label: string;
  icon: typeof Heading1;
  action: (editor: ReturnType<typeof useEditor>) => void;
  /** If true, the action is handled specially by the ArticleEditor */
  special?: string;
}

function getSlashCommands(t: ReturnType<typeof useT>): SlashMenuItem[] {
  return [
    {
      label: t.heading_1,
      icon: Heading1,
      action: (editor) => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: t.heading_2,
      icon: Heading2,
      action: (editor) => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: t.heading_3,
      icon: Heading3,
      action: (editor) => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: t.bulleted_list,
      icon: List,
      action: (editor) => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: t.wiki_divider,
      icon: Minus,
      action: (editor) => editor?.chain().focus().setHorizontalRule().run(),
    },
    {
      label: t.wiki_link,
      icon: LinkIcon,
      action: () => { /* handled specially via LinkInsertPopup */ },
      special: "link",
    },
  ];
}

// ─── Link Insert Popup ───────────────────────────────────────────
interface LinkTarget {
  /** `a:<id>` for an article, the file key for a project file. */
  key: string;
  title: string;
  project_id: number | null;
  project_name?: string;
  href: string;
  file?: boolean;
}

/** Link picker, opened by /link or by typing [[ (then `initialQuery` is
 *  set and articles show before anything is typed). */
function LinkInsertPopup({
  position,
  articles,
  currentArticleId,
  currentProjectId,
  initialQuery,
  onInsert,
  onCreate,
  onClose,
}: {
  position: { top: number; left: number };
  articles: LinkTarget[];
  currentArticleId: number;
  currentProjectId: number | null;
  initialQuery?: string;
  onInsert: (href: string, text: string) => void;
  onCreate?: (title: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const bracket = initialQuery !== undefined;

  const isUrl = /^https?:\/\//.test(query.trim());
  const q = query.trim().toLowerCase();

  const matchedArticles = useMemo(() => {
    if (isUrl || (!q && !bracket)) return [];
    // Same project first, then titles that start with the query.
    const rank = (a: LinkTarget) =>
      (a.project_id === currentProjectId ? 0 : 2) + (a.title.toLowerCase().startsWith(q) ? 0 : 1);
    return articles
      .filter((a) => a.key !== `a:${currentArticleId}` && (!q || a.title.toLowerCase().includes(q)))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 8);
  }, [q, isUrl, bracket, articles, currentArticleId, currentProjectId]);

  const canCreate =
    !!onCreate &&
    !isUrl &&
    q !== "" &&
    !articles.some((a) => !a.file && a.title.toLowerCase() === q && a.project_id === currentProjectId);
  const optionCount = matchedArticles.length + (canCreate ? 1 : 0);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const choose = (i: number) => {
    if (i < matchedArticles.length) {
      const article = matchedArticles[i];
      onInsert(article.href, article.file ? article.title.split("/").pop()! : article.title);
    } else if (canCreate) {
      onCreate!(query.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isUrl) onInsert(query.trim(), "link");
      else if (optionCount > 0) choose(selectedIdx);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (optionCount > 0) setSelectedIdx((i) => (i + 1) % optionCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (optionCount > 0) setSelectedIdx((i) => (i - 1 + optionCount) % optionCount);
    }
  };

  const rowClass = (i: number) =>
    `w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] ${
      i === selectedIdx ? "bg-[var(--color-hover-row)]" : ""
    } hover:bg-[var(--color-hover-row)]`;

  return (
    <Popover
      // Under the caret: `position.top` is the caret's bottom + 4.
      at={{ x: position.left, y: position.top - 4 }}
      onClose={() => onClose()}
      padding="none"
      className="w-80 overflow-hidden"
    >
      <div className="px-3 pt-3 pb-2">
        <Input
          ref={inputRef}
          data-autofocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.link_url_or_article}
          aria-label={t.wiki_link_to_article}
        />
      </div>
      {isUrl && (
        <div className="px-3 pb-2">
          <span className="text-xs text-muted">{t.press_enter_to_insert}</span>
        </div>
      )}
      {optionCount > 0 && (
        <div className="border-t border-[var(--color-border-divider)] py-1 max-h-64 overflow-y-auto">
          <div className="px-3 py-1">
            <SectionLabel as="span">{t.wiki_link_to_article}</SectionLabel>
          </div>
          {matchedArticles.map((article, i) => (
            <button
              key={article.key}
              className={rowClass(i)}
              onMouseEnter={() => setSelectedIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              {article.file ? <File size={14} className="text-muted shrink-0" /> : <BookOpen size={14} className="text-muted shrink-0" />}
              <span className="truncate">{article.title}</span>
              <span className="ml-auto pl-2 text-xs text-muted truncate max-w-32">
                {article.project_id != null && article.project_id === currentProjectId
                  ? t.wiki_this_project
                  : article.project_name ?? ""}
              </span>
            </button>
          ))}
          {canCreate && (
            <button
              className={`${rowClass(matchedArticles.length)} border-t border-[var(--color-border-divider)]`}
              onMouseEnter={() => setSelectedIdx(matchedArticles.length)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(matchedArticles.length);
              }}
            >
              <Plus size={14} className="text-muted shrink-0" />
              <span className="truncate">{t.wiki_new_article_named.replace("{title}", query.trim())}</span>
            </button>
          )}
          <div className="px-3 pt-1 pb-0.5">
            <span className="text-[10px] text-muted">{t.wiki_link_open_hint}</span>
          </div>
        </div>
      )}
      {!isUrl && q && optionCount === 0 && (
        <div className="px-3 pb-2">
          <span className="text-xs text-muted">{t.no_results}</span>
        </div>
      )}
      {!q && !bracket && (
        <div className="px-3 pb-2">
          <span className="text-xs text-muted">{t.link_hint}</span>
        </div>
      )}
    </Popover>
  );
}

function SlashCommandMenu({
  position,
  filter,
  onSelect,
  onClose,
}: {
  position: { top: number; left: number };
  filter: string;
  onSelect: (item: SlashMenuItem) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [selectedIdx, setSelectedIdx] = useState(0);

  const allCommands = useMemo(() => getSlashCommands(t), [t]);

  const filtered = useMemo(() => {
    if (!filter) return allCommands;
    const q = filter.toLowerCase();
    return allCommands.filter((cmd) => cmd.label.toLowerCase().includes(q));
  }, [filter, allCommands]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [filter]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (filtered.length === 0) { if (e.key === "Escape") onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onSelect(filtered[selectedIdx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [selectedIdx, filtered, onSelect, onClose]);

  if (filtered.length === 0) return null;

  return (
    <Popover
      // Under the caret: `position.top` is the caret's bottom + 4.
      at={{ x: position.left, y: position.top - 4 }}
      onClose={() => onClose()}
      autoFocus={false}
      style={{ minWidth: 180 }}
    >
      {filtered.map((cmd, i) => {
        const Icon = cmd.icon;
        return (
          <button
            key={cmd.label}
            className={`${MENU_ITEM} cursor-pointer ${
              i === selectedIdx
                ? "bg-[var(--color-hover-row)] text-[var(--color-text)]"
                : "text-[var(--color-text-secondary)]"
            }`}
            onMouseEnter={() => setSelectedIdx(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(cmd);
            }}
          >
            <Icon size={14} />
            {cmd.label}
          </button>
        );
      })}
    </Popover>
  );
}

// ─── Article Editor ───────────────────────────────────────────────
// Exported for testability (wikiAutosave.test.tsx exercises it directly).
export type WikiMode = "reading" | "editing";

export function ArticleEditor({
  articleId,
  onBack,
  onOpenArticle,
  linkFiles = [],
  mode = "editing",
  onModeChange,
  nav,
}: {
  articleId: number;
  /** Called after the article is deleted (closes its tab). */
  onBack?: () => void;
  /** Follows an internal wiki link; `newTab` on Cmd-click while reading. */
  onOpenArticle?: (ref: WikiRef, newTab?: boolean) => void;
  /** Project files the link picker offers besides articles. */
  linkFiles?: ProjectDoc[];
  /** Reading shows the article read-only and links open on a plain click. */
  mode?: WikiMode;
  onModeChange?: (mode: WikiMode) => void;
  /** Back/forward through this tab's history, and the folder for the breadcrumb. */
  nav?: { canBack: boolean; canForward: boolean; onBack: () => void; onForward: () => void; folderName?: string };
}) {
  const t = useT();
  const { data: article } = useWikiArticle(articleId);
  const { data: articleTags = [] } = useWikiArticleTags(articleId);
  const { data: allTags = [] } = useAllWikiTags();
  const { data: projects = [] } = useProjects();
  const updateArticle = useUpdateWikiArticle();
  const deleteArticle = useDeleteWikiArticle();
  const setTags = useSetWikiArticleTags();

  const { data: allArticlesForLink = [] } = useWikiArticles();

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [slashMenu, setSlashMenu] = useState<{ top: number; left: number } | null>(null);
  const [slashFilter, setSlashFilter] = useState("");
  // `bracketFrom` is set when the picker was opened by typing [[: that text
  // is replaced by the link.
  const [linkPopup, setLinkPopup] = useState<{
    top: number;
    left: number;
    bracketFrom?: number;
    query?: string;
  } | null>(null);
  const createArticle = useCreateWikiArticle();
  const reading = mode === "reading";

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks which article the currently-pending debounced save belongs to,
  // so the unmount flush below can apply the exact same id check.
  const pendingSaveArticleIdRef = useRef<number | null>(null);

  const articleIdRef = useRef(articleId);
  useEffect(() => { articleIdRef.current = articleId; }, [articleId]);

  // Sync state when article loads
  useEffect(() => {
    if (article) {
      setTitle(article.title);
      setProjectId(article.project_id);
    }
  }, [article]);

  const debouncedSave = useCallback(
    (content: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      const scheduledFor = articleId;
      pendingSaveArticleIdRef.current = scheduledFor;
      saveTimeoutRef.current = setTimeout(() => {
        // The editor may have moved to another article inside the debounce
        // window; this content belongs to the one that was open when it was
        // typed, and writing it anywhere else would corrupt that article.
        saveTimeoutRef.current = null;
        pendingSaveArticleIdRef.current = null;
        if (articleIdRef.current !== scheduledFor) return;
        updateArticle.mutate(
          { id: scheduledFor, data: { content } },
          { onError: (e) => notifyError(getLabels().operation_failed, e) }
        );
      }, 2000);
    },
    [articleId, updateArticle]
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Placeholder.configure({
          placeholder: t.start_writing,
        }),
        Link.configure({
          openOnClick: false,
          // Defense-in-depth on top of tiptap's own validation: only web
          // URLs and internal /wiki links may be stored in article content.
          isAllowedUri: (url) => isAllowedWikiLink(url),
        }),
      ],
      content: article?.content ?? "",
      editable: mode === "editing",
      onUpdate: ({ editor: ed }) => {
        const html = ed.getHTML();
        debouncedSave(html);

        // Slash command detection — look for "/" at start of line or after whitespace
        const { state } = ed;
        const { from } = state.selection;
        // Get text from start of current line to cursor
        const $pos = state.doc.resolve(from);
        const lineStart = $pos.start();
        const textInLine = state.doc.textBetween(lineStart, from, "\0");
        // "[[" opens the link picker; what follows becomes its search.
        const bracketMatch = textInLine.match(/\[\[([^[\]\0]*)$/);
        if (bracketMatch) {
          const bracketFrom = from - bracketMatch[0].length;
          const coords = ed.view.coordsAtPos(bracketFrom);
          setSlashMenu(null);
          setSlashFilter("");
          setLinkPopup({ top: coords.bottom + 4, left: coords.left, bracketFrom, query: bracketMatch[1] });
          return;
        }
        // Check if there's a "/" with optional command text after it
        const slashMatch = textInLine.match(/\/(\w*)$/);
        if (slashMatch) {
          const coords = ed.view.coordsAtPos(lineStart + textInLine.lastIndexOf("/"));
          setSlashMenu({ top: coords.bottom + 4, left: coords.left });
          setSlashFilter(slashMatch[1] ?? "");
        } else {
          setSlashMenu(null);
          setSlashFilter("");
        }
      },
    },
    [article?.id]
  );

  useEffect(() => {
    editor?.setEditable(mode === "editing");
  }, [editor, mode]);

  const handleTitleBlur = useCallback(() => {
    if (article && title !== article.title) {
      updateArticle.mutate({ id: articleId, data: { title: title || t.untitled } });
    }
  }, [article, title, articleId, updateArticle, t.untitled]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        editor?.commands.focus();
      }
    },
    [editor]
  );

  const handleAddTag = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && tagInput.trim()) {
        e.preventDefault();
        const newTag = tagInput.trim().toLowerCase();
        if (!articleTags.includes(newTag)) {
          setTags.mutate({ articleId, tags: [...articleTags, newTag] });
        }
        setTagInput("");
      }
    },
    [tagInput, articleTags, articleId, setTags]
  );

  const handleRemoveTag = useCallback(
    (tag: string) => {
      setTags.mutate({ articleId, tags: articleTags.filter((t) => t !== tag) });
    },
    [articleTags, articleId, setTags]
  );

  const handleProjectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      const pid = val ? Number(val) : null;
      setProjectId(pid);
      updateArticle.mutate({ id: articleId, data: { project_id: pid } });
    },
    [articleId, updateArticle]
  );

  // No question: Undo brings the article back (with its content and tags).
  const handleDeleteArticle = useCallback(() => {
    deleteWithUndo(deleteArticle, articleId, t.article_deleted);
    onBack?.();
  }, [articleId, deleteArticle, onBack, t.article_deleted]);

  // Keep a ref for unmount cleanup to avoid a stale closure over `editor`
  // (articleIdRef is declared above, next to the debounce it also guards)
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Flush pending debounced save on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        const ed = editorRef.current;
        const pendingId = pendingSaveArticleIdRef.current;
        // Same id check as the debounce itself: only flush if the article
        // open when the edit happened is still the one open now, so the
        // editor's current HTML is guaranteed to belong to it. A flush that
        // writes the wrong article would be the same bug by another path.
        if (ed && pendingId !== null && pendingId === articleIdRef.current) {
          updateArticle.mutate(
            { id: pendingId, data: { content: ed.getHTML() } },
            { onError: (e) => notifyError(getLabels().operation_failed, e) }
          );
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only flush; reads live values via refs on purpose (see comment above)
  }, []);

  const handleSlashSelect = useCallback(
    (item: SlashMenuItem) => {
      if (!editor) return;

      // Delete the "/command" text
      const deleteLen = 1 + slashFilter.length;
      editor.chain().focus().deleteRange({
        from: editor.state.selection.from - deleteLen,
        to: editor.state.selection.from,
      }).run();

      // Close slash menu first
      setSlashMenu(null);
      setSlashFilter("");

      if (item.special === "link") {
        // Show link popup after a tick (let editor settle after deleteRange)
        setTimeout(() => {
          const coords = editor.view.coordsAtPos(editor.state.selection.from);
          setLinkPopup({ top: coords.bottom + 4, left: coords.left });
        }, 0);
        return;
      }

      item.action(editor);
    },
    [editor, slashFilter]
  );

  const handleLinkInsert = useCallback(
    (href: string, text: string) => {
      if (!editor) return;
      if (linkPopup?.bracketFrom !== undefined) {
        // Replace the typed "[[query" with the link, then stop the link
        // mark so the next characters are plain text.
        editor
          .chain()
          .focus()
          .deleteRange({ from: linkPopup.bracketFrom, to: editor.state.selection.from })
          .insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] })
          .unsetMark("link")
          .run();
        setLinkPopup(null);
        return;
      }
      const { from, to } = editor.state.selection;
      if (from === to) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'text',
            text: text,
            marks: [{ type: 'link', attrs: { href } }],
          })
          .run();
      } else {
        editor.chain().focus().setLink({ href }).run();
      }
      setLinkPopup(null);
    },
    [editor, linkPopup]
  );

  // A link to an article that doesn't exist yet: create it beside this one.
  const handleLinkCreate = useCallback(
    (newTitle: string) => {
      createArticle.mutate(
        { title: newTitle, folder_id: article?.folder_id ?? null, project_id: article?.project_id ?? null },
        {
          onSuccess: (newId: number) => handleLinkInsert(`/wiki?article=${newId}`, newTitle),
          onError: (e) => notifyError(getLabels().operation_failed, e),
        }
      );
    },
    [createArticle, article?.folder_id, article?.project_id, handleLinkInsert]
  );

  const closeLinkPopup = useCallback(() => {
    const fromBracket = linkPopup?.bracketFrom !== undefined;
    setLinkPopup(null);
    if (fromBracket) editor?.commands.focus();
  }, [linkPopup, editor]);

  // While editing, a plain click places the cursor so the link text stays
  // editable, and Cmd/Ctrl-click follows the link. While reading, a plain
  // click follows it and Cmd/Ctrl-click opens it in a new tab.
  const handleEditorClick = useCallback(
    (e: React.MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      // Never let the webview itself navigate to a stored href.
      e.preventDefault();
      const modifier = e.metaKey || e.ctrlKey;
      if (!reading && !modifier) return;
      const href = anchor.getAttribute("href") ?? "";
      const fileKey = parseWikiFileKey(href);
      if (fileKey) {
        onOpenArticle?.(fileKey, reading && modifier);
        return;
      }
      const targetId = parseWikiArticleId(href);
      if (targetId !== null) {
        if (targetId !== articleId) onOpenArticle?.(targetId, reading && modifier);
        return;
      }
      if (/^https?:\/\//i.test(href)) {
        openUrl(href).catch((err) => {
          logError("Open URL failed:", err);
          toast.error(t.failed_to_open_url);
        });
      }
    },
    [articleId, onOpenArticle, reading, t.failed_to_open_url]
  );

  if (!article) return null;


  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar: history, breadcrumb, mode, delete */}
      <div className={`${PANEL_TOP_BAR} gap-1 px-3 border-[var(--color-border-divider)]`}>
        {nav && (
          <>
            <IconButton icon={ChevronLeft} label={t.wiki_back} onClick={nav.onBack} disabled={!nav.canBack} />
            <IconButton icon={ChevronRight} label={t.wiki_forward} onClick={nav.onForward} disabled={!nav.canForward} />
          </>
        )}
        <div className="flex-1 min-w-0 text-center text-xs text-muted truncate">
          {[nav?.folderName, article.project_name].filter(Boolean).map((part, i) => (
            <span key={i}>
              {part} <span className="opacity-50">/</span>{" "}
            </span>
          ))}
          <span className="text-[var(--color-text)]">{article.title}</span>
        </div>
        {onModeChange && (
          <IconButton
            icon={reading ? Pencil : Eye}
            label={reading ? t.wiki_switch_to_editing : t.wiki_switch_to_reading}
            active={!reading}
            aria-pressed={!reading}
            onClick={() => onModeChange(reading ? "editing" : "reading")}
          />
        )}
        <IconButton icon={Trash2} label={t.delete} tone="danger" onClick={handleDeleteArticle} />
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-[720px] mx-auto">
          {/* Title */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            readOnly={reading}
            placeholder={t.untitled}
            className="w-full text-xl font-semibold tracking-tight bg-transparent border-none outline-none mb-3 text-[var(--color-text)] placeholder:text-muted"
          />

          {/* Metadata row */}
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {articleTags.map((tag) => (
                <Tag key={tag} name={tag} onRemove={reading ? undefined : () => handleRemoveTag(tag)} />
              ))}
              {!reading && (
                <div className="relative">
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    list="wiki-tags-datalist"
                    placeholder={t.add_tag}
                    className="w-24 bg-transparent border-none outline-none text-xs text-muted placeholder:text-muted"
                  />
                  <datalist id="wiki-tags-datalist">
                    {allTags
                      .filter((tg) => !articleTags.includes(tg))
                      .map((tg) => (
                        <option key={tg} value={tg} />
                      ))}
                  </datalist>
                </div>
              )}
            </div>

            {reading ? (
              article.project_name && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-accent-light text-accent">{article.project_name}</span>
              )
            ) : (
              <>
                <div className="h-4 w-px bg-[var(--color-border-divider)]" />
                <Select
                  value={projectId?.toString() ?? ""}
                  onChange={handleProjectChange}
                  fullWidth={false}
                  className="text-xs w-48"
                >
                  <option value="">{t.no_project}</option>
                  {projects.map((p: { id: number; name: string }) => (
                    <option key={p.id} value={p.id.toString()}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </>
            )}
          </div>

          {/* Tiptap editor */}
          <div className={`tiptap-editor relative ${reading ? "is-reading" : ""}`} onClick={handleEditorClick}>
            <EditorContent editor={editor} />
            {slashMenu && (
              <SlashCommandMenu
                position={slashMenu}
                filter={slashFilter}
                onSelect={handleSlashSelect}
                onClose={() => { setSlashMenu(null); setSlashFilter(""); }}
              />
            )}
            {linkPopup && (
              <LinkInsertPopup
                position={linkPopup}
                articles={[
                  ...allArticlesForLink.map((a) => ({
                    key: `a:${a.id}`,
                    title: a.title,
                    project_id: a.project_id,
                    project_name: a.project_name,
                    href: `/wiki?article=${a.id}`,
                  })),
                  ...linkFiles.map((d) => ({
                    key: d.key,
                    title: d.rel,
                    project_id: d.projectId,
                    project_name: d.projectName,
                    href: wikiFileHref(d.projectId, d.rel),
                    file: true,
                  })),
                ]}
                currentArticleId={articleId}
                currentProjectId={article.project_id}
                initialQuery={linkPopup.bracketFrom !== undefined ? linkPopup.query ?? "" : undefined}
                onInsert={handleLinkInsert}
                onCreate={handleLinkCreate}
                onClose={closeLinkPopup}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the layout just won't be remembered.
  }
}

// ─── Main WikiPage ────────────────────────────────────────────────
export function WikiPage() {
  const t = useT();
  const tabsKey = useOrgStore((s) => s.orgKey("wikiTabs"));

  const { data: allArticles = [], isSuccess: articlesLoaded } = useWikiArticles();
  const { data: folders = [] } = useWikiFolders();
  const { data: projects = [] } = useProjects();
  const docs = useProjectDocs(projects);
  const docsByKey = useMemo(() => new Map(docs.map((d) => [d.key, d])), [docs]);
  const createArticle = useCreateWikiArticle();
  const deleteArticle = useDeleteWikiArticle();
  const updateArticle = useUpdateWikiArticle();

  const [tabsState, setTabsState] = useState<TabsState>(() => readStored(tabsKey, EMPTY_TABS));
  const [mode, setModeState] = useState<WikiMode>(() => readStored<WikiMode>("wikiMode", "reading"));
  const [explorerOpen, setExplorerOpen] = useState(() => readStored("wikiExplorerOpen", true));
  const [sideOpen, setSideOpen] = useState(() => readStored("wikiSidePanelOpen", true));

  useEffect(() => writeStored(tabsKey, tabsState), [tabsKey, tabsState]);
  const setMode = useCallback((m: WikiMode) => {
    setModeState(m);
    writeStored("wikiMode", m);
  }, []);

  const byId = useMemo(() => new Map(allArticles.map((a) => [a.id, a])), [allArticles]);
  const index = useMemo(() => buildLinkIndex(allArticles), [allArticles]);
  const colors = useMemo(
    () => projectColors([...allArticles.map((a) => a.project_id), ...docs.map((d) => d.projectId)]),
    [allArticles, docs]
  );
  const folderNames = useMemo(() => new Map(folders.map((f: WikiFolder) => [f.id, f.name])), [folders]);

  useEffect(() => {
    if (!articlesLoaded) return;
    setTabsState((s) => pruneTabs(s, new Set(allArticles.map((a) => a.id))));
  }, [articlesLoaded, allArticles]);

  const activeTab = tabsState.tabs.find((tab) => tab.key === tabsState.active);
  const activeId = tabArticleId(activeTab);
  const activeArticle = activeId != null ? byId.get(activeId) : undefined;
  const activeRef = tabRef(activeTab);
  const activeFileKey = typeof activeRef === "string" ? activeRef : null;
  const activeDoc = activeFileKey ? docsByKey.get(activeFileKey) : undefined;
  // The graph's "current only" view centres on what you had open last.
  const [lastRef, setLastRef] = useState<WikiRef | null>(null);
  useEffect(() => {
    if (activeRef != null) setLastRef(activeRef);
  }, [activeRef]);

  const openArticle = useCallback(
    (id: number, newTab = false) => {
      if (!byId.has(id)) {
        toast.error(t.wiki_article_not_found);
        return;
      }
      setTabsState((s) => openInTabs(s, id, newTab));
    },
    [byId, t.wiki_article_not_found]
  );

  /** Opens an article (by id) or a project file (by key). */
  const openRef = useCallback(
    (ref: WikiRef, newTab = false) => {
      if (typeof ref === "number") openArticle(ref, newTab);
      else setTabsState((s) => openInTabs(s, ref, newTab));
    },
    [openArticle]
  );

  const openGraph = useCallback(() => {
    setTabsState((s) =>
      s.tabs.some((tab) => tab.kind === "graph")
        ? { ...s, active: "graph" }
        : { tabs: [...s.tabs, { key: "graph", kind: "graph" }], active: "graph" }
    );
  }, []);

  const moveHistory = useCallback((step: number) => {
    setTabsState((s) => ({
      ...s,
      tabs: s.tabs.map((tab) =>
        tab.key === s.active && tab.kind === "article"
          ? { ...tab, pos: Math.min(tab.history.length - 1, Math.max(0, tab.pos + step)) }
          : tab
      ),
    }));
  }, []);

  // Open the article named in the address (`/wiki?article=42`), e.g. from a
  // project page. The param is consumed so the open article stays driven by
  // in-page state, and the same link can be followed again later.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedArticle = searchParams.get("article");
  useEffect(() => {
    if (requestedArticle === null || !articlesLoaded) return;
    const id = parseWikiArticleId(`/wiki?article=${requestedArticle}`);
    if (id !== null) openArticle(id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("article");
        return next;
      },
      { replace: true }
    );
  }, [requestedArticle, articlesLoaded, openArticle, setSearchParams]);

  const handleNewArticle = useCallback(
    (projectId: number | null) => {
      createArticle.mutate(
        { title: t.untitled, folder_id: null, project_id: projectId },
        {
          onSuccess: (newId: number) => {
            setMode("editing");
            setTabsState((s) => openInTabs(s, newId, true));
          },
        }
      );
    },
    [createArticle, t.untitled, setMode]
  );

  const handleDeleteArticle = useCallback(
    (id: number) => deleteWithUndo(deleteArticle, id, t.article_deleted),
    [deleteArticle, t.article_deleted]
  );

  const handleLinkIt = useCallback(
    (sourceId: number) => {
      const source = byId.get(sourceId);
      if (!source || !activeArticle) return;
      const html = linkFirstMention(source.content, activeArticle.title, activeArticle.id);
      if (html) {
        updateArticle.mutate(
          { id: sourceId, data: { content: html } },
          { onError: (e) => notifyError(getLabels().operation_failed, e) }
        );
      }
    },
    [byId, activeArticle, updateArticle]
  );

  const scrollToHeading = useCallback((headingIndex: number) => {
    const headings = document.querySelectorAll(
      ".tiptap-editor .ProseMirror h1, .tiptap-editor .ProseMirror h2, .tiptap-editor .ProseMirror h3"
    );
    headings[headingIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const toggleExplorer = () =>
    setExplorerOpen((o: boolean) => {
      writeStored("wikiExplorerOpen", !o);
      return !o;
    });
  const toggleSide = () =>
    setSideOpen((o: boolean) => {
      writeStored("wikiSidePanelOpen", !o);
      return !o;
    });

  return (
    <div className="flex flex-1 min-h-0 -m-8 page-transition">
      {explorerOpen && (
        <WikiExplorer
          articles={allArticles}
          docs={docs}
          activeRef={activeRef}
          colors={colors}
          creating={createArticle.isPending}
          onOpen={openRef}
          onNewArticle={handleNewArticle}
          onOpenGraph={openGraph}
          onDeleteArticle={handleDeleteArticle}
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Tab bar: same tabs and icon buttons as the app's own tab bar */}
        <div className={`${PANEL_TOP_BAR} border-[var(--color-border-divider)] bg-[var(--color-bg)]`}>
          <IconButton
            icon={PanelLeft}
            label={t.wiki_explorer}
            aria-pressed={explorerOpen}
            onClick={toggleExplorer}
            className="ml-1.5"
          />
          <div role="tablist" aria-label={t.wiki_open_tabs} className="flex items-center flex-1 min-w-0 overflow-x-auto scrollbar-hide">
            {tabsState.tabs.map((tab) => {
              const ref = tabRef(tab);
              const label =
                tab.kind === "graph"
                  ? t.wiki_graph
                  : typeof ref === "string"
                    ? (docsByKey.get(ref)?.rel ?? ref.split(":").slice(2).join(":")).split("/").pop()!
                    : byId.get(ref ?? -1)?.title ?? "…";
              return (
                <TabItem
                  key={tab.key}
                  role="tab"
                  label={label}
                  icon={
                    tab.kind === "graph" ? (
                      <Waypoints size={14} className="shrink-0" />
                    ) : typeof ref === "string" ? (
                      <File size={14} className="shrink-0" />
                    ) : undefined
                  }
                  active={tab.key === tabsState.active}
                  onActivate={() => setTabsState((s) => ({ ...s, active: tab.key }))}
                  onClose={() => setTabsState((s) => closeTab(s, tab.key))}
                  closeLabel={t.wiki_close_tab}
                />
              );
            })}
          </div>
          {(activeArticle || activeDoc) && (
            <IconButton
              icon={PanelRight}
              label={t.wiki_side_panel}
              aria-pressed={sideOpen}
              onClick={toggleSide}
              className="mr-1.5"
            />
          )}
        </div>

        {activeTab?.kind === "graph" ? (
          <WikiGraph
            articles={allArticles}
            folders={folders}
            index={index}
            colors={colors}
            docs={docs}
            activeRef={lastRef}
            onOpen={openRef}
          />
        ) : activeTab?.kind === "article" && activeFileKey ? (
          activeDoc ? (
            <>
              <DocView
                key={activeDoc.key}
                doc={activeDoc}
                onOpenRef={openRef}
                nav={{
                  canBack: activeTab.pos > 0,
                  canForward: activeTab.pos < activeTab.history.length - 1,
                  onBack: () => moveHistory(-1),
                  onForward: () => moveHistory(1),
                }}
              />
              <BottomBar className="justify-end">
                <span>
                  {t.wiki_linked_from} {index.fileBacklinks.get(activeDoc.key)?.length ?? 0}
                </span>
                <span>{t.wiki_reading}</span>
              </BottomBar>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState message={t.wiki_file_unreadable} icon={<File size={32} />} />
            </div>
          )
        ) : activeTab?.kind === "article" && activeId != null && activeArticle ? (
          <>
            {/* Keyed so moving between articles remounts the editor: the unmount
                flush then saves typing still inside the 2s autosave window. */}
            <ArticleEditor
              key={activeId}
              articleId={activeId}
              onBack={() => setTabsState((s) => closeTab(s, activeTab.key))}
              onOpenArticle={openRef}
              linkFiles={docs}
              mode={mode}
              onModeChange={setMode}
              nav={{
                canBack: activeTab.pos > 0,
                canForward: activeTab.pos < activeTab.history.length - 1,
                onBack: () => moveHistory(-1),
                onForward: () => moveHistory(1),
                // Articles without a project show the group they sit in (e.g. User Guide).
                folderName:
                  activeArticle.project_id == null && activeArticle.folder_id != null
                    ? folderNames.get(activeArticle.folder_id)
                    : undefined,
              }}
            />
            <BottomBar className="justify-end">
              <span>
                {t.wiki_backlinks} {index.backlinks.get(activeId)?.length ?? 0}
              </span>
              <span>
                {t.wiki_outgoing} {index.outgoing.get(activeId)?.size ?? 0}
              </span>
              <span>{t.wiki_words.replace("{n}", String(wordCount(activeArticle.content)))}</span>
              <span>{mode === "reading" ? t.wiki_reading : t.wiki_editing}</span>
            </BottomBar>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              message={allArticles.length === 0 ? t.first_run_wiki : t.wiki_nothing_open}
              icon={<BookOpen size={32} />}
              action={
                allArticles.length > 0 ? (
                  <Button variant="secondary" icon={<Waypoints size={12} />} onClick={openGraph}>
                    {t.wiki_open_graph}
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
      </div>

      {sideOpen && activeArticle && activeTab?.kind === "article" && (
        <WikiSidePanel
          article={activeArticle}
          articles={allArticles}
          index={index}
          colors={colors}
          onOpen={openArticle}
          onOpenGraph={openGraph}
          onLinkIt={handleLinkIt}
          onOutline={scrollToHeading}
          docs={docs}
          onOpenFile={openRef}
        />
      )}
      {sideOpen && activeDoc && (
        <DocSidePanel
          doc={activeDoc}
          docs={docs}
          articles={allArticles}
          index={index}
          colors={colors}
          onOpen={openArticle}
          onOpenFile={openRef}
          onOpenGraph={openGraph}
          onOutline={scrollToHeading}
        />
      )}
    </div>
  );
}
