import { useNavigate } from "react-router-dom";
import { useT } from "../i18n/useT";
import { Button, EmptyState, ICONS, PageHeader } from "../components/ui";

export function NetworkPage() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader title={t.network} />
      <EmptyState
        icon={ICONS.network}
        message={t.network_empty_title}
        hint={t.network_empty_desc}
        action={<Button variant="outline" onClick={() => navigate("/upkeep")}>{t.open_upkeep}</Button>}
      />
    </div>
  );
}
