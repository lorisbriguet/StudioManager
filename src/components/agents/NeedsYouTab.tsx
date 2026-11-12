import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useT } from "../../i18n/useT";
import { useBriefEntries, useKeepAsTask, useMarkStarted, useSetBrief } from "../../db/hooks/useCaptures";
import type { BriefEntry } from "../../db/queries/captures";
import { useStartAgentOn } from "../../hooks/useStartAgentOn";
import { formatDisplayDateTime } from "../../utils/formatDate";
import { Button, EmptyState, ICONS, ICON_SIZE, SECTION_LABEL, Textarea } from "../ui";

/**
 * The Needs you tab. Part 1 has one group, Briefs: captures the brief session filed as a task
 * or subtask, waiting for a word from you. Start an agent on it, keep it as a plain task, or
 * open the brief to read and edit it.
 */
export function NeedsYouTab() {
  const t = useT();
  const { data: entries = [] } = useBriefEntries();

  if (entries.length === 0) return <EmptyState icon={ICONS.agents} message={t.needs_you_empty} />;

  // The group row as on the All agents list: SectionLabel and a muted count over a hairline.
  return (
    <section aria-label={t.agents_tab_needs_you} className="flex-1 min-w-0 min-h-0 overflow-y-auto">
      <h2 className="h-8 flex items-center gap-2 px-2 border-b border-[var(--color-border)]">
        <span className={`truncate ${SECTION_LABEL}`}>{t.briefs_group}</span>
        <span className="text-xs text-muted tabular-nums">{entries.length}</span>
      </h2>
      <ul>
        {entries.map((e) => (
          <BriefItem key={e.capture_id} entry={e} />
        ))}
      </ul>
    </section>
  );
}

function BriefItem({ entry: e }: { entry: BriefEntry }) {
  const t = useT();
  const { start } = useStartAgentOn();
  const keepAsTask = useKeepAsTask();
  const markStarted = useMarkStarted();
  const setBrief = useSetBrief();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(e.brief ?? "");
  // The last text saved or loaded: only a change is written.
  const [saved, setSaved] = useState(e.brief ?? "");

  const save = () => {
    if (draft === saved) return;
    setSaved(draft);
    setBrief.mutate({ kind: e.kind, id: e.item_id, brief: draft });
  };

  const startAgent = async () => {
    // Only an agent that was really started takes the entry off the list.
    if (await start({ kind: e.kind, id: e.item_id })) markStarted.mutate(e.capture_id);
  };

  return (
    <li className="px-2 py-3 border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] transition-colors">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span>{t.brief_filed_under.replace("{project}", e.project_name)}</span>
        <span aria-hidden>·</span>
        <span>{formatDisplayDateTime(e.capture_created_at)}</span>
      </div>
      <p className="mt-1 text-sm font-medium">{e.title}</p>
      <p className="text-xs text-muted whitespace-pre-wrap">“{e.capture_text}”</p>
      {!open && e.brief && <p className="mt-1 text-sm whitespace-pre-wrap line-clamp-3">{e.brief}</p>}
      {open && (
        <Textarea
          className="mt-2"
          aria-label={t.brief_open}
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          onBlur={save}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
              ev.preventDefault();
              save();
            }
          }}
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button icon={ICONS.agents} onClick={() => void startAgent()}>
          {t.brief_start}
        </Button>
        <Button variant="secondary" onClick={() => keepAsTask.mutate(e.capture_id)}>
          {t.brief_keep}
        </Button>
        <Button
          variant="secondary"
          aria-expanded={open}
          onClick={() => {
            // Closing saves too. Opening starts from the brief as it is now: an agent
            // may have rewritten it since the entry was first shown.
            if (open) save();
            else {
              setDraft(e.brief ?? "");
              setSaved(e.brief ?? "");
            }
            setOpen(!open);
          }}
        >
          <ChevronRight size={ICON_SIZE.control} className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
          {t.brief_open}
        </Button>
      </div>
    </li>
  );
}
