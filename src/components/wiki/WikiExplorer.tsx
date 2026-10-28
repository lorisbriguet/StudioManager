import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  FilePlus,
  FileText,
  File,
  Plus,
  Trash2,
  Waypoints,
  ArrowUpRight,
} from "lucide-react";
import { useT } from "../../i18n/useT";
import { useOrgStore } from "../../stores/org-store";
import { useWikiFolders } from "../../db/hooks/useWiki";
import { BottomBar, SearchBar } from "../ui";
import type { WikiArticleWithTags } from "../../types/wiki";
import type { ProjectDoc } from "../../db/hooks/useProjectDocs";
import type { WikiRef } from "../../lib/wikiTabs";
import { colorFor } from "./wikiColors";

interface Group {
  key: string;
  /** Set for a project group; articles without a project have none. */
  projectId: number | null;
  name: string;
  articles: WikiArticleWithTags[];
  /** The project folder's Markdown files. */
  docs: ProjectDoc[];
}

/** One group per project, by name. Articles without a project are grouped
 *  by the folder they came from (the User Guide keeps its own group), the
 *  rest under "No project", last. */
function buildGroups(
  articles: WikiArticleWithTags[],
  docs: ProjectDoc[],
  folderNames: Map<number, string>,
  noProject: string
): Group[] {
  const projects = new Map<number, Group>();
  const loose = new Map<string, Group>();
  const projectGroup = (id: number, name: string) => {
    const g = projects.get(id) ?? { key: `p:${id}`, projectId: id, name, articles: [], docs: [] };
    projects.set(id, g);
    return g;
  };
  for (const a of articles) {
    if (a.project_id != null) {
      projectGroup(a.project_id, a.project_name ?? "").articles.push(a);
      continue;
    }
    const folder = a.folder_id != null ? folderNames.get(a.folder_id) : undefined;
    const key = folder ? `f:${a.folder_id}` : "none";
    const g = loose.get(key) ?? { key, projectId: null, name: folder ?? noProject, articles: [], docs: [] };
    g.articles.push(a);
    loose.set(key, g);
  }
  for (const d of docs) projectGroup(d.projectId, d.projectName).docs.push(d);
  const byName = (x: Group, y: Group) => x.name.localeCompare(y.name);
  const rest = [...loose.values()].sort((x, y) => (x.key === "none" ? 1 : y.key === "none" ? -1 : byName(x, y)));
  return [...[...projects.values()].sort(byName), ...rest];
}

function readOpenKeys(key: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

export function WikiExplorer({
  articles,
  docs = [],
  activeRef,
  colors,
  creating = false,
  onOpen,
  onNewArticle,
  onOpenGraph,
  onDeleteArticle,
}: {
  articles: WikiArticleWithTags[];
  docs?: ProjectDoc[];
  /** The open article's id or file's key. */
  activeRef: WikiRef | null;
  colors: Map<number, string>;
  /** A new article is being created: its buttons wait. */
  creating?: boolean;
  onOpen: (ref: WikiRef, newTab: boolean) => void;
  /** Creates an article, in `projectId` when given. */
  onNewArticle: (projectId: number | null) => void;
  onOpenGraph: () => void;
  onDeleteArticle: (id: number) => void;
}) {
  const t = useT();
  const { data: folders = [] } = useWikiFolders();
  const storageKey = useOrgStore((s) => s.orgKey("wikiTreeOpen"));
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const folderNames = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);
  const groups = useMemo(
    () => buildGroups(articles, docs, folderNames, t.no_project),
    [articles, docs, folderNames, t.no_project]
  );

  // Open groups, remembered per organisation. Everything starts folded.
  const [open, setOpen] = useState<Set<string>>(() => readOpenKeys(storageKey) ?? new Set());
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...open]));
    } catch {
      // Storage unavailable: the tree just won't remember what was open.
    }
  }, [open, storageKey]);

  // Reveal the open article or file.
  useEffect(() => {
    if (activeRef == null) return;
    const g = groups.find((x) =>
      typeof activeRef === "number" ? x.articles.some((a) => a.id === activeRef) : x.docs.some((d) => d.key === activeRef)
    );
    if (!g) return;
    const keys = typeof activeRef === "string" ? [g.key, `${g.key}:files`] : [g.key];
    setOpen((prev) => (keys.every((k) => prev.has(k)) ? prev : new Set([...prev, ...keys])));
  }, [activeRef, groups]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const toggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const query = search.trim().toLowerCase();
  const matches = useCallback(
    (a: WikiArticleWithTags) =>
      !query || a.title.toLowerCase().includes(query) || a.tags.some((tag) => tag.toLowerCase().includes(query)),
    [query]
  );
  const docMatches = useCallback(
    (d: ProjectDoc) => !query || d.rel.toLowerCase().includes(query) || d.title.toLowerCase().includes(query),
    [query]
  );
  const rowClass = (active: boolean) =>
    `w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-left transition-colors ${
      active ? "bg-accent-light text-accent font-medium" : "text-muted hover:bg-[var(--color-hover-row)]"
    }`;

  const iconBtn =
    "p-1 rounded-md text-muted hover:text-[var(--color-text-secondary)] disabled:opacity-30 disabled:pointer-events-none transition-colors";
  const menuItem =
    "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]";

  return (
    <aside
      aria-label={t.wiki_explorer}
      className="w-60 shrink-0 flex flex-col min-h-0 border-r border-[var(--color-border-divider)]"
    >
      <div className="px-3 pt-5 pb-2 space-y-3">
        <h1 className="text-sm font-semibold px-2 text-muted uppercase tracking-wider">{t.wiki}</h1>
        <SearchBar value={search} onChange={setSearch} placeholder={t.search_articles} className="w-full" />
        <div className="flex items-center gap-1 px-1">
          <button onClick={() => onNewArticle(null)} disabled={creating} className={iconBtn} aria-label={t.new_article} title={t.new_article}>
            <FilePlus size={14} />
          </button>
          <button onClick={() => setOpen(new Set())} className={iconBtn} aria-label={t.wiki_collapse_all} title={t.wiki_collapse_all}>
            <ChevronsDownUp size={14} />
          </button>
          <button onClick={onOpenGraph} className={`${iconBtn} ml-auto`} aria-label={t.wiki_open_graph} title={t.wiki_open_graph}>
            <Waypoints size={14} />
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-1.5 pb-3 space-y-px">
        {groups.map((g) => {
          const list = g.articles.filter(matches);
          const files = g.docs.filter(docMatches);
          if (query && list.length === 0 && files.length === 0) return null;
          const isOpen = !!query || open.has(g.key);
          const filesKey = `${g.key}:files`;
          const filesOpen = !!query || open.has(filesKey);
          return (
            <div key={g.key}>
              <div className="group flex items-center rounded-md hover:bg-[var(--color-hover-row)]">
                <button
                  type="button"
                  onClick={() => toggle(g.key)}
                  aria-expanded={isOpen}
                  className="flex-1 min-w-0 flex items-center gap-2 py-1.5 pl-3 pr-1 text-xs font-medium text-left text-[var(--color-text-secondary)]"
                >
                  {isOpen ? (
                    <ChevronDown size={14} className="shrink-0 text-muted" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-muted" />
                  )}
                  <span aria-hidden="true" className="dot shrink-0" style={{ background: colorFor(colors, g.projectId) }} />
                  <span className="flex-1 truncate">{g.name}</span>
                  <span className="text-xs text-muted">{list.length + files.length}</span>
                </button>
                {g.projectId != null && (
                  <button
                    onClick={() => onNewArticle(g.projectId)}
                    disabled={creating}
                    type="button"
                    className="mr-2 text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-text-secondary)] transition-colors"
                    aria-label={`${t.new_article}: ${g.name}`}
                    title={t.new_article}
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
              {isOpen && (
                <div className="ml-4.5 pl-1 border-l border-[var(--color-border-divider)] space-y-px">
                  {list.map((a) => {
                    const active = a.id === activeRef;
                    return (
                      <button
                        key={a.id}
                        onClick={(e) => onOpen(a.id, e.metaKey || e.ctrlKey)}
                        onAuxClick={(e) => {
                          if (e.button === 1) onOpen(a.id, true);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenu({ id: a.id, x: e.clientX, y: e.clientY });
                        }}
                        aria-current={active ? "page" : undefined}
                        type="button"
                        className={rowClass(active)}
                      >
                        <FileText size={14} className="shrink-0" />
                        <span className="flex-1 truncate">{a.title}</span>
                      </button>
                    );
                  })}
                  {files.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => toggle(filesKey)}
                        aria-expanded={filesOpen}
                        className="w-full flex items-center gap-2 py-1.5 pl-3 pr-2 rounded-md text-xs text-left text-muted hover:bg-[var(--color-hover-row)]"
                      >
                        {filesOpen ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                        <span className="flex-1">{t.wiki_files}</span>
                        <span>{files.length}</span>
                      </button>
                      {filesOpen && (
                        <div className="ml-4.5 pl-1 border-l border-[var(--color-border-divider)] space-y-px">
                          {files.map((d) => (
                            <button
                              key={d.key}
                              type="button"
                              title={d.title !== d.rel ? `${d.rel} — ${d.title}` : d.rel}
                              onClick={(e) => onOpen(d.key, e.metaKey || e.ctrlKey)}
                              onAuxClick={(e) => {
                                if (e.button === 1) onOpen(d.key, true);
                              }}
                              aria-current={d.key === activeRef ? "page" : undefined}
                              className={rowClass(d.key === activeRef)}
                            >
                              <File size={14} className="shrink-0" />
                              <span className="flex-1 truncate">{d.rel}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <BottomBar className="justify-between">
        <span>{t.all_articles}</span>
        <span>{articles.length}</span>
      </BottomBar>

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[180px]"
          style={{ top: menu.y, left: menu.x }}
        >
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              onOpen(menu.id, true);
              setMenu(null);
            }}
          >
            <ArrowUpRight size={14} />
            {t.wiki_open_new_tab}
          </button>
          <div className="my-1 border-t border-[var(--color-border-divider)]" />
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-danger-text)] hover:bg-[var(--color-hover-row)]"
            onClick={() => {
              onDeleteArticle(menu.id);
              setMenu(null);
            }}
          >
            <Trash2 size={14} />
            {t.delete}
          </button>
        </div>
      )}
    </aside>
  );
}
