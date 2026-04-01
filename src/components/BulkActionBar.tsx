import { type ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n/useT";

interface BulkAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
}

export function BulkActionBar({ count, actions, onClear }: Props) {
  const t = useT();
  if (count === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[var(--color-surface)] shadow-lg bulk-bar-animate">
      <span className="text-sm font-medium whitespace-nowrap">
        {count} {t.selected}
      </span>
      <div className="w-px h-5 bg-[var(--color-border-divider)]" />
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={action.onClick}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
            action.danger
              ? "text-[var(--color-danger-text)] hover:bg-[var(--color-danger-bg)]"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
          }`}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
      <button
        onClick={onClear}
        className="p-1 text-muted hover:text-[var(--color-text-secondary)]"
        title={t.cancel}
      >
        <X size={14} />
      </button>
    </div>
  );
}
