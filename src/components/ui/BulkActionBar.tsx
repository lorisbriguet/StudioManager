import { type ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "../../i18n/useT";
import { IconButton } from "./IconButton";
import { Button } from "./Button";
import { SURFACE_FILL } from "./tokens";

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
    // The surface without its border, as before: the shadow alone lifts the bar.
    <div className={`${SURFACE_FILL} shadow-lg fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 bulk-bar-animate`}>
      <span className="text-sm font-medium whitespace-nowrap">
        {count} {t.selected}
      </span>
      <div className="w-px h-5 bg-[var(--color-border-divider)]" />
      {actions.map((action, i) => (
        <Button
          key={i}
          variant={action.danger ? "danger" : "secondary"}
          icon={action.icon}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
      <IconButton icon={X} label={t.cancel} onClick={onClear} />
    </div>
  );
}
