import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SettingRow, SettingsCard } from "../ui/Settings";
import { Button, ICONS } from "../ui";
import { useConfirm } from "../../lib/confirm";
import { useT } from "../../i18n/useT";
import { useNow } from "../../hooks/useNow";
import { useHubs } from "../../hooks/useHubs";
import { qk } from "../../db/queryKeys";
import { hubErrorText, removeHub, type HubView } from "../../lib/hubs";
import { HubDot, hubStateLine, useHubRefresh } from "../agents/HubLine";
import { HubForm } from "./HubForm";

/**
 * Settings › Agents › Hubs: the other stores of work StudioManager asks for counts. Shown while
 * Agents is on. Everything a hub or its connector says is plain text; a closed gate (a mode)
 * shows its own text once, muted.
 */
export function HubsCard() {
  const t = useT();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const now = useNow();
  const refresh = useHubRefresh();
  const q = useHubs();
  const [form, setForm] = useState<{ hub: HubView | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hubs = q.isError ? [] : (q.data ?? []);
  // Opening the form drops the message of an earlier Try again or Remove: it would outlive the save that answers it.
  const openForm = (hub: HubView | null) => {
    setError(null);
    setForm({ hub });
  };

  const remove = async (h: HubView) => {
    if (!(await confirm({ title: t.hubs_remove_confirm.replace("{name}", h.name), confirmLabel: t.remove, tone: "danger" }))) return;
    try {
      await removeHub(h.id);
      setError(null);
    } catch (e) {
      setError(hubErrorText(e));
    } finally {
      void qc.invalidateQueries({ queryKey: qk.hubs.all });
    }
  };

  return (
    <SettingsCard title={t.hubs_title} desc={t.hubs_desc}>
      {q.isError && <p className="text-xs text-muted py-2.5">{hubErrorText(q.error)}</p>}
      {!q.isError && hubs.length === 0 && !q.isLoading && <p className="text-xs text-muted py-2.5">{t.hubs_empty}</p>}
      {hubs.map((h) => (
        <SettingRow
          key={h.id}
          label={
            <span className="inline-flex items-center gap-2">
              <HubDot colour={h.colour} />
              <span>{h.name}</span>
            </span>
          }
          desc={
            <>
              <span className="block break-all">{h.folder}</span>
              <span className="block">{hubStateLine(h, t, now)}</span>
            </>
          }
        >
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon={ICONS.edit} onClick={() => openForm(h)}>
              {t.edit}
            </Button>
            <Button variant="secondary" loading={h.busy} onClick={() => void refresh(h.id).then(setError)}>
              {t.hubs_try_again}
            </Button>
            <Button variant="secondary" icon={ICONS.delete} onClick={() => void remove(h)}>
              {t.remove}
            </Button>
          </div>
        </SettingRow>
      ))}
      {error && (
        <p role="alert" className="text-xs text-danger-text pb-2">
          {error}
        </p>
      )}
      <div className="pt-2 pb-3">
        <Button variant="outline" icon={ICONS.add} onClick={() => openForm(null)}>
          {t.hubs_add}
        </Button>
      </div>
      {form && <HubForm hub={form.hub} onClose={() => setForm(null)} />}
    </SettingsCard>
  );
}
