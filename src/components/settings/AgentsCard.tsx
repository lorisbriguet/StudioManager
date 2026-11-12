import { useEffect, useState } from "react";
import { SettingRow, SettingsCard } from "../ui/Settings";
import { Toggle } from "../ui/Toggle";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { FormActions } from "../ui/Form";
import { useConfirm } from "../../lib/confirm";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../i18n/useT";
import { isDemoBuild } from "../../lib/demoBuild";
import { captureHotkeyStatus } from "../../lib/captures";
import { confirmTrust } from "../../lib/agentStart";
import { useNow } from "../../hooks/useNow";
import { useBriefingStatus } from "../../hooks/useBriefingStatus";
import {
  briefingFolder,
  briefingLines,
  getAgentsSettings,
  isInside,
  setAgentsBriefing,
  startFolders,
  trustFolder,
  installStatusLine,
  removeStatusLine,
  setAgentsEnabled,
  setAgentsLimitAlerts,
  setAgentsMenuBar,
  setAgentsReminders,
  remindersProblemText,
  type RemindersProblem,
  statusLinePreview,
  type AgentsInfo,
  type StatusLinePreview,
} from "../../lib/agents";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AgentsCard() {
  const t = useT();
  const confirm = useConfirm();
  const setStoreEnabled = useAppStore((s) => s.setAgentsEnabled);
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The list field, saved when it loses focus; the problem of the last import under the switch.
  const [remindersList, setRemindersList] = useState("Inbox");
  const [remindersProblem, setRemindersProblem] = useState<RemindersProblem | null>(null);
  // Plan-limits status line: the latest preview, which change is shown for confirmation.
  const [line, setLine] = useState<StatusLinePreview | null>(null);
  const [lineMode, setLineMode] = useState<"install" | "remove" | null>(null);
  const [lineNote, setLineNote] = useState<string | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAgentsSettings()
      .then((i) => { if (!cancelled) { setInfo(i); setRemindersList(i.remindersList); setStoreEnabled(i.enabled); } })
      .catch((e) => { if (!cancelled) setError(msg(e)); });
    return () => { cancelled = true; };
  }, [setStoreEnabled]);

  const enabled = info?.enabled ?? false;
  const now = useNow();
  const briefing = useBriefingStatus(enabled && (info?.briefing ?? false));
  // Why Control-Option-Space is not registered (null: it is). Read again after each switch.
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    captureHotkeyStatus()
      .then((s) => { if (!cancelled) setHotkeyError(s); })
      .catch(() => { if (!cancelled) setHotkeyError(null); });
    return () => { cancelled = true; };
  }, [enabled]);
  // Read even while Agents is off: a StudioManager status line left behind can still be removed.
  useEffect(() => {
    let cancelled = false;
    statusLinePreview()
      .then((p) => { if (!cancelled) setLine(p); })
      .catch((e) => { if (!cancelled && enabled) setLineError(msg(e)); });
    return () => { cancelled = true; };
  }, [enabled]);

  const toggle = async (enabled: boolean) => {
    setError(null);
    try {
      const next = await setAgentsEnabled(enabled);
      setInfo(next);
      setStoreEnabled(next.enabled);
    } catch (e) {
      setError(msg(e));
      return;
    }
    // Agents off turns the menu bar off too: same question as the menu bar switch.
    if (!enabled) await offerRemoval();
  };

  const run = async (call: () => Promise<AgentsInfo>) => {
    setError(null);
    try {
      setInfo(await call());
      return true;
    } catch (e) {
      setError(msg(e));
      return false;
    }
  };

  /** Fetch a fresh preview and show the change for confirmation. */
  const startLine = async (mode: "install" | "remove") => {
    setLineNote(null);
    setLineError(null);
    try {
      setLine(await statusLinePreview());
      setLineMode(mode);
    } catch (e) {
      setLineError(msg(e));
    }
  };

  /** Write exactly the previewed text (refused by Rust if the file changed meanwhile). */
  const writeLine = async (mode: "install" | "remove", expected: string) => {
    try {
      if (mode === "install") await installStatusLine(expected);
      else await removeStatusLine(expected);
      setLineNote(mode === "install" ? t.agents_status_line_installed : t.agents_status_line_removed);
    } catch (e) {
      setLineError(msg(e));
    }
    setLine(await statusLinePreview().catch(() => null));
  };

  const confirmLine = async () => {
    const mode = lineMode;
    const expected = mode === "install" ? line?.next : line?.removeNext;
    setLineMode(null);
    if (!mode || expected == null) return;
    await writeLine(mode, expected);
  };

  /** The menu bar went off: offer to remove StudioManager's status line, when there is one. */
  const offerRemoval = async () => {
    if (!line?.present) return;
    if (!(await confirm({ title: t.agents_status_line_remove_ask, confirmLabel: t.agents_status_line_remove }))) return;
    setLineNote(null);
    setLineError(null);
    try {
      const fresh = await statusLinePreview();
      if (fresh.removeNext != null) await writeLine("remove", fresh.removeNext);
      else setLine(fresh);
    } catch (e) {
      setLineError(msg(e));
    }
  };

  /** On: make the folder, ask to trust it when Claude Code doesn't yet, then switch on. */
  const toggleBriefing = async (on: boolean) => {
    if (!on) {
      await run(() => setAgentsBriefing(false));
      return;
    }
    setError(null);
    try {
      const folder = await briefingFolder();
      const folders = await startFolders();
      if (!folders.some((f) => f.trusted && isInside(folder, f.path))) {
        if (!(await confirmTrust(folder, false))) return;
        await trustFolder(folder);
      }
      setInfo(await setAgentsBriefing(true));
    } catch (e) {
      setError(msg(e));
    }
  };

  /** Switch on or off, or save another list; switching on imports at once (the permission question). */
  const saveReminders = async (on: boolean, list: string) => {
    setError(null);
    setRemindersProblem(null);
    try {
      const res = await setAgentsReminders(on, list);
      setInfo(res.info);
      setRemindersList(res.info.remindersList);
      setRemindersProblem(res.problem);
    } catch (e) {
      setError(msg(e));
    }
  };

  const toggleMenuBar = async (on: boolean) => {
    if (!(await run(() => setAgentsMenuBar(on))) || on) return;
    await offerRemoval();
  };

  // The demo build never runs Agents (Rust keeps it off): the usual off state, no lookup.
  const demo = isDemoBuild();
  const missing = info !== null && !info.claudePath;
  // Shown whenever a StudioManager status line is in place (any path, Agents on or off) so it
  // can always be removed; setting one up needs the menu bar.
  const showLine = line?.present || (enabled && info?.menuBar);
  const canSetUp = enabled && !line?.installed;
  const shown = lineMode === "install" ? line?.next : lineMode === "remove" ? line?.removeNext : null;

  return (
    <SettingsCard title={t.agents} desc={t.agents_desc}>
      <SettingRow label={t.agents_enable}>
        <Toggle
          checked={info?.enabled ?? false}
          disabled={!info || demo || (missing && !info.enabled)}
          ariaLabel={t.agents_enable}
          onChange={(enabled) => void toggle(enabled)}
        />
      </SettingRow>
      <SettingRow label={t.agents_menu_bar} desc={t.agents_menu_bar_desc}>
        <Toggle
          checked={info?.menuBar ?? false}
          disabled={!info || !info.enabled}
          ariaLabel={t.agents_menu_bar}
          onChange={(on) => void toggleMenuBar(on)}
        />
      </SettingRow>
      <SettingRow label={t.agents_limit_alerts} desc={t.agents_limit_alerts_desc}>
        <Toggle
          // Off in the demo, like the other Agents switches (its saved value never applies).
          checked={!demo && (info?.limitAlerts ?? true)}
          disabled={!info || !info.enabled || !info.menuBar}
          ariaLabel={t.agents_limit_alerts}
          onChange={(on) => void run(() => setAgentsLimitAlerts(on))}
        />
      </SettingRow>
      <SettingRow label={t.briefing_switch} desc={t.briefing_desc}>
        <Toggle
          checked={!demo && (info?.briefing ?? false)}
          disabled={!info || !info.enabled}
          ariaLabel={t.briefing_switch}
          onChange={(on) => void toggleBriefing(on)}
        />
      </SettingRow>
      {briefingLines(briefing, t, now).map((l) => (
        <p key={l.text} className={`text-xs py-1 ${l.warn ? "text-warning-text" : "text-muted"}`}>{l.text}</p>
      ))}
      <SettingRow label={t.reminders_switch} desc={t.reminders_desc}>
        <Toggle
          checked={!demo && (info?.reminders ?? false)}
          disabled={!info || !info.enabled}
          ariaLabel={t.reminders_switch}
          onChange={(on) => void saveReminders(on, remindersList)}
        />
      </SettingRow>
      <SettingRow label={t.reminders_list}>
        <Input
          value={remindersList}
          disabled={!info || !info.enabled}
          aria-label={t.reminders_list}
          onChange={(e) => setRemindersList(e.target.value)}
          onBlur={() => {
            if (info && remindersList.trim() !== info.remindersList) {
              void saveReminders(info.reminders, remindersList);
            }
          }}
        />
      </SettingRow>
      {remindersProblem && (
        <p role="alert" className="text-xs text-warning-text py-1">{remindersProblemText(remindersProblem, t)}</p>
      )}
      {showLine && (
        <SettingRow label={t.agents_status_line} desc={t.agents_status_line_desc}>
          <div className="flex gap-2">
            {canSetUp && (
              <Button variant="secondary" onClick={() => void startLine("install")}>{t.agents_status_line_setup}</Button>
            )}
            {line?.present && (
              <Button variant="secondary" onClick={() => void startLine("remove")}>{t.agents_status_line_remove}</Button>
            )}
          </div>
        </SettingRow>
      )}
      {shown != null && (
        <div className="rounded-lg border border-[var(--color-border-divider)] p-3 my-2">
          <p className="text-xs text-muted mb-1">{t.agents_status_line_preview_hint}</p>
          {lineMode === "install" && line?.replacesOther && (
            <p role="alert" className="text-xs text-warning-text mb-1">
              {t.agents_status_line_replaces.replace("{command}", line.current ?? "")}
            </p>
          )}
          <pre data-testid="status-line-preview" className="text-xs overflow-auto max-h-48 whitespace-pre-wrap">{shown}</pre>
          <FormActions className="mt-2">
            <Button variant="secondary" onClick={() => setLineMode(null)}>{t.agent_access_cancel}</Button>
            <Button onClick={() => void confirmLine()}>{t.agent_access_confirm}</Button>
          </FormActions>
        </div>
      )}
      {lineNote && <p className="text-xs text-muted py-1">{lineNote}</p>}
      {lineError && <p role="alert" className="text-xs text-danger-text py-1">{lineError}</p>}
      {error && <p role="alert" className="text-xs text-danger-text py-2">{error}</p>}
      {info && (
        <SettingRow label={t.agents_claude_path}>
          {demo ? (
            <span className="text-xs text-muted">{t.agents_demo_unavailable}</span>
          ) : info.claudePath ? (
            <span className="text-xs text-muted font-mono truncate max-w-[24rem]">{info.claudePath}</span>
          ) : (
            <span className="text-xs text-danger-text">{t.agents_claude_missing}</span>
          )}
        </SettingRow>
      )}
      {enabled && !demo && (
        hotkeyError ? (
          <p role="alert" className="text-xs text-warning-text py-1">
            {t.capture_hotkey_taken} <span className="font-mono">{hotkeyError}</span>
          </p>
        ) : (
          <p className="text-xs text-muted py-1">{t.capture_hotkey}</p>
        )
      )}
      <p className="text-xs text-muted py-2.5">{t.agents_trust_hint}</p>
    </SettingsCard>
  );
}
