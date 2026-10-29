import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button, Card, EmptyState, IconButton, SearchBar, SectionLabel, POPOVER_SURFACE, ICONS } from "../ui";
import { Toggle } from "../ui/Toggle";
import { useT } from "../../i18n/useT";
import { useOrgStore } from "../../stores/org-store";
import type { WikiArticleWithTags, WikiFolder } from "../../types/wiki";
import { buildWikiGraph, neighbourhood, type GraphDoc, type LinkIndex } from "../../lib/wikiGraph";
import type { WikiRef } from "../../lib/wikiTabs";
import { USER_GUIDE_FOLDER } from "../../db/seeds/user-guide";
import { GraphView, type GraphBox } from "./GraphView";
import { colorFor, NO_PROJECT_COLOR } from "./wikiColors";

/** The settings panel's width plus its margins: the graph fits beside it. */
const SETTINGS_SPACE = 256 + 16 + 16;

interface GraphSettings {
  scope: "global" | "local";
  filter: string;
  hiddenProjects: string[];
  showOrphans: boolean;
  showGuide: boolean;
  showFiles: boolean;
  alwaysLabels: boolean;
  settingsOpen: boolean;
}

const DEFAULTS: GraphSettings = {
  scope: "global",
  filter: "",
  hiddenProjects: [],
  showOrphans: true,
  showGuide: false,
  showFiles: true,
  alwaysLabels: false,
  settingsOpen: true,
};

function readSettings(key: string): GraphSettings {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GraphSettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function WikiGraph({
  articles,
  docs = [],
  folders,
  index,
  colors,
  activeRef,
  onOpen,
  savedView = null,
  onViewChange,
}: {
  articles: WikiArticleWithTags[];
  /** Project files: drawn hollow, linked to the articles and files that link them. */
  docs?: GraphDoc[];
  folders: WikiFolder[];
  index: LinkIndex;
  colors: Map<number, string>;
  /** The last article or file you had open: the centre of "current only". */
  activeRef: WikiRef | null;
  onOpen: (ref: WikiRef, newTab: boolean) => void;
  /** Zoom and pan to come back to, kept by the page while it is open. */
  savedView?: GraphBox | null;
  onViewChange?: (view: GraphBox | null) => void;
}) {
  const t = useT();
  // Remembered per organisation (project ids differ between them).
  const storageKey = useOrgStore((s) => s.orgKey("wikiGraphSettings"));
  const [settings, setSettings] = useState<GraphSettings>(() => readSettings(storageKey));
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch {
      // Storage unavailable: the settings just won't be remembered.
    }
  }, [settings, storageKey]);
  const set = <K extends keyof GraphSettings>(key: K) => (value: GraphSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const { scope, filter, showOrphans, showGuide, showFiles, alwaysLabels, settingsOpen } = settings;
  const hiddenProjects = useMemo(() => new Set(settings.hiddenProjects), [settings.hiddenProjects]);

  const guideFolders = useMemo(
    () => new Set(folders.filter((f) => f.name === USER_GUIDE_FOLDER).map((f) => f.id)),
    [folders]
  );

  const graph = useMemo(() => buildWikiGraph(articles, docs, index), [articles, docs, index]);
  const focusId = useMemo(
    () => (activeRef == null ? null : graph.items.find((i) => i.ref === activeRef)?.id ?? null),
    [graph, activeRef]
  );
  const local = scope === "local" && focusId != null;

  const projects = useMemo(() => {
    const map = new Map<string, { key: string; id: number | null; name: string; count: number }>();
    for (const item of graph.items) {
      const key = item.project_id == null ? "none" : String(item.project_id);
      const p = map.get(key) ?? { key, id: item.project_id, name: item.project_name ?? t.no_project, count: 0 };
      p.count++;
      map.set(key, p);
    }
    return [...map.values()].sort((x, y) => (x.id == null ? 1 : y.id == null ? -1 : x.name.localeCompare(y.name)));
  }, [graph, t.no_project]);

  const { nodes, edges } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let pool = graph.items;
    if (local && focusId != null) {
      const keep = neighbourhood(focusId, graph.edges);
      pool = pool.filter((i) => keep.has(i.id));
    }
    // The filters apply in both views; the article in focus always stays.
    pool = pool.filter(
      (i) =>
        (local && i.id === focusId) ||
        ((showFiles || !i.file) &&
          (showGuide || i.folder_id == null || !guideFolders.has(i.folder_id)) &&
          !hiddenProjects.has(i.project_id == null ? "none" : String(i.project_id)) &&
          (!q || i.search.includes(q)))
    );
    const visible = new Set(pool.map((i) => i.id));
    let edges = graph.edges.filter(([a, b]) => visible.has(a) && visible.has(b));
    if (!showOrphans && !local) {
      const linked = new Set(edges.flat());
      pool = pool.filter((i) => linked.has(i.id));
      edges = edges.filter(([a, b]) => linked.has(a) && linked.has(b));
    }
    return { nodes: pool, edges };
  }, [graph, filter, showFiles, showGuide, guideFolders, hiddenProjects, local, focusId, showOrphans]);

  const refOf = useMemo(() => new Map(graph.items.map((i) => [i.id, i.ref])), [graph]);
  const openNode = (id: number, newTab: boolean) => {
    const ref = refOf.get(id);
    if (ref !== undefined) onOpen(ref, newTab);
  };

  const toggleProject = (key: string) =>
    setSettings((s) => ({
      ...s,
      hiddenProjects: s.hiddenProjects.includes(key)
        ? s.hiddenProjects.filter((k) => k !== key)
        : [...s.hiddenProjects, key],
    }));
  const resetFilters = () => setSettings((s) => ({ ...DEFAULTS, settingsOpen: s.settingsOpen }));

  const fileCount = nodes.filter((n) => n.file).length;
  const stats = t.wiki_graph_stats
    .replace("{articles}", String(nodes.length - fileCount))
    .replace("{files}", String(fileCount))
    .replace("{links}", String(edges.length));

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden bg-[var(--color-bg)]">
      {nodes.length === 0 ? (
        <div className="h-full flex items-center justify-center">
          <EmptyState
            message={t.wiki_graph_empty}
            icon={ICONS.graph}
            action={
              <Button variant="secondary" icon={ICONS.restore} onClick={resetFilters}>
                {t.wiki_graph_reset_filters}
              </Button>
            }
          />
        </div>
      ) : (
        <GraphView
          nodes={nodes}
          edges={edges}
          colors={colors}
          focusId={focusId}
          alwaysLabels={alwaysLabels}
          onOpen={openNode}
          label={stats}
          initialView={savedView}
          onViewChange={onViewChange}
          reserveRight={settingsOpen ? SETTINGS_SPACE : 0}
        />
      )}

      <section
        aria-label={t.wiki_graph_settings}
        className={`${POPOVER_SURFACE} absolute top-4 right-4 w-64 p-3 space-y-3`}
      >
        <Card.Header
          className=""
          title={t.wiki_graph_settings}
          action={
            <IconButton
              icon={settingsOpen ? ChevronUp : ChevronDown}
              label={t.wiki_graph_settings}
              aria-expanded={settingsOpen}
              onClick={() => set("settingsOpen")(!settingsOpen)}
            />
          }
        />

        {settingsOpen && (
          <>
            <SearchBar value={filter} onChange={set("filter")} placeholder={t.wiki_graph_filter} className="w-full" />

            <div>
              <SectionLabel className="mb-1">{t.wiki_graph_display}</SectionLabel>
              {[
                [t.wiki_graph_local, scope === "local", (v: boolean) => set("scope")(v ? "local" : "global"), focusId == null] as const,
                [t.wiki_graph_files, showFiles, set("showFiles"), false] as const,
                [t.wiki_graph_orphans, showOrphans, set("showOrphans"), local] as const,
                [t.wiki_graph_guide, showGuide, set("showGuide"), false] as const,
                [t.wiki_graph_labels, alwaysLabels, set("alwaysLabels"), false] as const,
              ].map(([text, value, onChange, disabled]) => (
                <div key={text} className="flex items-center justify-between gap-3 py-1 text-xs">
                  <span className={disabled ? "text-muted" : ""}>{text}</span>
                  <Toggle checked={value} onChange={onChange} disabled={disabled} ariaLabel={text} />
                </div>
              ))}
            </div>

            <div>
              <SectionLabel className="mb-1">{t.wiki_graph_groups}</SectionLabel>
              <div className="max-h-48 overflow-y-auto -mx-1 space-y-px">
                {projects.map((p) => {
                  const shown = !hiddenProjects.has(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={shown}
                      onClick={() => toggleProject(p.key)}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs text-left transition-colors hover:bg-[var(--color-hover-row)] ${
                        shown ? "text-[var(--color-text-secondary)]" : "text-muted opacity-50"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="dot shrink-0"
                        style={{ background: p.id == null ? NO_PROJECT_COLOR : colorFor(colors, p.id) }}
                      />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-muted">{p.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </section>

      {nodes.length > 0 && <div className="absolute right-4 bottom-4 text-xs text-muted">{stats}</div>}
    </div>
  );
}
