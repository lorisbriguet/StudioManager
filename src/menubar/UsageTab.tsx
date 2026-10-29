import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from "recharts";
import { BottomBar, Button, EmptyState, ProgressBar, SectionLabel, SegmentedControl } from "../components/ui";
import { notify } from "../lib/notify";
import { useT } from "../i18n/useT";
import { useAppStore } from "../stores/app-store";
import { useChartTheme } from "../hooks/useChartTheme";
import { openMainWindow } from "../lib/agents";
import {
  getUsageActivity,
  getUsageLimits,
  usageWindowLabel,
  type Activity,
  type ClientTime,
  type Meter,
  type UsageLimits,
} from "../lib/usage";

const LIMITS_EVERY_MS = 30_000;
const ACTIVITY_EVERY_MS = 60_000;
/** The chart's palette has 8 colours; further clients wrap around. */
const CHART_COLORS = 8;

/** Calls `load` now and then every `ms`, one call in flight at a time, until unmounted. */
function usePoll<T>(load: () => Promise<T>, ms: number, onResult: (value: T) => void) {
  const loadRef = useRef(load);
  const resultRef = useRef(onResult);
  loadRef.current = load;
  resultRef.current = onResult;
  useEffect(() => {
    let alive = true;
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const value = await loadRef.current();
        if (alive) resultRef.current(value);
      } catch {
        // Keep showing the last good answer.
      } finally {
        busy = false;
      }
    };
    void run();
    const id = setInterval(() => void run(), ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ms]);
}

/** Meter colour: warning from 75%, danger from 90%. */
function meterColor(percent: number): string {
  if (percent >= 90) return "var(--color-danger)";
  if (percent >= 75) return "var(--color-warning)";
  return "var(--color-accent)";
}

/** "N min" under an hour, else "H h MM". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const timeOf = (d: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/** Always with the weekday: "Thu 15:40". */
function dayClockText(epochMs: number, locale: string): string {
  const d = new Date(epochMs);
  const day = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d).replace(/\.$/, "");
  return `${day} ${timeOf(d, locale)}`;
}

/** "16:40" today, else "Fri 09:00", in the app's language. */
function clockText(epochMs: number, locale: string): string {
  const d = new Date(epochMs);
  return sameDay(d, new Date()) ? timeOf(d, locale) : dayClockText(epochMs, locale);
}

function MeterRow({ meter, locale }: { meter: Meter; locale: string }) {
  const t = useT();
  const name = usageWindowLabel(meter.window, t);
  const percent = Math.round(meter.percent);
  const resets = t.usage_resets.replace("{when}", clockText(meter.resetsAt, locale));
  const pace = meter.pace;
  const hitsFull = pace?.hitsFullAt != null && pace.hitsFullAt < meter.resetsAt;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between items-baseline text-sm mb-1">
        <span>{name}</span>
        <span className="text-xs text-muted">{`${percent}% · ${resets}`}</span>
      </div>
      <ProgressBar value={meter.percent} color={meterColor(meter.percent)} aria-label={name} />
      {pace &&
        (hitsFull ? (
          <div className="text-xs mt-1 text-[var(--color-warning-text)]">
            {t.usage_pace_hit.replace("{when}", dayClockText(pace.hitsFullAt!, locale))}
          </div>
        ) : (
          <div className="text-xs mt-1 text-muted">
            {t.usage_pace_at_reset.replace("{percent}", String(Math.round(pace.projectedPercentAtReset)))}
          </div>
        ))}
    </div>
  );
}

function TokensChart({ activity, locale }: { activity: Activity; locale: string }) {
  const chart = useChartTheme();
  const data = activity.days.map((d) => {
    const [y, m, day] = d.date.split("-").map(Number);
    const name = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(y, m - 1, day)).replace(/\.$/, "");
    return { name, ...d.byClient };
  });
  const color = (i: number) => `var(--color-chart-${(i % CHART_COLORS) + 1})`;
  return (
    <>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={data}>
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: chart.tickFill }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={chart.tooltipStyle} cursor={{ fill: chart.cursorFill }} />
          {activity.clients.map((c, i) => (
            <Bar key={c} dataKey={c} stackId="tokens" fill={color(i)} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div data-legend className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted">
        {activity.clients.map((c, i) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="dot" style={{ background: color(i) }} aria-hidden />
            {c}
          </span>
        ))}
      </div>
      {activity.modelMix && <div className="text-xs mt-1.5 text-muted">{activity.modelMix}</div>}
    </>
  );
}

function TimeRows({ rows }: { rows: ClientTime[] }) {
  return (
    <div className="text-sm">
      {rows.map((c) => (
        <div key={c.client}>
          <div className="flex justify-between py-0.5">
            <span className="truncate">{c.client}</span>
            <span>{formatMinutes(c.minutes)}</span>
          </div>
          {c.projects.map(([project, minutes]) => (
            <div key={project} className="flex justify-between py-0.5 pl-4 text-xs text-muted">
              <span className="truncate">{project}</span>
              <span>{formatMinutes(minutes)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** `Client  1 h 05`, then each project indented by two spaces. */
export function timeAsText(rows: ClientTime[]): string {
  return rows
    .flatMap((c) => [
      `${c.client}  ${formatMinutes(c.minutes)}`,
      ...c.projects.map(([p, m]) => `  ${p}  ${formatMinutes(m)}`),
    ])
    .join("\n");
}

/**
 * The menu bar's Usage tab: plan limits with pacing, the week's tokens per client and agent
 * time per client and project. It owns the bottom bar so "Copy as text" can sit in it;
 * `trailing` is the shell's own action.
 */
export function UsageTab({ trailing }: { trailing: ReactNode }) {
  const t = useT();
  const locale = useAppStore((s) => (s.language === "FR" ? "fr" : "en"));
  const [limits, setLimits] = useState<UsageLimits | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [period, setPeriod] = useState<"today" | "week">("today");

  usePoll(getUsageLimits, LIMITS_EVERY_MS, (v) => v && setLimits(v));
  usePoll(getUsageActivity, ACTIVITY_EVERY_MS, (v) => v && setActivity(v));

  const rows = activity?.time[period] ?? [];

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {limits && (
          <section className="px-4 py-3 border-b border-[var(--color-border-divider)]">
            <SectionLabel as="h2" className="mb-2">{t.usage_plan_limits}</SectionLabel>
            {limits.setUp ? (
              limits.meters.map((m) => <MeterRow key={m.window} meter={m} locale={locale} />)
            ) : (
              <EmptyState
                message={t.usage_not_set_up}
                action={
                  <Button variant="secondary" onClick={() => void openMainWindow({ settings: "agents" })}>
                    {t.routines_open_settings}
                  </Button>
                }
              />
            )}
          </section>
        )}
        {activity && (
          <section className="px-4 py-3 border-b border-[var(--color-border-divider)]">
            <SectionLabel as="h2" className="mb-2">{t.usage_tokens_week}</SectionLabel>
            <TokensChart activity={activity} locale={locale} />
          </section>
        )}
        {activity && (
          <section className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <SectionLabel as="h2">{t.usage_agent_time}</SectionLabel>
              <SegmentedControl
                aria-label={t.usage_agent_time}
                value={period}
                onChange={setPeriod}
                options={[
                  { value: "today", label: t.usage_today },
                  { value: "week", label: t.usage_week },
                ]}
              />
            </div>
            {rows.length > 0 ? <TimeRows rows={rows} /> : <div className="text-xs text-muted">{t.usage_time_none}</div>}
            <div className="text-xs mt-1.5 text-muted">{t.usage_time_note}</div>
          </section>
        )}
      </div>
      <BottomBar className="justify-between">
        <Button
          variant="outline"
          disabled={rows.length === 0}
          onClick={() =>
            void navigator.clipboard
              .writeText(timeAsText(rows))
              .then(() => notify.success(t.copied))
              .catch((e: unknown) => notify.error(t.error_copy, e))
          }
        >
          {t.usage_copy_text}
        </Button>
        {trailing}
      </BottomBar>
    </>
  );
}
