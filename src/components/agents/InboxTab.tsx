import { useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../i18n/useT";
import type { UIKey } from "../../i18n/ui";
import { useBriefAgain, useCaptures, useDismissCapture, useRestoreCapture } from "../../db/hooks/useCaptures";
import type { CaptureRow } from "../../db/queries/captures";
import type { CaptureSource, CaptureStatus } from "../../types/capture";
import { formatDisplayDateTime } from "../../utils/formatDate";
import { Badge, Button, EmptyState, ICONS, SegmentedControl } from "../ui";
import { FileCaptureForm } from "./FileCaptureForm";

/** A capture is tried this many times by the brief session, then it shows as failed. */
const MAX_TRIES = 3;

const SOURCE_KEYS: Record<CaptureSource, UIKey> = {
  hotkey: "capture_source_hotkey",
  menubar: "capture_source_menubar",
  agent: "capture_source_agent",
  reminders: "capture_source_reminders",
};

/**
 * The Inbox tab: captured thoughts as flat rows under a New / Filed / Dismissed switch. A new
 * row can be filed by hand (the form opens in the right column), dismissed, or, when the
 * brief session failed or found no project, briefed again.
 */
export function InboxTab() {
  const t = useT();
  const [status, setStatus] = useState<CaptureStatus>("new");
  const [filing, setFiling] = useState<number | null>(null);
  const { data: rows = [] } = useCaptures(status);
  const dismiss = useDismissCapture();
  const restore = useRestoreCapture();
  const briefAgain = useBriefAgain();
  const filingRow = status === "new" ? rows.find((r) => r.id === filing) : undefined;

  return (
    <div className="flex flex-1 min-h-0 gap-8">
      <section aria-label={t.agents_tab_inbox} className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="mb-3">
          <SegmentedControl
            aria-label={t.agents_tab_inbox}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setFiling(null);
            }}
            options={[
              { value: "new", label: t.capture_status_new },
              { value: "filed", label: t.capture_status_filed },
              { value: "dismissed", label: t.capture_status_dismissed },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={ICONS.inbox} message={t.capture_inbox_empty} />
        ) : (
          <ul className="flex-1 min-h-0 overflow-y-auto border-t border-[var(--color-border)]">
            {rows.map((c) => (
              <CaptureItem
                key={c.id}
                capture={c}
                selected={c.id === filing}
                onFile={() => setFiling(c.id)}
                onDismiss={() => dismiss.mutate(c.id)}
                onRestore={() => restore.mutate(c.id)}
                onBriefAgain={() => briefAgain.mutate(c.id)}
              />
            ))}
          </ul>
        )}
      </section>
      {filingRow && (
        <div className="w-96 shrink-0 min-h-0 overflow-y-auto border-l border-[var(--color-border-divider)] pl-8">
          <FileCaptureForm key={filingRow.id} capture={filingRow} onDone={() => setFiling(null)} />
        </div>
      )}
    </div>
  );
}

interface CaptureItemProps {
  capture: CaptureRow;
  selected: boolean;
  onFile: () => void;
  onDismiss: () => void;
  onRestore: () => void;
  onBriefAgain: () => void;
}

function CaptureItem({ capture: c, selected, onFile, onDismiss, onRestore, onBriefAgain }: CaptureItemProps) {
  const t = useT();
  const failed = c.status === "new" && c.brief_tries >= MAX_TRIES;
  const noProject = c.status === "new" && !!c.inbox_reason;
  const project =
    c.project_id !== null && c.project_name ? (
      c.status === "filed" ? (
        <Link to={`/projects/${c.project_id}`} className="text-accent-text hover:underline focus-accent rounded">
          {c.project_name}
        </Link>
      ) : (
        <span>{c.project_name}</span>
      )
    ) : null;

  return (
    <li
      className={`flex items-start gap-3 px-2 py-2 border-b border-[var(--color-border-divider)] transition-colors ${
        selected ? "bg-accent-tint" : "hover:bg-[var(--color-hover-row)]"
      }`}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p title={c.text} className="text-sm line-clamp-2 whitespace-pre-wrap">
          {c.text}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{t[SOURCE_KEYS[c.source]]}</span>
          <span aria-hidden>·</span>
          <span>{formatDisplayDateTime(c.created_at)}</span>
          {project && (
            <>
              <span aria-hidden>·</span>
              {project}
            </>
          )}
          {failed && <Badge variant="danger">{t.capture_failed}</Badge>}
          {noProject && <Badge variant="warning">{t.capture_no_project.replace("{reason}", c.inbox_reason ?? "")}</Badge>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {c.status === "new" && (
          <>
            {(failed || noProject) && (
              <Button variant="secondary" onClick={onBriefAgain}>
                {t.capture_brief_again}
              </Button>
            )}
            <Button variant="secondary" onClick={onFile}>
              {t.capture_file}
            </Button>
            <Button variant="secondary" onClick={onDismiss}>
              {t.capture_dismiss}
            </Button>
          </>
        )}
        {c.status === "dismissed" && (
          <Button variant="secondary" onClick={onRestore}>
            {t.capture_restore}
          </Button>
        )}
      </div>
    </li>
  );
}
