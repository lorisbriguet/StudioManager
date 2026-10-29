import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWikiArticlesByProject, useWikiArticles, useUpdateWikiArticle } from "../../db/hooks/useWiki";
import { Button, EmptyState, ICONS, ICON_SIZE, ListSkeleton, Tag } from "../ui";
import { useT } from "../../i18n/useT";
import { LinkPicker } from "./LinkPicker";

export function ProjectWikiBlock({ projectId }: { projectId: number }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: wikiArticles, isPending } = useWikiArticlesByProject(projectId);
  const { data: allArticles = [] } = useWikiArticles();
  const updateWikiArticle = useUpdateWikiArticle();
  const [showPicker, setShowPicker] = useState(false);

  const linkedIds = new Set((wikiArticles ?? []).map((a) => a.id));
  const unlinked = allArticles.filter((a) => !linkedIds.has(a.id));

  return (
    <div className="text-sm">
      {isPending && <ListSkeleton size="sm" rows={2} />}
      {wikiArticles?.length === 0 && !showPicker && (
        <EmptyState size="sm" icon={ICONS.wikiArticle} message={t.no_wiki_articles_linked} />
      )}
      {wikiArticles && wikiArticles.length > 0 && (
        <div className="divide-y divide-[var(--color-border-divider)]">
          {wikiArticles.map((article: { id: number; title: string; tags?: string[] }) => (
            <button
              key={article.id}
              onClick={() => navigate(`/wiki?article=${article.id}`)}
              className="w-full flex items-center gap-2 py-1.5 text-left hover:bg-[var(--color-hover-row)] rounded-md px-1 transition-colors"
            >
              <ICONS.wikiArticle size={ICON_SIZE.menu} className="text-muted shrink-0" />
              <span className="text-sm truncate">{article.title}</span>
              <div className="flex items-center gap-1 ml-auto shrink-0">
                {(article.tags ?? []).map((tag: string) => (
                  <Tag key={tag} name={tag} />
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
      {showPicker ? (
        <LinkPicker
          emptyMessage={t.no_articles_to_link}
          onCancel={() => setShowPicker(false)}
          items={unlinked.map((a) => ({
            id: a.id,
            icon: ICONS.wikiArticle,
            label: a.title,
            trailing: a.tags && a.tags.length > 0 && (
              <span className="flex items-center gap-1 ml-auto shrink-0">
                {a.tags.map((tag: string) => (
                  <Tag key={tag} name={tag} size="xs" />
                ))}
              </span>
            ),
            onPick: () => {
              updateWikiArticle.mutate({ id: a.id, data: { project_id: projectId } });
              setShowPicker(false);
            },
          }))}
        />
      ) : (
        <Button variant="link" icon={ICONS.link} onClick={() => setShowPicker(true)} className="mt-1">
          {t.link_article}
        </Button>
      )}
    </div>
  );
}
