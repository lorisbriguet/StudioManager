import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "../components/ui";
import { useMachine } from "../db/hooks/useUpkeep";
import { useT } from "../i18n/useT";

/** Placeholder shell; the machine detail tabs arrive with the next task. */
export function MachinePage() {
  const t = useT();
  const { id } = useParams();
  const { data: machine } = useMachine(id ? Number(id) : null);

  return (
    <div>
      <Link to="/upkeep" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-[var(--color-text-secondary)] mb-3">
        <ArrowLeft size={16} />
        {t.upkeep_back}
      </Link>
      <PageHeader title={machine?.name ?? ""} />
    </div>
  );
}
