import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import {
  Plus,
  ArrowLeft,
  FolderOpen,
  FileText,
  X,
  Trash2,
  Heading1,
  Heading2,
  Heading3,
  List,
  Link as LinkIcon,
  Minus,
} from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useT } from "../i18n/useT";
import { useAppStore } from "../stores/app-store";
import { getTagColor } from "../lib/tagColors";
import { SearchBar } from "../components/ui/SearchBar";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import {
  useWikiFolders,
  useCreateWikiFolder,
  useUpdateWikiFolder,
  useDeleteWikiFolder,
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
import type { WikiFolder, WikiArticleWithTags } from "../types/wiki";

// ─── Slash Command Menu ───────────────────────────────────────────
interface SlashMenuItem {
  label: string;
  icon: typeof Heading1;
  action: (editor: ReturnType<typeof useEditor>) => void;
}

const SLASH_COMMANDS: SlashMenuItem[] = [
  {
    label: "Heading 1",
    icon: Heading1,
    action: (editor) => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "Heading 2",
    icon: Heading2,
    action: (editor) => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "Heading 3",
    icon: Heading3,
    action: (editor) => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "Bullet List",
    icon: List,
    action: (editor) => editor?.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Divider",
    icon: Minus,
    action: (editor) => editor?.chain().focus().setHorizontalRule().run(),
  },
  {
    label: "Link",
    icon: LinkIcon,
    action: (editor) => {
      const url = window.prompt("URL");
      if (url) {
        editor?.chain().focus().setLink({ href: url }).run();
      }
    },
  },
];

function SlashCommandMenu({
  position,
  onSelect,
  onClose,
}: {
  position: { top: number; left: number };
  onSelect: (item: SlashMenuItem) => void;
  onClose: () => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % SLASH_COMMANDS.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onSelect(SLASH_COMMANDS[selectedIdx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIdx, onSelect, onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[180px]"
      style={{ top: position.top, left: position.left }}
    >
      {SLASH_COMMANDS.map((cmd, i) => {
        const Icon = cmd.icon;
        return (
          <button
            key={cmd.label}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] ${
              i === selectedIdx ? "bg-[var(--color-hover-row)]" : ""
            } hover:bg-[var(--color-hover-row)]`}
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
    </div>
  );
}

// ─── Article Editor ───────────────────────────────────────────────
function ArticleEditor({
  articleId,
  onBack,
}: {
  articleId: number;
  onBack: () => void;
}) {
  const t = useT();
  const darkMode = useAppStore((s) => s.darkMode);
  const { data: article } = useWikiArticle(articleId);
  const { data: articleTags = [] } = useWikiArticleTags(articleId);
  const { data: allTags = [] } = useAllWikiTags();
  const { data: projects = [] } = useProjects();
  const updateArticle = useUpdateWikiArticle();
  const deleteArticle = useDeleteWikiArticle();
  const setTags = useSetWikiArticleTags();

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [slashMenu, setSlashMenu] = useState<{ top: number; left: number } | null>(null);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      saveTimeoutRef.current = setTimeout(() => {
        updateArticle.mutate({ id: articleId, data: { content } });
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
        Link.configure({ openOnClick: false }),
      ],
      content: article?.content ?? "",
      onUpdate: ({ editor: ed }) => {
        const html = ed.getHTML();
        debouncedSave(html);

        // Slash command detection
        const { state } = ed;
        const { from } = state.selection;
        const textBefore = state.doc.textBetween(
          Math.max(0, from - 1),
          from,
          "\0"
        );
        if (textBefore === "/") {
          const coords = ed.view.coordsAtPos(from);
          setSlashMenu({ top: coords.bottom + 4, left: coords.left });
        } else {
          setSlashMenu(null);
        }
      },
    },
    [article?.id]
  );

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

  const handleDeleteArticle = useCallback(async () => {
    const confirmed = await ask(t.delete + "?", { kind: "warning" });
    if (confirmed) {
      deleteArticle.mutate(articleId);
      onBack();
    }
  }, [articleId, deleteArticle, onBack, t.delete]);

  // Flush pending debounced save on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        if (editor) {
          updateArticle.mutate({ id: articleId, data: { content: editor.getHTML() } });
        }
      }
    };
  }, [articleId]);

  const handleSlashSelect = useCallback(
    (item: SlashMenuItem) => {
      // Delete the "/" character
      editor?.chain().focus().deleteRange({
        from: editor.state.selection.from - 1,
        to: editor.state.selection.from,
      }).run();
      item.action(editor);
      setSlashMenu(null);
    },
    [editor]
  );

  if (!article) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0 page-transition">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-[var(--color-border-divider)]">
        <button
          onClick={onBack}
          className="text-muted hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm text-muted">{t.back}</span>
        <div className="flex-1" />
        <button
          onClick={handleDeleteArticle}
          className="p-1.5 rounded-md text-[var(--color-muted)] hover:bg-red-500/10 hover:text-red-500 transition-colors"
          title={t.delete}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Title */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          placeholder={t.untitled}
          className="w-full text-xl font-semibold tracking-tight bg-transparent border-none outline-none mb-3 text-[var(--color-text)] placeholder:text-muted"
        />

        {/* Metadata row */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {/* Tags */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {articleTags.map((tag) => {
              const color = getTagColor(tag, darkMode);
              return (
                <span
                  key={tag}
                  style={{ background: color.bg, color: color.text }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="opacity-60 hover:opacity-100"
                  >
                    <X size={10} />
                  </button>
                </span>
              );
            })}
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
          </div>

          <div className="h-4 w-px bg-[var(--color-border-divider)]" />

          {/* Project link */}
          <Select
            value={projectId?.toString() ?? ""}
            onChange={handleProjectChange}
            fullWidth={false}
            className="text-xs w-48"
          >
            <option value="">No project</option>
            {projects.map((p: { id: number; name: string }) => (
              <option key={p.id} value={p.id.toString()}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        {/* Tiptap editor */}
        <div className="tiptap-editor relative">
          <EditorContent editor={editor} />
          {slashMenu && (
            <SlashCommandMenu
              position={slashMenu}
              onSelect={handleSlashSelect}
              onClose={() => setSlashMenu(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Folder Sidebar ───────────────────────────────────────────────
function FolderSidebar({
  selectedFolderId,
  onSelectFolder,
  articles,
}: {
  selectedFolderId: number | null;
  onSelectFolder: (id: number | null) => void;
  articles: WikiArticleWithTags[];
}) {
  const t = useT();
  const { data: folders = [] } = useWikiFolders();
  const createFolder = useCreateWikiFolder();
  const updateFolder = useUpdateWikiFolder();
  const deleteFolder = useDeleteWikiFolder();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    folderId: number;
    x: number;
    y: number;
  } | null>(null);

  const contextRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  const allCount = articles.length;
  const folderCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of articles) {
      if (a.folder_id != null) {
        map.set(a.folder_id, (map.get(a.folder_id) || 0) + 1);
      }
    }
    return map;
  }, [articles]);

  const handleCreateFolder = useCallback(() => {
    createFolder.mutate(t.new_folder);
  }, [createFolder, t.new_folder]);

  const handleRenameSubmit = useCallback(
    (id: number) => {
      if (editName.trim()) {
        updateFolder.mutate({ id, data: { name: editName.trim() } });
      }
      setEditingId(null);
    },
    [editName, updateFolder]
  );

  const handleDeleteFolder = useCallback(
    (id: number) => {
      deleteFolder.mutate(id, {
        onSuccess: () => {
          toast.success(t.folder_deleted ?? "Folder deleted");
        },
      });
      if (selectedFolderId === id) onSelectFolder(null);
      setContextMenu(null);
    },
    [deleteFolder, selectedFolderId, onSelectFolder, t.folder_deleted]
  );

  return (
    <div className="w-[200px] shrink-0 bg-[var(--color-surface)] border-r border-[var(--color-border-divider)] flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border-divider)]">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted">
          {t.folder}
        </span>
        <button
          onClick={handleCreateFolder}
          className="text-muted hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-1">
        {/* All articles */}
        <button
          onClick={() => onSelectFolder(null)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
            selectedFolderId === null
              ? "bg-accent-light text-accent font-medium"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
          }`}
        >
          <FileText size={14} />
          <span className="flex-1 text-left truncate">{t.all_articles}</span>
          <span className="text-xs text-muted">{allCount}</span>
        </button>

        {/* Folders */}
        {folders.map((folder: WikiFolder) => (
          <div key={folder.id}>
            {editingId === folder.id ? (
              <div className="px-3 py-1">
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => handleRenameSubmit(folder.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSubmit(folder.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full border border-[var(--color-border-divider)] rounded-lg px-2 py-1 text-sm bg-transparent"
                />
              </div>
            ) : (
              <button
                onClick={() => onSelectFolder(folder.id)}
                onDoubleClick={() => {
                  setEditingId(folder.id);
                  setEditName(folder.name);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ folderId: folder.id, x: e.clientX, y: e.clientY });
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                  selectedFolderId === folder.id
                    ? "bg-accent-light text-accent font-medium"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
                }`}
              >
                <FolderOpen size={14} />
                <span className="flex-1 text-left truncate">{folder.name}</span>
                <span className="text-xs text-muted">
                  {folderCounts.get(folder.id) || 0}
                </span>
              </button>
            )}
          </div>
        ))}
      </nav>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextRef}
          className="fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[160px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-[var(--color-hover-row)]"
            onClick={() => handleDeleteFolder(contextMenu.folderId)}
          >
            <Trash2 size={14} />
            {t.delete}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Article List ─────────────────────────────────────────────────
function ArticleList({
  articles,
  search,
  tagFilter,
  onSelectArticle,
  onDeleteArticle,
}: {
  articles: WikiArticleWithTags[];
  search: string;
  tagFilter: string[];
  onSelectArticle: (id: number) => void;
  onDeleteArticle: (id: number) => void;
}) {
  const t = useT();
  const darkMode = useAppStore((s) => s.darkMode);
  const [ctxMenu, setCtxMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  const filtered = useMemo(() => {
    let list = articles;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          (a.tags ?? []).some((tag: string) => tag.toLowerCase().includes(q))
      );
    }
    if (tagFilter.length > 0) {
      list = list.filter((a) =>
        tagFilter.every((tf) => (a.tags ?? []).includes(tf))
      );
    }
    return list;
  }, [articles, search, tagFilter]);

  if (filtered.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted">
        <FileText size={32} />
        <span className="text-sm">{t.no_articles_yet}</span>
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--color-border-header)]">
          <th className="text-left px-4 py-2.5 text-xs text-muted">
            {t.name}
          </th>
          <th className="text-left px-4 py-2.5 text-xs text-muted">
            {t.tags}
          </th>
          <th className="text-left px-4 py-2.5 text-xs text-muted">
            {t.project}
          </th>
          <th className="text-left px-4 py-2.5 text-xs text-muted">
            {t.updated}
          </th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((article) => (
          <tr
            key={article.id}
            onClick={() => onSelectArticle(article.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ id: article.id, x: e.clientX, y: e.clientY });
            }}
            className="border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] cursor-pointer"
          >
            <td className="px-4 py-2.5 font-medium">{article.title}</td>
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-1 flex-wrap">
                {(article.tags ?? []).map((tag: string) => {
                  const color = getTagColor(tag, darkMode);
                  return (
                    <span
                      key={tag}
                      style={{ background: color.bg, color: color.text }}
                      className="px-2 py-0.5 text-xs rounded-full font-medium"
                    >
                      {tag}
                    </span>
                  );
                })}
              </div>
            </td>
            <td className="px-4 py-2.5 text-muted">
              {article.project_name ?? ""}
            </td>
            <td className="px-4 py-2.5 text-muted text-xs">
              {article.updated_at
                ? new Date(article.updated_at).toLocaleDateString()
                : ""}
            </td>
          </tr>
        ))}
      </tbody>
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[160px]"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-[var(--color-hover-row)]"
            onClick={() => {
              onDeleteArticle(ctxMenu.id);
              setCtxMenu(null);
            }}
          >
            <Trash2 size={14} />
            {t.delete}
          </button>
        </div>
      )}
    </table>
  );
}

// ─── Main WikiPage ────────────────────────────────────────────────
export function WikiPage() {
  const t = useT();
  const darkMode = useAppStore((s) => s.darkMode);

  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const { data: allArticles = [] } = useWikiArticles();
  const { data: allTags = [] } = useAllWikiTags();
  const createArticle = useCreateWikiArticle();
  const deleteArticle = useDeleteWikiArticle();

  const handleDeleteArticle = useCallback(async (id: number) => {
    const confirmed = await ask(t.delete + "?", { kind: "warning" });
    if (confirmed) {
      deleteArticle.mutate(id);
    }
  }, [deleteArticle, t.delete]);

  // Filter articles by selected folder
  const visibleArticles = useMemo(() => {
    if (selectedFolderId === null) return allArticles;
    return allArticles.filter(
      (a: WikiArticleWithTags) => a.folder_id === selectedFolderId
    );
  }, [allArticles, selectedFolderId]);

  const handleNewArticle = useCallback(() => {
    createArticle.mutate(
      { title: t.untitled, folder_id: selectedFolderId },
      {
        onSuccess: (newId: number) => {
          setSelectedArticleId(newId);
        },
      }
    );
  }, [createArticle, selectedFolderId, t.untitled]);

  const toggleTagFilter = useCallback((tag: string) => {
    setTagFilter((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  return (
    <div className="flex h-full page-transition">
      {/* Folder sidebar */}
      <FolderSidebar
        selectedFolderId={selectedFolderId}
        onSelectFolder={(id) => {
          setSelectedFolderId(id);
          setSelectedArticleId(null);
          setSearch("");
          setTagFilter([]);
        }}
        articles={allArticles}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-h-0">
        {selectedArticleId ? (
          <ArticleEditor
            articleId={selectedArticleId}
            onBack={() => setSelectedArticleId(null)}
          />
        ) : (
          <>
            {/* Top bar */}
            <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--color-border-divider)]">
              <SearchBar
                value={search}
                onChange={setSearch}
                placeholder={t.search_articles}
              />
              <div className="flex items-center gap-1.5 flex-wrap flex-1">
                {allTags.map((tag: string) => {
                  const color = getTagColor(tag, darkMode);
                  const active = tagFilter.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTagFilter(tag)}
                      style={{
                        background: active ? color.bg : "transparent",
                        color: active ? color.text : "var(--color-muted)",
                        borderColor: active ? color.text : "var(--color-border-divider)",
                      }}
                      className="px-2 py-0.5 text-xs rounded-full font-medium border transition-colors"
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={14} />}
                onClick={handleNewArticle}
              >
                {t.new_article}
              </Button>
            </div>

            {/* Article list */}
            <div className="flex-1 overflow-y-auto">
              <ArticleList
                articles={visibleArticles}
                search={search}
                tagFilter={tagFilter}
                onSelectArticle={setSelectedArticleId}
                onDeleteArticle={handleDeleteArticle}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
