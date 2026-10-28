import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { SettingRow, SettingsCard } from "../ui/Settings";
import { Toggle } from "../ui/Toggle";
import { Button } from "../ui/Button";
import { SectionLabel } from "../ui/SectionLabel";
import { Checkbox } from "../ui/Checkbox";
import { useOrgStore } from "../../stores/org-store";
import { useT } from "../../i18n/useT";

const HELP_URL = "https://github.com/lorisbriguet/StudioManager/blob/main/docs/agent-access.md";

interface AgentAccess {
  enabled: boolean;
  allowMoney: boolean;
  orgs: Record<string, boolean>;
  mcpPath: string;
  claudeDesktopInstalled: boolean;
  claudeCodeCommand: string;
  genericConfig: string;
}
interface LogEntry { at: string; org: string; tool: string; summary: string }
type Settings = Pick<AgentAccess, "enabled" | "allowMoney" | "orgs">;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function formatAt(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export function AgentAccessCard() {
  const t = useT();
  const organisations = useOrgStore((s) => s.organisations);
  const [info, setInfo] = useState<AgentAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<{ key: string; message: string } | null>(null);
  const saveSeq = useRef(0);
  const confirmed = useRef<AgentAccess | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [installed, setInstalled] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const loadLog = useCallback(() => {
    invoke<LogEntry[]>("recent_agent_changes", { limit: 20 }).then((l) => setLog(l ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    invoke<AgentAccess>("get_agent_access").then((i) => { confirmed.current = i; setInfo(i); }).catch((e) => setError(msg(e)));
    loadLog();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen("db-changed", loadLog).then((fn) => { if (cancelled) fn(); else unlisten = fn; }).catch(() => {});
    return () => { cancelled = true; unlisten?.(); clearTimeout(copiedTimer.current); };
  }, [loadLog]);

  const save = async (next: Settings) => {
    if (!info) return;
    const seq = ++saveSeq.current;
    setInfo({ ...info, ...next });
    setError(null);
    try {
      await invoke("set_agent_access", next);
      if (confirmed.current) confirmed.current = { ...confirmed.current, ...next };
    } catch (e) {
      // Only the latest save may revert; an older failure must not undo a newer one.
      if (seq !== saveSeq.current) return;
      if (confirmed.current) setInfo(confirmed.current);
      setError(msg(e));
    }
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError(null);
      setCopied(key);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), 2000);
    } catch (e) {
      setCopied(null);
      setCopyError({ key, message: msg(e) });
    }
  };

  const startAdd = async () => {
    setInstalled(false);
    setInstallError(null);
    try {
      setPreview(await invoke<string>("preview_claude_desktop"));
    } catch (e) {
      setInstallError(msg(e));
    }
  };

  const confirmAdd = async () => {
    if (preview === null) return;
    try {
      await invoke("install_claude_desktop", { expected: preview });
      setPreview(null);
      setInstalled(true);
    } catch (e) {
      setPreview(null);
      setInstallError(msg(e));
    }
  };

  const orgName = (id: string) => organisations.find((o) => o.id === id)?.name ?? id;

  return (
    <SettingsCard title={t.agent_access} desc={t.agent_access_desc}>
      <SettingRow label={t.agent_access_enable}>
        <Toggle
          checked={info?.enabled ?? false}
          disabled={!info}
          ariaLabel={t.agent_access_enable}
          onChange={(enabled) => info && void save({ enabled, allowMoney: info.allowMoney, orgs: info.orgs })}
        />
      </SettingRow>
      {error && <p role="alert" className="text-xs text-danger-text py-2">{error}</p>}

      {info?.enabled && (
        <>
          <div className="py-2.5 border-b border-[var(--color-border-divider)]">
            <div className="text-sm mb-1.5">{t.agent_access_orgs}</div>
            <ul className="space-y-1">
              {organisations.map((o) => (
                <li key={o.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={info.orgs[o.id] !== false}
                      onChange={(e) => void save({ enabled: info.enabled, allowMoney: info.allowMoney, orgs: { ...info.orgs, [o.id]: e.target.checked } })}
                    />
                    {o.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <SettingRow label={t.agent_access_money}>
            <Toggle
              checked={info.allowMoney}
              ariaLabel={t.agent_access_money}
              onChange={(allowMoney) => void save({ enabled: info.enabled, allowMoney, orgs: info.orgs })}
            />
          </SettingRow>

          <div className="py-2.5 border-b border-[var(--color-border-divider)]">
            <SectionLabel className="mb-1">{t.agent_access_connect}</SectionLabel>
            {info.claudeDesktopInstalled && (
              <SettingRow label={t.agent_access_claude_desktop}>
                <Button variant="secondary" onClick={() => void startAdd()}>{t.agent_access_add}</Button>
              </SettingRow>
            )}
            {preview !== null && (
              <div className="rounded-lg border border-[var(--color-border-divider)] p-3 my-2">
                <p className="text-xs text-muted mb-1">{t.agent_access_preview_hint}</p>
                <pre className="text-xs overflow-auto max-h-48 whitespace-pre-wrap">{preview}</pre>
                <div className="flex gap-2 mt-2">
                  <Button onClick={() => void confirmAdd()}>{t.agent_access_confirm}</Button>
                  <Button variant="outline" onClick={() => setPreview(null)}>{t.agent_access_cancel}</Button>
                </div>
              </div>
            )}
            {installed && <p className="text-xs text-muted py-1">{t.agent_access_installed}</p>}
            {installError && <p role="alert" className="text-xs text-danger-text py-1">{installError}</p>}
            <SettingRow label={t.agent_access_claude_code}>
              <span className="flex items-center gap-2">
                {copied === "code" && <span className="text-xs text-muted">{t.agent_access_copied}</span>}
                {copyError?.key === "code" && <span role="alert" className="text-xs text-danger-text">{copyError.message}</span>}
                <Button variant="secondary" onClick={() => void copy("code", info.claudeCodeCommand)}>{t.agent_access_copy_command}</Button>
              </span>
            </SettingRow>
            <SettingRow label={t.agent_access_other}>
              <span className="flex items-center gap-2">
                {copied === "config" && <span className="text-xs text-muted">{t.agent_access_copied}</span>}
                {copyError?.key === "config" && <span role="alert" className="text-xs text-danger-text">{copyError.message}</span>}
                <Button variant="secondary" onClick={() => void copy("config", info.genericConfig)}>{t.agent_access_copy_config}</Button>
              </span>
            </SettingRow>
          </div>

          <div className="py-2.5 border-b border-[var(--color-border-divider)]">
            <SectionLabel className="mb-1">{t.agent_access_recent}</SectionLabel>
            {log.length === 0 ? (
              <p className="text-xs text-muted">{t.agent_access_none}</p>
            ) : (
              <ul className="space-y-1">
                {log.map((l, i) => (
                  <li key={`${l.at}-${i}`} className="text-xs flex gap-2">
                    <span className="text-muted shrink-0">{formatAt(l.at)}</span>
                    <span className="text-muted shrink-0">{orgName(l.org)}</span>
                    <span className="min-w-0 truncate">{l.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className="py-2.5">
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => void openUrl(HELP_URL)}>
          {t.agent_access_help}
        </button>
      </div>
    </SettingsCard>
  );
}
