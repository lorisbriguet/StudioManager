import { useT } from "../../i18n/useT";
import type { TaskPriority } from "../../types/task";
import { priorityDotClass } from "../../lib/statusColors";
import { Tooltip } from "../ui/Tooltip";

export function PriorityBadge({ priority, onClick }: { priority: TaskPriority; onClick?: () => void }) {
  const t = useT();
  const labels: Record<TaskPriority, string> = {
    high: t.priority_high,
    medium: t.priority_medium,
    low: t.priority_low,
  };
  const label = `${t.priority}: ${labels[priority]}`;
  return (
    <Tooltip content={label}>
      <button type="button" onClick={onClick} className="cursor-pointer hover:opacity-70" aria-label={label}>
        <span className={`dot ${priorityDotClass(priority)}`} />
      </button>
    </Tooltip>
  );
}
