import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { MoreHorizontal } from "lucide-react";
import { Button, EmptyState, SectionLabel } from "../components/ui";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { useAgents } from "../components/agents/useAgents";
import { useT } from "../i18n/useT";
import { useAppStore } from "../stores/app-store";
import { openMainWindow } from "../lib/agents";
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

/** Loads the routines and their last runs, and again whenever Rust says they changed. */
function useRoutines() {
  const [data, setData] = useState<{ routines: Routines; runs: Run[] } | null>(null);
  const load = useCallback(async () => {
    try {
      const [routines, runs] = await Promise.all([getRoutines(), getRoutineRuns()]);
      setData({ routines, runs });
    } catch {
      // Agents switched off or a read failed: show what is there, or the empty state.
      setData((d) => d ?? { routines: { sections: [], routines: [] }, runs: [] });
    }
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
  return data;
}

const timeOf = (epochMs: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(epochMs));

/** Status colours as the Agents groups: running info, done success, failed danger. */
const TONE = {
  running: "text-[var(--color-info-text)]",
  done: "text-[var(--color-success-text)]",
  failed: "text-[var(--color-danger-text)]",
} as const;

function RoutineRow({ routine, run, sessionId }: { routine: Routine; run: Run | undefined; sessionId: string | null }) {
  const t = useT();
  const locale = useAppStore((s) => (s.language === "FR" ? "fr" : "en"));
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const running = run?.status === "running";
  let status = { text: routine.idleHint, tone: "text-muted" as string };
  if (run?.status === "running") status = { text: t.routines_running, tone: TONE.running };
  else if (run?.status === "done") {
    const at = t.routines_done_at.replace("{time}", run.finishedAt ? timeOf(run.finishedAt, locale) : "");
    status = { text: run.message ? `${at} · ${run.message}` : at, tone: TONE.done };
  } else if (run?.status === "failed") {
    status = {
      text: run.message ? t.routines_failed.replace("{message}", run.message) : t.routines_failed_plain,
      tone: TONE.failed,
    };
  }

  const start = async () => {
    setBusy(true);
    try {
      await runRoutine(routine.id);
    } catch {
      // The run record (and routines:changed) tells the story; nothing more to show here.
    } finally {
      setBusy(false);
    }
  };

  let main: { label: string; onClick: () => void; disabled?: boolean };
  if (run?.status === "done" && routine.resultLink) {
    main = { label: t.routines_open_result, onClick: () => void openRoutineResult(routine.id).catch(() => {}) };
  } else if (routine.kind.kind === "agent" && run?.agentShortId && sessionId) {
    main = { label: t.routines_open, onClick: () => void openMainWindow({ agent: sessionId }) };
  } else {
    main = { label: t.routines_run, onClick: () => void start(), disabled: running || busy };
  }

  const items: ContextMenuItem[] = [
    { label: t.routines_run_now, onClick: () => void start(), disabled: running || busy },
    { label: t.routines_open_folder, onClick: () => void openRoutineFolder(routine.id).catch(() => {}), divider: true },
  ];
  if (routine.resultLink) {
    items.push({ label: t.routines_open_link, onClick: () => void openRoutineResult(routine.id).catch(() => {}) });
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{routine.title}</div>
        {status.text && <div className={`text-xs truncate ${status.tone}`}>{status.text}</div>}
      </div>
      <Button size="sm" variant="secondary" onClick={main.onClick} disabled={main.disabled}>
        {main.label}
      </Button>
      <button
        type="button"
        aria-label={`${t.routines_more}: ${routine.title}`}
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenuAt({ x: r.right - 160, y: r.bottom + 4 });
        }}
        className="p-1 rounded-md text-muted hover:text-[var(--color-text)] hover:bg-[var(--color-hover-row)] focus-accent"
      >
        <MoreHorizontal size={16} />
      </button>
      {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} items={items} onClose={() => setMenuAt(null)} />}
    </div>
  );
}

/**
 * The panel's Day tab: the routines by section with their last run. Everything it starts
 * or opens goes by id; Rust reads what to run or open from `routines.json`.
 */
export function DayTab() {
  const t = useT();
  const data = useRoutines();
  const { agents } = useAgents();

  if (!data) return null;
  const { routines, runs } = data;
  if (routines.routines.length === 0) {
    return (
      <EmptyState
        message={t.routines_day_empty}
        action={
          <Button size="sm" variant="secondary" onClick={() => void openMainWindow({ settings: "agents" })}>
            {t.routines_open_settings}
          </Button>
        }
      />
    );
  }

  return (
    <div className="pb-2">
      {routines.sections.map((s) => {
        const rows = routines.routines.filter((r) => r.sectionId === s.id);
        if (rows.length === 0 && s.links.length === 0) return null;
        return (
          <section key={s.id} className="pt-3 border-b border-[var(--color-border-divider)] last:border-b-0">
            <div className="flex items-end justify-between gap-2 px-4 mb-1">
              <SectionLabel className="mb-0">{s.name}</SectionLabel>
              <div className="flex flex-wrap justify-end gap-x-3">
                {s.links.map((l, i) => (
                  <Button key={i} variant="link" size="sm" onClick={() => void openSectionLink(s.id, i).catch(() => {})}>
                    {l.label}
                  </Button>
                ))}
              </div>
            </div>
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
