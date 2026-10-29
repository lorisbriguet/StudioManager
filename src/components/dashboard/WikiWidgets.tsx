import { useMemo } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ICONS, StatTile } from "../ui";
import { WidgetShell, WidgetTitle } from "./WidgetShell";
import { useWikiArticles } from "../../db/hooks/useWiki";
import { useT } from "../../i18n/useT";
import { formatDisplayDate, parseDbDate } from "../../utils/formatDate";

const RECENT_LIMIT = 8;
const WEEK_MS = 7 * 86_400_000;

/** Dashboard widget: the articles edited last, newest first; a click opens one in the Wiki. */
export function WikiRecentWidget() {
  const t = useT();
  const { data: articles } = useWikiArticles();

  const recent = useMemo(
    () =>
      [...(articles ?? [])]
        .sort((a, b) => parseDbDate(b.updated_at).getTime() - parseDbDate(a.updated_at).getTime())
        .slice(0, RECENT_LIMIT),
    [articles],
  );

  return (
    <WidgetShell>
      <WidgetTitle>{t.wiki_recent_widget}</WidgetTitle>
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-1.5">
        {recent.map((a) => (
          <Link
            key={a.id}
            to={`/wiki?article=${a.id}`}
            className="flex items-center justify-between gap-2 text-sm hover:bg-[var(--color-hover-row)] rounded-md px-2 py-1 -mx-2"
          >
            <span className="truncate">
              {a.title}
              {a.project_name && <span className="text-muted"> · {a.project_name}</span>}
            </span>
            <span className="text-xs text-muted shrink-0">{formatDisplayDate(a.updated_at)}</span>
          </Link>
        ))}
        {articles !== undefined && recent.length === 0 && (
          <EmptyState size="sm" icon={ICONS.wikiArticle} message={t.wiki_widget_empty} />
        )}
      </div>
    </WidgetShell>
  );
}

/** Dashboard widget: how big the wiki is and how much of it moved this week. */
export function WikiOverviewWidget() {
  const t = useT();
  const { data: articles } = useWikiArticles();

  const { total, week, projects } = useMemo(() => {
    const list = articles ?? [];
    const since = Date.now() - WEEK_MS;
    return {
      total: list.length,
      week: list.filter((a) => parseDbDate(a.updated_at).getTime() >= since).length,
      projects: new Set(list.filter((a) => a.project_id != null).map((a) => a.project_id)).size,
    };
  }, [articles]);

  return (
    <Link to="/wiki" className="block h-full">
      <StatTile
        className="h-full justify-center p-4"
        label={t.wiki_articles}
        value={total}
        caption={`${week} ${t.wiki_edited_this_week} · ${projects} ${t.wiki_projects_with_articles}`}
      />
    </Link>
  );
}
