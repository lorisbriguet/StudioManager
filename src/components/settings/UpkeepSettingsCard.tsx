import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CARD_STACK, Input, Select, SettingRow, SettingsCard } from "../ui";
import { ConnectionsCard } from "../upkeep/ConnectionsCard";
import { logError } from "../../lib/log";
import { useAppStore } from "../../stores/app-store";
import { useOrgStore } from "../../stores/org-store";
import { closeEquipmentDb } from "../../db";
import { useT } from "../../i18n/useT";
import { syncAllUpkeepEvents } from "../../lib/upkeep/calendar";
import type { UpkeepAlert } from "../../types/upkeep";

type ConcreteAlert = Exclude<UpkeepAlert, "default">;
const ALERTS: ConcreteAlert[] = ["none", "day_9am", "day_before", "week_before"];

function DaysInput({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  // Local draft so the field can be cleared and retyped; the store only sees valid values.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const valid = (text: string): number | null => {
    const n = Math.round(Number(text));
    return text.trim() !== "" && Number.isFinite(n) && n >= 1 && n <= 365 ? n : null;
  };

  return (
    <Input
      type="number"
      min={1}
      max={365}
      aria-label={label}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = valid(e.target.value);
        if (n !== null) onCommit(n);
      }}
      onBlur={() => setDraft(String(value))}
      width="sm"
      numeric
    />
  );
}

/** Pick whose machines and consumables this organisation uses. */
function EquipmentSourceRow() {
  const t = useT();
  const queryClient = useQueryClient();
  const organisations = useOrgStore((s) => s.organisations);
  const activeId = useOrgStore((s) => s.activeId);
  const from = useOrgStore((s) => s.activePrefs()?.equipmentFrom ?? "");
  const others = organisations.filter((o) => o.id !== activeId);
  if (others.length === 0) return null;

  const onChange = async (value: string) => {
    await useOrgStore.getState().savePrefs({ equipmentFrom: value || undefined });
    // The next query opens the right database; cached rows belong to the old one.
    await closeEquipmentDb();
    await queryClient.invalidateQueries();
  };

  return (
    <SettingsCard title={t.upkeep_settings_equipment}>
      <SettingRow label={t.upkeep_settings_equipment_source} desc={t.upkeep_settings_equipment_source_desc}>
        <Select
          aria-label={t.upkeep_settings_equipment_source}
          value={from}
          onChange={(e) => void onChange(e.target.value)}
          fullWidth={false}
        >
          <option value="">{t.upkeep_settings_equipment_own}</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </Select>
      </SettingRow>
    </SettingsCard>
  );
}

/** Settings card for Studio upkeep. */
export function UpkeepSettingsCard() {
  const t = useT();
  const alertDefault = useAppStore((s) => s.upkeepAlertDefault);
  const setAlertDefault = useAppStore((s) => s.setUpkeepAlertDefault);
  const soonDays = useAppStore((s) => s.upkeepSoonDays);
  const setSoonDays = useAppStore((s) => s.setUpkeepSoonDays);
  const warrantyDays = useAppStore((s) => s.warrantyWindowDays);
  const setWarrantyDays = useAppStore((s) => s.setWarrantyWindowDays);
  const renewalDays = useAppStore((s) => s.renewalWindowDays);
  const setRenewalDays = useAppStore((s) => s.setRenewalWindowDays);

  const labels: Record<ConcreteAlert, string> = {
    none: t.upkeep_alert_none,
    day_9am: t.upkeep_alert_day_9am,
    day_before: t.upkeep_alert_day_before,
    week_before: t.upkeep_alert_week_before,
  };

  const onAlertChange = (alert: ConcreteAlert) => {
    setAlertDefault(alert);
    // Events that follow the default carry the old alarm: rebuild them with the new one.
    syncAllUpkeepEvents({ forceDefaultAlert: true }).catch((e) => logError("Upkeep calendar re-sync failed:", e));
  };

  return (
    <div className={CARD_STACK}>
      <EquipmentSourceRow />
      <SettingsCard title={t.upkeep_settings_reminders}>
        <SettingRow label={t.upkeep_settings_alert} desc={t.upkeep_settings_alert_desc}>
          <Select
            aria-label={t.upkeep_settings_alert}
            value={alertDefault}
            onChange={(e) => onAlertChange(e.target.value as ConcreteAlert)}
            fullWidth={false}
          >
            {ALERTS.map((a) => (
              <option key={a} value={a}>{labels[a]}</option>
            ))}
          </Select>
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t.upkeep_settings_windows}>
        <SettingRow label={t.upkeep_settings_soon_days}>
          <DaysInput label={t.upkeep_settings_soon_days} value={soonDays} onCommit={setSoonDays} />
        </SettingRow>
        <SettingRow label={t.upkeep_settings_warranty_days}>
          <DaysInput label={t.upkeep_settings_warranty_days} value={warrantyDays} onCommit={setWarrantyDays} />
        </SettingRow>
        <SettingRow label={t.upkeep_settings_renewal_days}>
          <DaysInput label={t.upkeep_settings_renewal_days} value={renewalDays} onCommit={setRenewalDays} />
        </SettingRow>
      </SettingsCard>

      <ConnectionsCard />
    </div>
  );
}
