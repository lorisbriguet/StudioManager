import { useT } from "../../i18n/useT";
import type { TaskPriority } from "../../types/task";

export function PriorityBadge({ priority, onClick }: { priority: TaskPriority; onClick?: () => void }) {
  const t = useT();
  const colors: Record<TaskPriority, string> = {
    high: "bg-danger",
    medium: "bg-warning",
    low: "bg-success",
  };
  const labels: Record<TaskPriority, string> = {
    high: t.priority_high,
    medium: t.priority_medium,
    low: t.priority_low,
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer hover:opacity-70"
      title={`${t.priority}: ${labels[priority]}`}
      aria-label={`${t.priority}: ${labels[priority]}`}
    >
      <span className={`dot ${colors[priority]}`} />
    </button>
  );
}
