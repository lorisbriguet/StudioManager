import { useState, useMemo, useCallback, useEffect } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp } from "lucide-react";
import { useT } from "../../i18n/useT";
import { useOrgStore } from "../../stores/org-store";
import { useWikiFolders } from "../../db/hooks/useWiki";
import { BottomBar, Dropdown, SearchBar, IconButton, SectionLabel, Tooltip, ICONS, ICON_SIZE, type DropdownItem } from "../ui";
import type { WikiArticleWithTags } from "../../types/wiki";
import type { ProjectDoc } from "../../db/hooks/useProjectDocs";
import type { WikiRef } from "../../lib/wikiTabs";
import { colorFor } from "./wikiColors";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { navItemClass } from "../ui/NavItem";

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
  pageHeading = false,
}: {
  /**
   * Nothing open that has its own h1 (graph, empty state): the "Wiki" label is
   * the page h1. With an article or file open, its title is the h1 and this is an h2.
   */
  pageHeading?: boolean;
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
  const [menu, setMenu] = useState<{ ref: WikiRef; x: number; y: number } | null>(null);

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
  const rowClass = (active: boolean) => navItemClass({ active });
  const openMenu = (ref: WikiRef) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ ref, x: e.clientX, y: e.clientY });
  };

  // Arrow keys move through the visible rows; Right opens a group, Left
  // closes it or goes up to it.
  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const current = e.target as HTMLElement;
    if (!current.matches("[data-tree-item]")) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-tree-item]")];
    const i = items.indexOf(current);
    const expanded = current.getAttribute("aria-expanded");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[e.key === "ArrowDown" ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0)]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "ArrowRight" && expanded === "false") {
      e.preventDefault();
      current.click();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (expanded === "true") current.click();
      else current.closest("[data-tree-branch]")?.querySelector<HTMLElement>("[data-tree-item]")?.focus();
    }
  };

  const visibleGroups = groups
    .map((g) => ({ g, list: g.articles.filter(matches), files: g.docs.filter(docMatches) }))
    .filter(({ list, files }) => !query || list.length > 0 || files.length > 0);

  const menuItems = (ref: WikiRef): ContextMenuItem[] => [
    { label: t.wiki_open_new_tab, icon: ICONS.newTab, onClick: () => onOpen(ref, true) },
    ...(typeof ref === "number"
      ? [
          { label: "", onClick: () => {}, divider: true },
          { label: t.delete, icon: ICONS.delete, danger: true, onClick: () => onDeleteArticle(ref) },
        ]
      : []),
  ];
  // The same items behind a "more" button on each row: WebKit sends no
  // contextmenu event from the keyboard, so right-click alone isn't reachable.
  const moreMenu = (ref: WikiRef, title: string) => (
    <Dropdown
      align="end"
      className="absolute right-1 top-1/2 -translate-y-1/2"
      items={menuItems(ref).map((it): DropdownItem =>
        it.divider ? { divider: true } : { label: it.label, icon: it.icon, danger: it.danger, disabled: it.disabled, onSelect: it.onClick }
      )}
      trigger={
        <IconButton size="xs" icon={ICONS.more} label={`${t.more_actions}: ${title}`} reveal className="group-focus-within:opacity-100" />
      }
    />
  );
  /** A tree row with a "more" button: room for it while it shows. */
  const MORE_ROOM = "group-hover:pr-8 group-focus-within:pr-8";

  return (
    <aside
      aria-label={t.wiki_explorer}
      className="w-60 shrink-0 flex flex-col min-h-0 border-r border-[var(--color-border-divider)]"
    >
      <div className="px-3 pt-5 pb-2 space-y-3">
        <SectionLabel as={pageHeading ? "h1" : "h2"} className="px-2">{t.wiki}</SectionLabel>
        <SearchBar value={search} onChange={setSearch} placeholder={t.search_articles} className="w-full" />
        <div className="flex items-center gap-1 px-1">
          <IconButton icon={ICONS.add} label={t.new_article} onClick={() => onNewArticle(null)} disabled={creating} />
          <IconButton icon={ChevronsDownUp} label={t.wiki_collapse_all} onClick={() => setOpen(new Set())} />
          <IconButton icon={ICONS.graph} label={t.wiki_open_graph} onClick={onOpenGraph} className="ml-auto" />
        </div>
      </div>

      <nav
        role="tree"
        aria-label={t.wiki_explorer}
        onKeyDown={onTreeKeyDown}
        className="flex-1 overflow-y-auto px-1.5 pb-3 space-y-px"
      >
        {query && visibleGroups.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted">{t.wiki_explorer_no_results}</p>
        )}
        {visibleGroups.map(({ g, list, files }) => {
          const isOpen = !!query || open.has(g.key);
          const filesKey = `${g.key}:files`;
          const filesOpen = !!query || open.has(filesKey);
          return (
            <div key={g.key} data-tree-branch>
              <div className="group flex items-center rounded-md hover:bg-[var(--color-hover-row)]">
                <button
                  type="button"
                  data-tree-item
                  role="treeitem"
                  aria-level={1}
                  onClick={() => toggle(g.key)}
                  aria-expanded={isOpen}
                  className="flex-1 min-w-0 flex items-center gap-2 py-1.5 pl-3 pr-1 text-sm font-medium text-left text-[var(--color-text)]"
                >
                  {isOpen ? (
                    <ChevronDown size={ICON_SIZE.menu} className="shrink-0 text-muted" />
                  ) : (
                    <ChevronRight size={ICON_SIZE.menu} className="shrink-0 text-muted" />
                  )}
                  <span aria-hidden="true" className="dot shrink-0" style={{ background: colorFor(colors, g.projectId) }} />
                  <span className="flex-1 truncate">{g.name}</span>
                  <span className="text-xs font-normal text-muted">{list.length + files.length}</span>
                </button>
                {g.projectId != null && (
                  <IconButton size="xs"
                    icon={ICONS.add}
                    label={`${t.new_article}: ${g.name}`}
                    reveal
                    onClick={() => onNewArticle(g.projectId)}
                    disabled={creating}
                    className="mr-2"
                  />
                )}
              </div>
              {isOpen && (
                <div role="group" className="ml-4.5 pl-1 border-l border-[var(--color-border-divider)] space-y-px">
                  {list.map((a) => {
                    const active = a.id === activeRef;
                    return (
                      <div key={a.id} className="group relative">
                      <button
                        data-tree-item
                        role="treeitem"
                        aria-level={2}
                        onClick={(e) => onOpen(a.id, e.metaKey || e.ctrlKey)}
                        onAuxClick={(e) => {
                          if (e.button === 1) onOpen(a.id, true);
                        }}
                        onContextMenu={openMenu(a.id)}
                        aria-current={active ? "page" : undefined}
                        type="button"
                        className={`${rowClass(active)} ${MORE_ROOM}`}
                      >
                        <ICONS.wikiArticle size={ICON_SIZE.menu} className="shrink-0" />
                        <span className="flex-1 truncate">{a.title}</span>
                      </button>
                      {moreMenu(a.id, a.title)}
                      </div>
                    );
                  })}
                  {files.length > 0 && (
                    <div data-tree-branch>
                      <button
                        type="button"
                        data-tree-item
                        role="treeitem"
                        aria-level={2}
                        onClick={() => toggle(filesKey)}
                        aria-expanded={filesOpen}
                        className="w-full flex items-center gap-2 py-1.5 pl-3 pr-2 rounded-md text-sm text-left text-muted hover:bg-[var(--color-hover-row)]"
                      >
                        {filesOpen ? <ChevronDown size={ICON_SIZE.menu} className="shrink-0" /> : <ChevronRight size={ICON_SIZE.menu} className="shrink-0" />}
                        <span className="flex-1">{t.wiki_files}</span>
                        <span className="text-xs">{files.length}</span>
                      </button>
                      {filesOpen && (
                        <div role="group" className="ml-4.5 pl-1 border-l border-[var(--color-border-divider)] space-y-px">
                          {files.map((d) => (
                            <div key={d.key} className="group relative">
                            <Tooltip content={d.title !== d.rel ? `${d.rel} — ${d.title}` : d.rel}>
                            <button
                              type="button"
                              data-tree-item
                              role="treeitem"
                              aria-level={3}
                              onClick={(e) => onOpen(d.key, e.metaKey || e.ctrlKey)}
                              onAuxClick={(e) => {
                                if (e.button === 1) onOpen(d.key, true);
                              }}
                              onContextMenu={openMenu(d.key)}
                              aria-current={d.key === activeRef ? "page" : undefined}
                              className={`${rowClass(d.key === activeRef)} ${MORE_ROOM}`}
                            >
                              <ICONS.file size={ICON_SIZE.menu} className="shrink-0" />
                              <span className="flex-1 truncate">{d.rel}</span>
                            </button>
                            </Tooltip>
                            {moreMenu(d.key, d.rel)}
                            </div>
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

      <BottomBar>
        <span>
          {t.wiki_footer_counts.replace("{articles}", String(articles.length)).replace("{files}", String(docs.length))}
        </span>
      </BottomBar>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.ref)} onClose={() => setMenu(null)} />}
    </aside>
  );
}
