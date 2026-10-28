import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { MachineDetail } from "../components/upkeep/MachineDetail";
import { useT } from "../i18n/useT";

export function MachinePage() {
  const t = useT();
  const { id } = useParams();
  const machineId = id ? Number(id) : null;

  return (
    <div>
      <Link to="/upkeep?tab=machines" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-[var(--color-text-secondary)] mb-3">
        <ArrowLeft size={16} />
        {t.upkeep_back}
      </Link>
      {machineId !== null && <MachineDetail machineId={machineId} />}
    </div>
  );
}
