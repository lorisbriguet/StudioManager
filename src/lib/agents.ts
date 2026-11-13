import { invoke } from "@tauri-apps/api/core";

export interface AgentsInfo {
  enabled: boolean;
  menuBar: boolean;
  limitAlerts: boolean;
  /** The brief session switch (Settings › Agents). */
  briefing: boolean;
  /** Start work on Ready tasks by itself (Settings › Agents). */
  watcher: boolean;
  /** Workers at once, 1 to 5. */
  workerCap: number;
  /** The dev build: its workers use the real Claude plan. */
  dev: boolean;
  /** Capture from an Apple Reminders list (Settings › Agents). */
  reminders: boolean;
  /** The list of the default Reminders account that is read. */
  remindersList: string;
  claudePath: string | null;
}

/** The switch only: no lookup of `claude`, so app startup runs nothing while it is off. */
export function getAgentsEnabled(): Promise<boolean> {
  return invoke<boolean>("agents_get_enabled");
}

/** The switch and the path of `claude` (looked up again while it is missing). */
export function getAgentsSettings(): Promise<AgentsInfo> {
  return invoke<AgentsInfo>("agents_get_settings");
}

export function setAgentsEnabled(enabled: boolean): Promise<AgentsInfo> {
  return invoke<AgentsInfo>("agents_set_enabled", { enabled });
}

/** Needs the Agents switch on; also starts the app at login (hidden). */
export function setAgentsMenuBar(on: boolean): Promise<AgentsInfo> {
  return invoke<AgentsInfo>("agents_set_menu_bar", { on });
}

/** Turns the brief session on or off; the folder must be trusted before it is turned on. */
export function setAgentsBriefing(on: boolean): Promise<AgentsInfo> {
  return invoke<AgentsInfo>("agents_set_briefing", { on });
}

/** The watcher switch and the worker cap (Rust keeps the cap between 1 and 5). */
export function setAgentsWatcher(on: boolean, cap: number): Promise<AgentsInfo> {
  return invoke<AgentsInfo>("agents_set_watcher", { on, cap });
}

/** What went wrong on the import that switching Reminders on ran at once. */
export interface RemindersProblem {
  kind: "not_found" | "denied" | "timeout" | "other";
  list: string;
  /** The default Reminders account's name (not_found only). */
  account: string;
  message: string;
}

export interface RemindersSet {
  info: AgentsInfo;
  problem: RemindersProblem | null;
}

/**
 * Switches the Reminders capture on or off and saves the list. On: one import runs at once, so
 * macOS asks to allow StudioManager to control Reminders while the person is looking.
 */
export function setAgentsReminders(on: boolean, list: string): Promise<RemindersSet> {
  return invoke<RemindersSet>("agents_set_reminders", { on, list });
}

/** The text under the Reminders switch for a problem; the list and the account are named. */
export function remindersProblemText(
  p: RemindersProblem,
  t: Record<"reminders_not_found" | "reminders_denied" | "reminders_timeout", string>,
): string {
  switch (p.kind) {
    case "not_found":
      return t.reminders_not_found.replace("{list}", p.list).replace("{account}", p.account);
    case "denied":
      return t.reminders_denied;
    case "timeout":
      return t.reminders_timeout;
    default:
      return p.message;
  }
}

/** Makes the brief session's folder (its files included) and returns its path. */
export function briefingFolder(): Promise<string> {
  return invoke<string>("agents_briefing_folder");
}

export function setAgentsLimitAlerts(on: boolean): Promise<AgentsInfo> {
  return invoke<AgentsInfo>("agents_set_limit_alerts", { on });
}

/** What setting up (or removing) the plan-limits status line would write to Claude Code's
 *  settings. */
export interface StatusLinePreview {
  /** The current status line's command, if any. */
  current: string | null;
  /** The settings file after setup. */
  next: string;
  /** A status line exists and it is not StudioManager's. */
  replacesOther: boolean;
  /** The status line is StudioManager's, from this app's path. */
  installed: boolean;
  /** The status line is StudioManager's from any path (a stale one included). */
  present: boolean;
  /** The settings file after removal (previous status line restored); only when present. */
  removeNext: string | null;
}

export function statusLinePreview(): Promise<StatusLinePreview> {
  return invoke<StatusLinePreview>("agents_status_line_preview");
}

/** `expected` is the approved `next`; refused if Claude Code's settings changed since the
 *  preview. Resolves to the backup path ("" when there was no file). */
export function installStatusLine(expected: string): Promise<string> {
  return invoke<string>("agents_status_line_install", { expected });
}

/** `expected` is the approved `removeNext`; refused if the settings changed since. */
export function removeStatusLine(expected: string): Promise<string> {
  return invoke<string>("agents_status_line_remove", { expected });
}

/** From the menu bar panel: bring the main window forward, on an agent (session id) or the
 *  start form or the Agents settings when asked. Rust emits `menubar:navigate` to the main window. */
export function openMainWindow(
  opts: { agent?: string | null; newAgent?: boolean; settings?: "agents" } = {},
): Promise<void> {
  return invoke<void>("menubar_open_main", {
    agent: opts.agent ?? null,
    newAgent: opts.newAgent ?? false,
    settings: opts.settings ?? null,
  });
}

/** From the menu bar panel: hide it (Escape). */
export function hideMenuBarPanel(): Promise<void> {
  return invoke<void>("menubar_hide");
}

/** Sent to the main window by `menubar_open_main`. */
export const MENUBAR_NAVIGATE = "menubar:navigate";

export function startAgent(
  folder: string,
  task: string,
  model: string,
  name: string,
  /** From a task: in the dev build the agent gets the dev build's own StudioManager server. */
  ownServer = false,
): Promise<string> {
  return invoke<string>("agents_start", { folder, task, model, name, ownServer });
}

export function stopAgent(shortId: string): Promise<void> {
  return invoke<void>("agents_stop", { shortId });
}

export function deleteAgent(shortId: string): Promise<void> {
  return invoke<void>("agents_delete", { shortId });
}

export function switchModel(sessionId: string, model: string): Promise<string> {
  return invoke<string>("agents_switch_model", { sessionId, model });
}

export type Item =
  | { kind: "user"; text: string; at: string | null }
  | { kind: "assistant"; text: string; at: string | null }
  | { kind: "tool"; name: string; summary: string; at: string | null };

export function conversation(sessionId: string): Promise<Item[]> {
  return invoke<Item[]>("agents_conversation", { sessionId });
}

export function dismissAgent(sessionId: string): Promise<void> {
  return invoke<void>("agents_dismiss", { sessionId });
}

/** Terminal output: `data` is base64 of the raw bytes. */
export const AGENTS_TERM = "agents:term";
/** A terminal's process ended; close its panel. */
export const AGENTS_TERM_EXIT = "agents:term-exit";

export interface TermData {
  termId: number;
  data: string;
}

export interface TermExit {
  termId: number;
}

export function termOpen(shortId: string, cols: number, rows: number): Promise<number> {
  return invoke<number>("agents_term_open", { shortId, cols, rows });
}

/** `data` is the text from xterm's `onData`. */
export function termWrite(termId: number, data: string): Promise<void> {
  return invoke<void>("agents_term_write", { termId, data });
}

export function termResize(termId: number, cols: number, rows: number): Promise<void> {
  return invoke<void>("agents_term_resize", { termId, cols, rows });
}

export function termClose(termId: number): Promise<void> {
  return invoke<void>("agents_term_close", { termId });
}

/** Saves an attached image on this Mac and returns its path. `data` is base64. */
export function saveImage(mime: string, data: string): Promise<string> {
  return invoke<string>("agents_save_image", { mime, data });
}

/** The number beside the menu bar icon: what waits in Needs you. 0 clears it. */
export function setNeedsCount(n: number): Promise<void> {
  return invoke<void>("menubar_set_needs_count", { n });
}

export function sendMessage(sessionId: string, text: string): Promise<void> {
  return invoke<void>("agents_send", { sessionId, text });
}

export interface PromptOption {
  number: number;
  label: string;
  selected: boolean;
}

/** The prompt a background agent waits on, as read from its terminal. */
export interface Prompt {
  question: string;
  /** What the prompt is about (the command, the file…), one line per screen line. */
  detail: string;
  options: PromptOption[];
  /** Identifies this prompt; pass it back to `answerPrompt`. */
  fingerprint: string;
}

export function getPrompt(shortId: string): Promise<Prompt | null> {
  return invoke<Prompt | null>("agents_prompt", { shortId });
}

/**
 * Refused, and nothing confirmed, when the screen no longer shows the prompt identified by
 * `fingerprint` with option `number` reading `label`.
 */
export function answerPrompt(
  shortId: string,
  number: number,
  label: string,
  fingerprint: string,
): Promise<void> {
  return invoke<void>("agents_answer", { shortId, number, label, fingerprint });
}

export type Group = "needs-you" | "working" | "idle" | "done";

export interface ProjectLabel {
  orgId: string;
  orgName: string;
  clientName: string;
  projectId: number;
  projectName: string;
  folder: string;
}

export interface Agent {
  sessionId: string;
  shortId: string | null;
  pid: number | null;
  name: string;
  cwd: string;
  kind: "background" | "interactive";
  status: string;
  state: string | null;
  waitingFor: string | null;
  startedAt: number;
  group: Group;
  quiet: "stale" | "dismissed" | null;
  project: ProjectLabel | null;
  model: string | null;
  /** The exact model in use, e.g. "Opus 5.5", when known from the transcript. */
  modelLabel: string | null;
}

export interface StartFolder {
  path: string;
  label: ProjectLabel | null;
  /** Claude Code trusts it (itself or a folder above it). */
  trusted: boolean;
  /** The home folder: trusting it trusts every folder in it. */
  home: boolean;
}

/** Whether `path` is `folder` or inside it. */
export function isInside(path: string, folder: string): boolean {
  const f = folder.length > 1 ? folder.replace(/\/+$/, "") : folder;
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return p === f || p.startsWith(f.endsWith("/") ? f : `${f}/`);
}

/** The full agent list; carried by the `agents:changed` event. */
export const AGENTS_CHANGED = "agents:changed";

/** `claude auth status`, as the poller last read it (hourly). */
export interface LoginStatus {
  loggedIn: boolean;
  authMethod: string | null;
  /** Epoch ms; null when the CLI gives no date (an env token, an API key). */
  expiresAt: number | null;
  checkedAt: number;
}

/** Sent after every sign-in check, with the status (null before any check succeeded). */
export const AGENTS_LOGIN = "agents:login";

export function getLoginStatus(): Promise<LoginStatus | null> {
  return invoke<LoginStatus | null>("agents_login_status");
}

/** Runs `claude auth status` now (after a fresh `claude auth login`). */
export function checkLogin(): Promise<LoginStatus | null> {
  return invoke<LoginStatus | null>("agents_login_check");
}

/** Rejects with "Agents are switched off" while the switch is off. */
export function listAgents(): Promise<Agent[]> {
  return invoke<Agent[]>("agents_list");
}

/** The list is on screen: the poller checks every 2 s for the next few seconds instead of every 30 s. */
export function watchAgents(): Promise<void> {
  return invoke<void>("agents_watch");
}

export function startFolders(): Promise<StartFolder[]> {
  return invoke<StartFolder[]>("agents_start_folders");
}

/**
 * Trusts `folder` for Claude Code (what answering Yes to Claude's own trust question
 * does). Only after the person confirmed it. Resolves to the folder as written.
 */
export function trustFolder(folder: string): Promise<string> {
  return invoke<string>("agents_trust_folder", { folder });
}

export interface BriefingStatus {
  /** `demo`, `off`, `agents_off`, `access_off`, `budget`, `too_soon`, `running`, `nothing`; null when a session may start at the next check. */
  paused: string | null;
  /** With `budget`: the percent the reason is about (the week's, or the 5-hour window's). */
  percent: number | null;
  /** With `budget`: why. */
  reason?: "ahead_of_week" | "five_hour" | "no_data" | "stale" | null;
  /** With `budget` and `ahead_of_week`: where the week's pace line stands, in percent. */
  line?: number | null;
  /** With `budget` and `stale`: the age of the last usage reading, in whole minutes. */
  minutesOld?: number | null;
  /** When the next slot opens (epoch ms), with `too_soon`. */
  nextAt: number | null;
  running: boolean;
  last: { finished_at: number; ok: boolean; message: string | null } | null;
}

/** Why the brief session waits, and when it runs next. Rejects while Agents is off. */
export function briefingStatus(): Promise<BriefingStatus | null> {
  return invoke<BriefingStatus | null>("briefing_status");
}

export interface BriefingLine {
  text: string;
  /** A failure or a pause the person can act on. */
  warn: boolean;
}

type BudgetLabels = Record<
  "briefing_paused_week" | "briefing_paused_five_hour" | "briefing_paused_no_data" | "briefing_paused_stale",
  string
>;

/** The budget pause in words (the brief session's and the watcher's share it). */
function budgetText(
  reason: string | null | undefined,
  n: { percent?: number | null; line?: number | null; minutesOld?: number | null },
  t: BudgetLabels,
): string {
  const whole = (v: number | null | undefined) => String(Math.round(v ?? 0));
  return reason === "ahead_of_week"
    ? t.briefing_paused_week.replace("{percent}", whole(n.percent)).replace("{line}", whole(n.line))
    : reason === "five_hour"
      ? t.briefing_paused_five_hour.replace("{percent}", whole(n.percent))
      : reason === "stale"
        ? t.briefing_paused_stale.replace("{min}", whole(n.minutesOld))
        : t.briefing_paused_no_data;
}

export interface WatcherStatus {
  /** `demo`, `off`, `agents_off`, `mode`, `locked`, `budget`, `cap`, `nothing`; null when it would start something. */
  paused: string | null;
  /** With `budget`: `ahead_of_week`, `five_hour`, `no_data` or `stale`. */
  budget: string | null;
  percent: number | null;
  line: number | null;
  minutesOld: number | null;
  running: number;
  cap: number;
  /** The title of the item it would start. */
  wouldStart: string | null;
  lead: string | null;
}

/** Why the watcher waits, or what it would start. In this version it starts nothing. */
export function watcherStatus(): Promise<WatcherStatus> {
  return invoke<WatcherStatus>("watcher_status");
}

/** The watcher's one muted line for the Needs you tab; null while the watcher is off (or in the demo build). */
export function watcherLine(
  status: WatcherStatus | null,
  t: BudgetLabels &
    Record<"watcher_paused_mode" | "watcher_paused_locked" | "watcher_paused_cap" | "watcher_nothing" | "watcher_would_start", string>,
): string | null {
  if (!status || ["demo", "off", "agents_off"].includes(status.paused ?? "")) return null;
  switch (status.paused) {
    case "mode":
      return t.watcher_paused_mode;
    case "locked":
      return t.watcher_paused_locked;
    case "budget":
      return budgetText(status.budget, status, t);
    case "cap":
      return t.watcher_paused_cap.replace("{n}", String(status.running)).replace("{cap}", String(status.cap));
    case "nothing":
      return t.watcher_nothing;
    default:
      return status.wouldStart ? t.watcher_would_start.replace("{title}", status.wouldStart) : null;
  }
}

/** The muted lines under the brief session switch and in the Inbox: the next slot or why it waits, and the last failure. */
export function briefingLines(
  status: BriefingStatus | null,
  t: Record<
    | "briefing_next"
    | "briefing_paused_week"
    | "briefing_paused_five_hour"
    | "briefing_paused_no_data"
    | "briefing_paused_stale"
    | "briefing_last_failed"
    | "briefing_access_off",
    string
  >,
  now: number,
): BriefingLine[] {
  if (!status || ["demo", "off", "agents_off"].includes(status.paused ?? "")) return [];
  const lines: BriefingLine[] = [];
  if (status.paused === "too_soon" && status.nextAt != null) {
    const min = Math.max(1, Math.ceil((status.nextAt - now) / 60_000));
    lines.push({ text: t.briefing_next.replace("{min}", String(min)), warn: false });
  } else if (status.paused === "budget") {
    lines.push({ text: budgetText(status.reason, status, t), warn: true });
  } else if (status.paused === "access_off") {
    lines.push({ text: t.briefing_access_off, warn: true });
  }
  if (status.last && !status.last.ok) {
    lines.push({ text: t.briefing_last_failed.replace("{reason}", status.last.message ?? ""), warn: true });
  }
  return lines;
}
