import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button, Callout, Dropdown, EmptyState, ICONS, IconButton, SectionLabel, type DropdownItem } from "../components/ui";
import { useAgents } from "../components/agents/useAgents";
import { useT } from "../i18n/useT";
import { useAppStore } from "../stores/app-store";
import { openMainWindow } from "../lib/agents";
import { logError } from "../lib/log";
import { routineRunTextClass } from "../lib/statusColors";
import {
  ROUTINES_CHANGED,
  getRoutineRuns,
  getRoutines,
  openRoutineFolder,
  openRoutineResult,
  openSectionLink,
  runRoutine,
  type Routine,
  type Routines,
  type Run,
} from "../lib/routines";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Rust's error while the Agents switch is off (`agents/actions.rs`). */
const AGENTS_OFF = "Agents are switched off";

/** Loads the routines and their last runs, and again whenever Rust says they changed. A failed
 *  load (e.g. "Agents are switched off", an unreadable runs file) keeps what is there and says why. */
function useRoutines() {
  const [data, setData] = useState<{ routines: Routines; runs: Run[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [routines, runs] = await Promise.allSettled([getRoutines(), getRoutineRuns()]);
    const failed = [routines, runs].find((r): r is PromiseRejectedResult => r.status === "rejected");
    setError(failed ? errorText(failed.reason) : null);
    setData((d) => ({
      routines: routines.status === "fulfilled" ? routines.value : (d?.routines ?? { sections: [], routines: [] }),
      runs: runs.status === "fulfilled" ? runs.value : (d?.runs ?? []),
    }));
  }, []);
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    void load();
    listen(ROUTINES_CHANGED, () => {
      if (alive) void load();
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [load]);
  return { data, error };
}

const timeOf = (epochMs: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(epochMs));

function RoutineRow({ routine, run, sessionId }: { routine: Routine; run: Run | undefined; sessionId: string | null }) {
  const t = useT();
  const locale = useAppStore((s) => (s.language === "FR" ? "fr" : "en"));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Runs an action; a failure shows a translated line in the row, the raw error goes to the log. */
  const attempt = async (action: () => Promise<unknown>) => {
    setFailed(false);
    try {
      await action();
    } catch (e) {
      setFailed(true);
      void logError(`Routine ${routine.id}: action failed:`, e instanceof Error ? e.message : e);
    }
  };

  const running = run?.status === "running";
  let status = { text: routine.idleHint, tone: "text-muted" as string };
  if (run?.status === "running") status = { text: t.routines_running, tone: routineRunTextClass("running") };
  else if (run?.status === "done") {
    const at = t.routines_done_at.replace("{time}", run.finishedAt ? timeOf(run.finishedAt, locale) : "");
    status = { text: run.message ? `${at} · ${run.message}` : at, tone: routineRunTextClass("done") };
  } else if (run?.status === "failed") {
    status = {
      text: run.message ? t.routines_failed.replace("{message}", run.message) : t.routines_failed_plain,
      tone: routineRunTextClass("failed"),
    };
  }

  const start = async () => {
    setBusy(true);
    await attempt(() => runRoutine(routine.id));
    setBusy(false);
  };

  let main: { label: string; onClick: () => void; disabled?: boolean };
  if (run?.status === "done" && routine.resultLink) {
    main = { label: t.routines_open_result, onClick: () => void attempt(() => openRoutineResult(routine.id)) };
  } else if (routine.kind.kind === "agent" && run?.agentShortId && sessionId) {
    main = { label: t.routines_open, onClick: () => void openMainWindow({ agent: sessionId }) };
  } else {
    main = { label: t.routines_run, onClick: () => void start(), disabled: running || busy };
  }

  const items: DropdownItem[] = [
    { label: t.routines_run_now, onSelect: () => void start(), disabled: running || busy },
    { label: t.routines_open_folder, onSelect: () => void attempt(() => openRoutineFolder(routine.id)) },
  ];
  if (routine.resultLink) {
    items.push({ divider: true });
    items.push({ label: t.routines_open_link, onSelect: () => void attempt(() => openRoutineResult(routine.id)) });
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{routine.title}</div>
        {status.text && <div className={`text-xs truncate ${status.tone}`}>{status.text}</div>}
        {failed && (
          <Callout tone="danger" className="mt-1">
            {t.routines_action_failed}
          </Callout>
        )}
      </div>
      <Button variant="secondary" onClick={main.onClick} disabled={main.disabled}>
        {main.label}
      </Button>
      <Dropdown align="end" trigger={<IconButton icon={ICONS.more} label={`${t.routines_more}: ${routine.title}`} />} items={items} />
    </div>
  );
}

/**
 * The panel's Day tab: the routines by section with their last run. Everything it starts
 * or opens goes by id; Rust reads what to run or open from `routines.json`.
 */
export function DayTab() {
  const t = useT();
  const { data, error } = useRoutines();
  const { agents } = useAgents();
  /** Why a section link didn't open (e.g. "Not found: …"), by section id. */
  const [linkError, setLinkError] = useState<{ section: string; message: string } | null>(null);

  if (!data) return null;
  const { routines, runs } = data;
  const shownError = error === AGENTS_OFF ? t.agents_off : error;
  const loadError = shownError && (
    <div role="alert" className="px-4 pt-3 text-xs text-danger-text">
      {shownError}
    </div>
  );
  const openLink = (section: string, index: number) => {
    setLinkError(null);
    openSectionLink(section, index).catch((e) => setLinkError({ section, message: errorText(e) }));
  };
  if (routines.routines.length === 0) {
    return (
      <EmptyState
        tone={shownError ? "danger" : "default"}
        message={shownError || t.routines_day_empty}
        action={
          <Button variant="secondary" onClick={() => void openMainWindow({ settings: "agents" })}>
            {t.routines_open_settings}
          </Button>
        }
      />
    );
  }

  return (
    <div className="pb-2">
      {loadError}
      {routines.sections.map((s) => {
        const rows = routines.routines.filter((r) => r.sectionId === s.id);
        if (rows.length === 0 && s.links.length === 0) return null;
        return (
          <section key={s.id} className="pt-3 border-b border-[var(--color-border-divider)] last:border-b-0">
            <div className="flex items-end justify-between gap-2 px-4 mb-1">
              <SectionLabel as="h2">{s.name}</SectionLabel>
              <div className="flex flex-wrap justify-end gap-x-3">
                {s.links.map((l, i) => (
                  <Button key={i} variant="link" onClick={() => openLink(s.id, i)}>
                    {l.label}
                  </Button>
                ))}
              </div>
            </div>
            {linkError?.section === s.id && (
              <div role="alert" className="px-4 mb-1 text-xs text-danger-text">
                {linkError.message}
              </div>
            )}
            {rows.map((r) => {
              const run = runs.find((x) => x.routineId === r.id);
              const session = run?.agentShortId ? agents.find((a) => a.shortId === run.agentShortId) : undefined;
              return <RoutineRow key={r.id} routine={r} run={run} sessionId={session?.sessionId ?? null} />;
            })}
          </section>
        );
      })}
    </div>
  );
}
