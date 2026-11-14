import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useT } from "../../i18n/useT";
import { useBriefEntries, useKeepAsTask, useMarkStarted, useSetBrief } from "../../db/hooks/useCaptures";
import { useAloneEntries, useOpenEntries, useReopenEntry } from "../../db/hooks/useNeedsYou";
import type { BriefEntry } from "../../db/queries/captures";
import type { NeedsYouEntry } from "../../db/queries/needsYou";
import { useStartAgentOn } from "../../hooks/useStartAgentOn";
import { useWatcherStatus } from "../../hooks/useWatcherStatus";
import { watcherLine } from "../../lib/agents";
import { formatDisplayDateTime } from "../../utils/formatDate";
import { Button, EmptyState, ICONS, ICON_SIZE, SECTION_LABEL, Textarea } from "../ui";
import { CheckEntry } from "./CheckEntry";
import { DecideEntry } from "./DecideEntry";
import { HubLine } from "./HubLine";
import { useHubList } from "../../hooks/useHubs";

/**
 * The Needs you tab: everything waiting on you, in four groups. Decide (questions agents asked),
 * Check (finished work, and an entry you reopened), Briefs (captures the brief session filed as
 * a task or subtask) and Decided alone (what the lead and the app settled without you, to reopen).
 */
export function NeedsYouTab() {
  const t = useT();
  const { data: briefs = [] } = useBriefEntries();
  const { data: open = [] } = useOpenEntries();
  const { data: alone = [] } = useAloneEntries();
  const hubs = useHubList();
  const decide = open.filter((e) => e.kind === "decide");
  const check = open.filter((e) => e.kind !== "decide");

  if (open.length === 0 && briefs.length === 0 && alone.length === 0 && hubs.length === 0) {
    return (
      <>
        <WatcherLine />
        <EmptyState icon={ICONS.agents} message={t.needs_you_empty} />
      </>
    );
  }

  return (
    <section aria-label={t.agents_tab_needs_you} className="flex-1 min-w-0 min-h-0 overflow-y-auto">
      <WatcherLine />
      {decide.length > 0 && (
        <Group label={t.needs_decide_group} count={decide.length}>
          {decide.map((e) => (
            <DecideEntry key={e.id} entry={e} />
          ))}
        </Group>
      )}
      {check.length > 0 && (
        <Group label={t.needs_check_group} count={check.length}>
          {check.map((e) => (
            <CheckEntry key={e.id} entry={e} />
          ))}
        </Group>
      )}
      {briefs.length > 0 && (
        <Group label={t.briefs_group} count={briefs.length}>
          {briefs.map((e) => (
            <BriefItem key={e.capture_id} entry={e} />
          ))}
        </Group>
      )}
      {hubs.length > 0 && (
        <Group label={t.needs_hubs_group} count={hubs.length}>
          {hubs.map((h) => (
            <HubLine key={h.id} hub={h} />
          ))}
        </Group>
      )}
      {alone.length > 0 && (
        <Group label={t.needs_alone_group} count={alone.length}>
          {alone.map((e) => (
            <AloneItem key={e.id} entry={e} />
          ))}
        </Group>
      )}
    </section>
  );
}

/** One muted line while the watcher switch is on: why it waits, or the item it would start. */
function WatcherLine() {
  const t = useT();
  const text = watcherLine(useWatcherStatus(), t);
  if (!text) return null;
  return <p className="text-xs text-muted mb-2">{text}</p>;
}

/** The group row as on the All agents list: SectionLabel and a muted count over a hairline. */
function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <>
      <h2 className="h-8 flex items-center gap-2 px-2 border-b border-[var(--color-border)]">
        <span className={`truncate ${SECTION_LABEL}`}>{label}</span>
        <span className="text-xs text-muted tabular-nums">{count}</span>
      </h2>
      <ul>{children}</ul>
    </>
  );
}

/** Something the lead or the app settled: what was done, why, and a way to take it back. */
function AloneItem({ entry: e }: { entry: NeedsYouEntry }) {
  const t = useT();
  const reopen = useReopenEntry();
  return (
    <li className="px-2 py-3 border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] transition-colors">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {e.project_name && (
              <>
                <span>{e.project_name}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span>{e.item_title ?? ""}</span>
            <span aria-hidden>·</span>
            <span>{formatDisplayDateTime(e.answered_at ?? e.created_at)}</span>
          </div>
          <p className="mt-1 text-sm font-medium">{e.title}</p>
          {e.reason && <p className="text-xs text-muted whitespace-pre-wrap">{e.reason}</p>}
        </div>
        <Button variant="secondary" onClick={() => reopen.mutate(e.id)}>
          {t.alone_reopen}
        </Button>
      </div>
    </li>
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
