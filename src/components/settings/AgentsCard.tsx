import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { SettingRow, SettingsCard } from "./SettingsPrimitives";
import { Toggle } from "../ui/Toggle";
import { Button } from "../ui/Button";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../i18n/useT";
import {
  getAgentsSettings,
  installStatusLine,
  removeStatusLine,
  setAgentsEnabled,
  setAgentsLimitAlerts,
  setAgentsMenuBar,
  statusLinePreview,
  type AgentsInfo,
  type StatusLinePreview,
} from "../../lib/agents";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AgentsCard() {
  const t = useT();
  const setStoreEnabled = useAppStore((s) => s.setAgentsEnabled);
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Plan-limits status line: the latest preview, which change is shown for confirmation.
  const [line, setLine] = useState<StatusLinePreview | null>(null);
  const [lineMode, setLineMode] = useState<"install" | "remove" | null>(null);
  const [lineNote, setLineNote] = useState<string | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAgentsSettings()
      .then((i) => { if (!cancelled) { setInfo(i); setStoreEnabled(i.enabled); } })
      .catch((e) => { if (!cancelled) setError(msg(e)); });
    return () => { cancelled = true; };
  }, [setStoreEnabled]);

  const enabled = info?.enabled ?? false;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    statusLinePreview()
      .then((p) => { if (!cancelled) setLine(p); })
      .catch((e) => { if (!cancelled) setLineError(msg(e)); });
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
    }
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

  const toggleMenuBar = async (on: boolean) => {
    if (!(await run(() => setAgentsMenuBar(on))) || on || !line?.installed) return;
    if (!(await ask(t.agents_status_line_remove_ask, { kind: "warning" }))) return;
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

  const missing = info !== null && !info.claudePath;
  const showLine = enabled && (info?.menuBar || line?.installed);
  const shown = lineMode === "install" ? line?.next : lineMode === "remove" ? line?.removeNext : null;

  return (
    <SettingsCard title={t.agents} desc={t.agents_desc}>
      <SettingRow label={t.agents_enable}>
        <Toggle
          checked={info?.enabled ?? false}
          disabled={!info || (missing && !info.enabled)}
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
          checked={info?.limitAlerts ?? true}
          disabled={!info || !info.enabled || !info.menuBar}
          ariaLabel={t.agents_limit_alerts}
          onChange={(on) => void run(() => setAgentsLimitAlerts(on))}
        />
      </SettingRow>
      {showLine && (
        <SettingRow label={t.agents_status_line} desc={t.agents_status_line_desc}>
          {line?.installed ? (
            <Button size="sm" variant="secondary" onClick={() => void startLine("remove")}>{t.agents_status_line_remove}</Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void startLine("install")}>{t.agents_status_line_setup}</Button>
          )}
        </SettingRow>
      )}
      {shown != null && (
        <div className="rounded-lg border border-[var(--color-border-divider)] p-3 my-2">
          <p className="text-xs text-muted mb-1">{t.agents_status_line_preview_hint}</p>
          {lineMode === "install" && line?.replacesOther && (
            <p role="alert" className="text-xs text-warning mb-1">
              {t.agents_status_line_replaces.replace("{command}", line.current ?? "")}
            </p>
          )}
          <pre data-testid="status-line-preview" className="text-xs overflow-auto max-h-48 whitespace-pre-wrap">{shown}</pre>
          <div className="flex gap-2 mt-2">
            <Button size="sm" onClick={() => void confirmLine()}>{t.agent_access_confirm}</Button>
            <Button size="sm" variant="ghost" onClick={() => setLineMode(null)}>{t.agent_access_cancel}</Button>
          </div>
        </div>
      )}
      {lineNote && <p className="text-xs text-muted py-1">{lineNote}</p>}
      {lineError && <p role="alert" className="text-xs text-danger-text py-1">{lineError}</p>}
      {error && <p role="alert" className="text-xs text-danger-text py-2">{error}</p>}
      {info && (
        <SettingRow label={t.agents_claude_path}>
          {info.claudePath ? (
            <span className="text-xs text-muted font-mono truncate max-w-[24rem]">{info.claudePath}</span>
          ) : (
            <span className="text-xs text-danger-text">{t.agents_claude_missing}</span>
          )}
        </SettingRow>
      )}
      <p className="text-xs text-muted py-2.5">{t.agents_trust_hint}</p>
    </SettingsCard>
  );
}
