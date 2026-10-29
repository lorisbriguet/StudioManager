import { useState, useEffect } from "react";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";
import { Plus, ExternalLink, Bookmark, X } from "lucide-react";
import {
  useResourcesByProject,
  useLinkResourceToProject,
  useUnlinkResourceFromProject,
} from "../../db/hooks/useResources";
import { getResources } from "../../db/queries/resources";
import { Button, EmptyState, IconButton, ListSkeleton } from "../ui";
import { useT } from "../../i18n/useT";
import { deleteWithUndo } from "../../lib/undo";
import { LinkPicker } from "./LinkPicker";

export function ProjectResources({ projectId }: { projectId: number }) {
  const t = useT();
  const { data: linked, isPending } = useResourcesByProject(projectId);
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
      {isPending && <ListSkeleton size="sm" rows={2} />}
      {linked?.length === 0 && !showPicker && (
        <EmptyState size="sm" icon={Bookmark} message={t.no_resources_linked} />
      )}
      {(linked ?? []).map((r) => (
        <div key={r.id} className="flex items-center gap-2 py-1 group text-sm">
          <Button
            variant="link"
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
          <IconButton icon={X} label={t.remove} size="xs" tone="danger" reveal onClick={() => deleteWithUndo(unlinkResource, { resourceId: r.id, projectId }, t.resource_unlinked)} />
        </div>
      ))}
      {showPicker ? (
        <LinkPicker
          emptyMessage={t.no_resources_to_link}
          onCancel={() => setShowPicker(false)}
          items={unlinked.map((r) => ({
            id: r.id,
            icon: <Bookmark size={12} className="text-muted" />,
            label: r.name,
            trailing: (
              <span className="text-xs text-muted ml-auto truncate max-w-[150px]">
                {r.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </span>
            ),
            onPick: () => {
              linkResource.mutate({ resourceId: r.id, projectId });
              setShowPicker(false);
            },
          }))}
        />
      ) : (
        <Button variant="link" icon={<Plus size={12} />} onClick={() => setShowPicker(true)} className="mt-1">
          {t.add}
        </Button>
      )}
    </div>
  );
}
