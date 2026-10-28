import { Input, Select } from "../ui";
import { CollapsibleSection } from "../upkeep/CollapsibleSection";
import { SettingRow } from "./SettingsPrimitives";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../i18n/useT";
import { syncAllUpkeepEvents } from "../../lib/upkeep/calendar";
import type { UpkeepAlert } from "../../types/upkeep";

type ConcreteAlert = Exclude<UpkeepAlert, "default">;
const ALERTS: ConcreteAlert[] = ["none", "day_9am", "day_before", "week_before"];

function DaysInput({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  return (
    <Input
      type="number"
      min={1}
      max={365}
      aria-label={label}
      value={value}
      onChange={(e) => {
        const n = Math.round(Number(e.target.value));
        if (Number.isFinite(n) && n >= 1 && n <= 365) onCommit(n);
      }}
      fullWidth={false}
      className="w-24"
    />
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
    // Existing Calendar events carry the old alarm: rebuild them with the new default.
    void syncAllUpkeepEvents();
  };

  return (
    <div className="space-y-6">
      <CollapsibleSection id="settings-reminders" title={t.upkeep_settings_reminders}>
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
      </CollapsibleSection>

      <CollapsibleSection id="settings-windows" title={t.upkeep_settings_windows}>
        <SettingRow label={t.upkeep_settings_soon_days}>
          <DaysInput label={t.upkeep_settings_soon_days} value={soonDays} onCommit={setSoonDays} />
        </SettingRow>
        <SettingRow label={t.upkeep_settings_warranty_days}>
          <DaysInput label={t.upkeep_settings_warranty_days} value={warrantyDays} onCommit={setWarrantyDays} />
        </SettingRow>
        <SettingRow label={t.upkeep_settings_renewal_days}>
          <DaysInput label={t.upkeep_settings_renewal_days} value={renewalDays} onCommit={setRenewalDays} />
        </SettingRow>
      </CollapsibleSection>

      {/* TASK 12: connections list goes here, as another CollapsibleSection. */}
    </div>
  );
}
