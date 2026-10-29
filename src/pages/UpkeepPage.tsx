import { useSearchParams } from "react-router-dom";
import { PageHeader, TabItem } from "../components/ui";
import { ConsumablesTab } from "../components/upkeep/ConsumablesTab";
import { SubscriptionsTab } from "../components/upkeep/SubscriptionsTab";
import { MachinesTab } from "../components/upkeep/MachinesTab";
import { OverviewTab } from "../components/upkeep/OverviewTab";
import { useT } from "../i18n/useT";

const TABS = ["overview", "machines", "consumables", "subscriptions"] as const;
type Tab = (typeof TABS)[number];

export function UpkeepPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "overview";

  const labels: Record<Tab, string> = {
    overview: t.upkeep_tab_overview,
    machines: t.upkeep_tab_machines,
    consumables: t.upkeep_tab_consumables,
    subscriptions: t.upkeep_tab_subscriptions,
  };

  return (
    <div>
      <PageHeader title={t.upkeep} />
      <div role="tablist" aria-label={t.upkeep} className="flex items-center gap-1 mb-6 border-b border-[var(--color-border)]">
        {TABS.map((k) => (
          <TabItem
            key={k}
            role="tab"
            label={labels[k]}
            active={tab === k}
            onActivate={() => setParams(k === "overview" ? {} : { tab: k }, { replace: true })}
          />
        ))}
      </div>
      {tab === "overview" ? (
        <OverviewTab />
      ) : tab === "machines" ? (
        <MachinesTab />
      ) : tab === "consumables" ? (
        <ConsumablesTab />
      ) : (
        <SubscriptionsTab />
      )}
    </div>
  );
}
