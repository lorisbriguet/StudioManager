import { useState, useEffect } from "react";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";
import { Plus, ExternalLink, Bookmark, X } from "lucide-react";
import {
  useResourcesByProject,
  useLinkResourceToProject,
  useUnlinkResourceFromProject,
} from "../../db/hooks/useResources";
import { getResources } from "../../db/queries/resources";
import { Button } from "../ui";
import { useT } from "../../i18n/useT";

export function ProjectResources({ projectId }: { projectId: number }) {
  const t = useT();
  const { data: linked } = useResourcesByProject(projectId);
  const linkResource = useLinkResourceToProject();
  const unlinkResource = useUnlinkResourceFromProject();
  const [showPicker, setShowPicker] = useState(false);
  const [allResources, setAllResources] = useState<{ id: number; name: string; url: string }[]>([]);

  useEffect(() => {
    if (showPicker) {
      getResources().then(setAllResources);
    }
  }, [showPicker]);

  const linkedIds = new Set((linked ?? []).map((r) => r.id));
  const unlinked = allResources.filter((r) => !linkedIds.has(r.id));

  return (
    <div>
      {(linked ?? []).length === 0 && !showPicker && (
        <div className="text-xs text-muted mb-2">{t.no_resources_yet}</div>
      )}
      {(linked ?? []).map((r) => (
        <div key={r.id} className="flex items-center gap-2 py-1 group text-sm">
          <Button
            variant="link"
            size="md"
            icon={<ExternalLink size={12} />}
            onClick={() => {
              let u = r.url;
              if (u && !u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
              openExternalUrl(u);
            }}
            className="truncate max-w-[300px]"
          >
            {r.name}
          </Button>
          <span className="text-xs text-muted truncate max-w-[200px]">
            {r.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </span>
          <button
            onClick={() => unlinkResource.mutate({ resourceId: r.id, projectId })}
            className="text-danger opacity-0 group-hover:opacity-100"
            aria-label={t.remove}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {showPicker ? (
        <div className="mt-2 border border-[var(--color-border-divider)] rounded-xl p-2">
          {unlinked.length === 0 ? (
            <div className="text-xs text-muted">{t.no_matching_resources}</div>
          ) : (
            <div className="max-h-32 overflow-y-auto space-y-1">
              {unlinked.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    linkResource.mutate({ resourceId: r.id, projectId });
                    setShowPicker(false);
                  }}
                  className="w-full text-left px-2 py-1 text-sm hover:bg-[var(--color-hover-row)] rounded-md flex items-center gap-2"
                >
                  <Bookmark size={12} className="text-muted" />
                  {r.name}
                  <span className="text-xs text-muted ml-auto truncate max-w-[150px]">
                    {r.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </span>
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
          {t.add}
        </Button>
      )}
    </div>
  );
}
