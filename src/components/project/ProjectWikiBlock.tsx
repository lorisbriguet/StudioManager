import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, BookOpen } from "lucide-react";
import { useWikiArticlesByProject, useWikiArticles, useUpdateWikiArticle } from "../../db/hooks/useWiki";
import { Button } from "../ui";
import { useT } from "../../i18n/useT";
import { getTagColor } from "../../lib/tagColors";
import { useAppStore } from "../../stores/app-store";

export function ProjectWikiBlock({ projectId }: { projectId: number }) {
  const t = useT();
  const navigate = useNavigate();
  const darkMode = useAppStore((s) => s.darkMode);
  const { data: wikiArticles } = useWikiArticlesByProject(projectId);
  const { data: allArticles = [] } = useWikiArticles();
  const updateWikiArticle = useUpdateWikiArticle();
  const [showPicker, setShowPicker] = useState(false);

  const linkedIds = new Set((wikiArticles ?? []).map((a) => a.id));
  const unlinked = allArticles.filter((a) => !linkedIds.has(a.id));

  return (
    <div className="text-sm">
      {(!wikiArticles || wikiArticles.length === 0) && !showPicker && (
        <div className="text-muted">{t.no_wiki_articles_linked}</div>
      )}
      {wikiArticles && wikiArticles.length > 0 && (
        <div className="divide-y divide-[var(--color-border-divider)]">
          {wikiArticles.map((article: { id: number; title: string; tags?: string[] }) => (
            <button
              key={article.id}
              onClick={() => navigate(`/wiki?article=${article.id}`)}
              className="w-full flex items-center gap-2 py-1.5 text-left hover:bg-[var(--color-hover-row)] rounded-md px-1 transition-colors"
            >
              <BookOpen size={14} className="text-muted shrink-0" />
              <span className="text-sm truncate">{article.title}</span>
              <div className="flex items-center gap-1 ml-auto shrink-0">
                {(article.tags ?? []).map((tag: string) => {
                  const c = getTagColor(tag, darkMode);
                  return (
                    <span
                      key={tag}
                      style={{ background: c.bg, color: c.text }}
                      className="px-2 py-0.5 text-xs rounded-full font-medium"
                    >
                      {tag}
                    </span>
                  );
                })}
              </div>
            </button>
          ))}
        </div>
      )}
      {showPicker ? (
        <div className="mt-2 border border-[var(--color-border-divider)] rounded-xl p-2">
          {unlinked.length === 0 ? (
            <div className="text-xs text-muted">{t.no_articles_yet}</div>
          ) : (
            <div className="max-h-32 overflow-y-auto space-y-1">
              {unlinked.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    updateWikiArticle.mutate({ id: a.id, data: { project_id: projectId } });
                    setShowPicker(false);
                  }}
                  className="w-full text-left px-2 py-1 text-sm hover:bg-[var(--color-hover-row)] rounded-md flex items-center gap-2"
                >
                  <BookOpen size={12} className="text-muted" />
                  {a.title}
                  {a.tags && a.tags.length > 0 && (
                    <div className="flex items-center gap-1 ml-auto shrink-0">
                      {a.tags.map((tag: string) => {
                        const c = getTagColor(tag, darkMode);
                        return (
                          <span
                            key={tag}
                            style={{ background: c.bg, color: c.text }}
                            className="px-1.5 py-0.5 text-[10px] rounded-full font-medium"
                          >
                            {tag}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setShowPicker(false)} className="text-xs text-muted mt-1 hover:text-[var(--color-text)]">
            {t.cancel}
          </button>
        </div>
      ) : (
        <Button variant="link" size="sm" icon={<Plus size={12} />} onClick={() => setShowPicker(true)} className="mt-1">
          {t.link_article}
        </Button>
      )}
    </div>
  );
}
