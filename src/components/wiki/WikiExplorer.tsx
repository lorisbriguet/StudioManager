import { useState, useMemo, useCallback, useEffect } from "react";
import { ChevronRight, ChevronsDownUp } from "lucide-react";
import { useT } from "../../i18n/useT";
import { useOrgStore } from "../../stores/org-store";
import { useWikiFolders } from "../../db/hooks/useWiki";
import { Dropdown, SearchBar, IconButton, SECTION_LABEL, Tooltip, ICONS, ICON_SIZE, type DropdownItem } from "../ui";
import type { WikiArticleWithTags } from "../../types/wiki";
import type { ProjectDoc } from "../../db/hooks/useProjectDocs";
import type { WikiRef } from "../../lib/wikiTabs";
import { colorFor } from "./wikiColors";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";

/** A 36px tree row with the row hairline, like a Table row. */
const ROW =
  "focus-accent w-full h-9 flex items-center gap-2 px-2 border-b border-[var(--color-border-divider)] text-sm text-left transition-colors";
/** Selected as Table.Row (accent tint), hover-row otherwise. */
const rowTone = (active: boolean) =>
  active ? "bg-accent-tint text-[var(--color-text)] font-medium" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]";
/** A row with a "more" button: room for it while it shows. */
const MORE_ROOM = "group-hover:pr-8 group-focus-within:pr-8";

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
  onDeleteArticle,
}: {
  articles: WikiArticleWithTags[];
  docs?: ProjectDoc[];
  /** The open article's id or file's key. */
  activeRef: WikiRef | null;
  colors: Map<number, string>;
  /** A new article is being created: its buttons wait. */
  creating?: boolean;
  onOpen: (ref: WikiRef) => void;
  /** Creates an article in `projectId` (the "+" on a project's group row). */
  onNewArticle: (projectId: number | null) => void;
  onDeleteArticle: (id: number) => void;
}) {
  const t = useT();
  const { data: folders = [] } = useWikiFolders();
  const storageKey = useOrgStore((s) => s.orgKey("wikiTreeOpen"));
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);

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
  const openMenu = (id: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ id, x: e.clientX, y: e.clientY });
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

  const menuItems = (id: number): ContextMenuItem[] => [
    { label: t.delete, icon: ICONS.delete, danger: true, onClick: () => onDeleteArticle(id) },
  ];
  // The same items behind a "more" button on each article row: WebKit sends no
  // contextmenu event from the keyboard, so right-click alone isn't reachable.
  const moreMenu = (id: number, title: string) => (
    <Dropdown
      align="end"
      className="absolute right-1 top-1/2 -translate-y-1/2"
      items={menuItems(id).map((it): DropdownItem => ({ label: it.label, icon: it.icon, danger: it.danger, disabled: it.disabled, onSelect: it.onClick }))}
      trigger={
        <IconButton size="xs" icon={ICONS.more} label={`${t.more_actions}: ${title}`} reveal className="group-focus-within:opacity-100" />
      }
    />
  );

  // Flat rows like a Table: a group row per project (as Table.Group: chevron, dot,
  // SectionLabel, muted count) over the header line, then 36px rows with hairlines.
  return (
    <aside aria-label={t.wiki_explorer} className="w-58 shrink-0 flex flex-col min-h-0">
      <div className="flex items-center gap-1 mb-4">
        <SearchBar value={search} onChange={setSearch} placeholder={t.search_articles} className="flex-1 min-w-0" />
        <IconButton icon={ChevronsDownUp} label={t.wiki_collapse_all} onClick={() => setOpen(new Set())} />
      </div>

      <nav role="tree" aria-label={t.wiki_explorer} onKeyDown={onTreeKeyDown} className="flex-1 overflow-y-auto space-y-3">
        {query && visibleGroups.length === 0 && <p className="px-2 py-2 text-xs text-muted">{t.wiki_explorer_no_results}</p>}
        {visibleGroups.map(({ g, list, files }) => {
          const isOpen = !!query || open.has(g.key);
          const filesKey = `${g.key}:files`;
          const filesOpen = !!query || open.has(filesKey);
          return (
            <div key={g.key} data-tree-branch>
              <div className="group h-8 flex items-center border-b border-[var(--color-border)] hover:bg-[var(--color-hover-row)]">
                <button
                  type="button"
                  data-tree-item
                  role="treeitem"
                  aria-level={1}
                  onClick={() => toggle(g.key)}
                  aria-expanded={isOpen}
                  className="focus-accent flex-1 min-w-0 h-full flex items-center gap-2 px-2 rounded text-left cursor-pointer"
                >
                  <ChevronRight size={ICON_SIZE.control} className={`shrink-0 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  <span aria-hidden="true" className="dot shrink-0" style={{ background: colorFor(colors, g.projectId) }} />
                  <span className={`truncate ${SECTION_LABEL}`}>{g.name}</span>
                  <span className="text-xs text-muted tabular-nums">{list.length + files.length}</span>
                </button>
                {g.projectId != null && (
                  <IconButton
                    size="xs"
                    icon={ICONS.add}
                    label={`${t.new_article}: ${g.name}`}
                    reveal
                    onClick={() => onNewArticle(g.projectId)}
                    disabled={creating}
                    className="mr-1"
                  />
                )}
              </div>
              {isOpen && (
                <div role="group">
                  {list.map((a) => {
                    const active = a.id === activeRef;
                    return (
                      <div key={a.id} className="group relative">
                        <button
                          data-tree-item
                          role="treeitem"
                          aria-level={2}
                          onClick={() => onOpen(a.id)}
                          onContextMenu={openMenu(a.id)}
                          aria-current={active ? "page" : undefined}
                          type="button"
                          className={`${ROW} ${rowTone(active)} ${MORE_ROOM}`}
                        >
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
                        className={`${ROW} ${rowTone(false)} text-muted`}
                      >
                        <ChevronRight size={ICON_SIZE.control} className={`shrink-0 transition-transform ${filesOpen ? "rotate-90" : ""}`} />
                        <span className="flex-1">{t.wiki_files}</span>
                        <span className="text-xs tabular-nums">{files.length}</span>
                      </button>
                      {filesOpen && (
                        <div role="group">
                          {files.map((d) => (
                            <Tooltip key={d.key} content={d.title !== d.rel ? `${d.rel} — ${d.title}` : d.rel}>
                              <button
                                type="button"
                                data-tree-item
                                role="treeitem"
                                aria-level={3}
                                onClick={() => onOpen(d.key)}
                                aria-current={d.key === activeRef ? "page" : undefined}
                                className={`${ROW} ${rowTone(d.key === activeRef)} pl-6`}
                              >
                                <ICONS.file size={ICON_SIZE.menu} className="shrink-0 text-muted" />
                                <span className="flex-1 truncate">{d.rel}</span>
                              </button>
                            </Tooltip>
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

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} />}
    </aside>
  );
}
