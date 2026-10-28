import { useEffect, useState } from "react";
import { SettingRow, SettingsCard } from "./SettingsPrimitives";
import { Toggle } from "../ui/Toggle";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../i18n/useT";
import {
  getAgentsSettings,
  setAgentsEnabled,
  setAgentsLimitAlerts,
  setAgentsMenuBar,
  type AgentsInfo,
} from "../../lib/agents";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AgentsCard() {
  const t = useT();
  const setStoreEnabled = useAppStore((s) => s.setAgentsEnabled);
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAgentsSettings()
      .then((i) => { if (!cancelled) { setInfo(i); setStoreEnabled(i.enabled); } })
      .catch((e) => { if (!cancelled) setError(msg(e)); });
    return () => { cancelled = true; };
  }, [setStoreEnabled]);

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
    } catch (e) {
      setError(msg(e));
    }
  };

  const missing = info !== null && !info.claudePath;

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
          onChange={(on) => void run(() => setAgentsMenuBar(on))}
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
