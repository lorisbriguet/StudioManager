import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SearchBar, IconButton, SectionLabel } from "../ui";
import { Toggle } from "../ui/Toggle";
import { useT } from "../../i18n/useT";
import type { WikiArticleWithTags, WikiFolder } from "../../types/wiki";
import { buildWikiGraph, neighbourhood, type GraphDoc, type LinkIndex } from "../../lib/wikiGraph";
import type { WikiRef } from "../../lib/wikiTabs";
import { GraphView } from "./GraphView";
import { colorFor, NO_PROJECT_COLOR } from "./wikiColors";

const GUIDE_FOLDER = "User Guide";

export function WikiGraph({
  articles,
  docs = [],
  folders,
  index,
  colors,
  activeRef,
  onOpen,
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
}) {
  const t = useT();
  const [scope, setScope] = useState<"global" | "local">("global");
  const [filter, setFilter] = useState("");
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(new Set());
  const [showOrphans, setShowOrphans] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const [alwaysLabels, setAlwaysLabels] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);

  const guideFolders = useMemo(
    () => new Set(folders.filter((f) => f.name === GUIDE_FOLDER).map((f) => f.id)),
    [folders]
  );

  const graph = useMemo(() => buildWikiGraph(articles, docs, index), [articles, docs, index]);
  const focusId = useMemo(
    () => (activeRef == null ? null : graph.items.find((i) => i.ref === activeRef)?.id ?? null),
    [graph, activeRef]
  );

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
    if (scope === "local" && focusId != null) {
      const keep = neighbourhood(focusId, graph.edges);
      pool = pool.filter((i) => keep.has(i.id));
    } else {
      pool = pool.filter(
        (i) =>
          (showFiles || !i.file) &&
          (showGuide || i.folder_id == null || !guideFolders.has(i.folder_id)) &&
          !hiddenProjects.has(i.project_id == null ? "none" : String(i.project_id)) &&
          (!q || i.search.includes(q))
      );
    }
    const visible = new Set(pool.map((i) => i.id));
    let edges = graph.edges.filter(([a, b]) => visible.has(a) && visible.has(b));
    if (!showOrphans && scope === "global") {
      const linked = new Set(edges.flat());
      pool = pool.filter((i) => linked.has(i.id));
      edges = edges.filter(([a, b]) => linked.has(a) && linked.has(b));
    }
    return { nodes: pool, edges };
  }, [graph, filter, showFiles, showGuide, guideFolders, hiddenProjects, scope, focusId, showOrphans]);

  const refOf = useMemo(() => new Map(graph.items.map((i) => [i.id, i.ref])), [graph]);
  const openNode = (id: number, newTab: boolean) => {
    const ref = refOf.get(id);
    if (ref !== undefined) onOpen(ref, newTab);
  };

  const toggleProject = (key: string) =>
    setHiddenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden bg-[var(--color-bg)]">
      {nodes.length === 0 ? (
        <div className="h-full flex items-center justify-center text-sm text-muted">{t.wiki_graph_empty}</div>
      ) : (
        <GraphView
          nodes={nodes}
          edges={edges}
          colors={colors}
          focusId={focusId}
          alwaysLabels={alwaysLabels}
          onOpen={openNode}
          label={t.wiki_graph_stats.replace("{articles}", String(nodes.length)).replace("{links}", String(edges.length))}
        />
      )}

      <section
        aria-label={t.wiki_graph_settings}
        className="absolute top-4 right-4 w-64 bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-menu p-3 space-y-3"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold tracking-tight">{t.wiki_graph_settings}</span>
          <IconButton
            icon={settingsOpen ? ChevronUp : ChevronDown}
            label={t.wiki_graph_settings}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((o) => !o)}
          />
        </div>

        {settingsOpen && (
          <>
            <SearchBar value={filter} onChange={setFilter} placeholder={t.wiki_graph_filter} className="w-full" />

            <div>
              <SectionLabel className="mb-1">{t.wiki_graph_display}</SectionLabel>
              {[
                [t.wiki_graph_local, scope === "local", (v: boolean) => setScope(v ? "local" : "global"), focusId == null] as const,
                [t.wiki_graph_files, showFiles, setShowFiles, scope === "local"] as const,
                [t.wiki_graph_orphans, showOrphans, setShowOrphans, scope === "local"] as const,
                [t.wiki_graph_guide, showGuide, setShowGuide, false] as const,
                [t.wiki_graph_labels, alwaysLabels, setAlwaysLabels, false] as const,
              ].map(([text, value, set, disabled]) => (
                <div key={text} className="flex items-center justify-between gap-3 py-1 text-xs">
                  <span className={disabled ? "text-muted" : ""}>{text}</span>
                  <Toggle checked={value} onChange={set} disabled={disabled} ariaLabel={text} />
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

      <div className="absolute right-4 bottom-4 text-xs text-muted">
        {t.wiki_graph_stats.replace("{articles}", String(nodes.length)).replace("{links}", String(edges.length))}
      </div>
    </div>
  );
}
