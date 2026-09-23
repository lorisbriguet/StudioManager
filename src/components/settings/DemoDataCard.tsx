import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ask } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Database as DatabaseIcon } from "lucide-react";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { getDb } from "../../db";
import { PERSONAS, PERSONA_IDS, seedPersona, type PersonaId } from "../../db/seeds/personas";
import { useAppStore } from "../../stores/app-store";
import { useOrgStore } from "../../stores/org-store";
import { notifyError } from "../../lib/notifyError";
import { useT } from "../../i18n/useT";

/** Demo build only: replace the active organisation's data with a persona seed. */
export function DemoDataCard() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orgName = useOrgStore((s) => s.active()?.name ?? "");
  const testMode = useAppStore((s) => s.testMode);
  const presentationMode = useAppStore((s) => s.presentationMode);
  const [persona, setPersona] = useState<PersonaId>("designer");
  const [loading, setLoading] = useState(false);
  const blocked = testMode || presentationMode;

  const load = async () => {
    if (blocked || loading) return;
    const confirmed = await ask(t.demo_data_confirm.replace("{name}", orgName), { kind: "warning" });
    if (!confirmed) return;
    setLoading(true);
    try {
      await seedPersona(await getDb(), persona, { withConfig: true });
      const { prefs } = PERSONAS[persona];
      useAppStore.getState().setShowIncome(prefs.showIncome);
      useAppStore.getState().setShowTasksPage(prefs.showTasksPage);
      queryClient.clear();
      navigate("/");
      toast.success(t.demo_data_loaded.replace("{name}", orgName));
    } catch (e) {
      notifyError(t.operation_failed, e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-divider)] px-4 pt-3 pb-3">
      <div className="border-b border-[var(--color-border-divider)] pb-2 mb-3">
        <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted">{t.demo_data}</h2>
        <p className="text-xs text-muted mt-1 normal-case tracking-normal">{t.demo_data_desc}</p>
      </div>
      <div className="flex items-center justify-between gap-3 py-2.5">
        <label className="text-sm" htmlFor="demo-persona">{t.demo_data_persona}</label>
        <Select id="demo-persona" fullWidth={false} value={persona} onChange={(e) => setPersona(e.target.value as PersonaId)} disabled={loading}>
          {PERSONA_IDS.map((id) => (
            <option key={id} value={id}>{t[PERSONAS[id].labelKey]}</option>
          ))}
        </Select>
      </div>
      <div className="pt-1">
        <Button type="button" size="sm" icon={<DatabaseIcon size={12} />} onClick={() => void load()} disabled={blocked || loading} loading={loading} title={blocked ? t.demo_data_blocked : undefined}>
          {t.demo_data_load}
        </Button>
      </div>
    </section>
  );
}
