import { useNavigate, useParams } from "react-router-dom";
import { MachineDetail } from "../components/upkeep/MachineDetail";

export function MachinePage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const machineId = id ? Number(id) : null;

  return (
    <div>
      {machineId !== null && <MachineDetail machineId={machineId} onBack={() => navigate("/upkeep?tab=machines")} />}
    </div>
  );
}
