import type { ReactNode } from "react";
import { Card, EmptyState } from "../ui";
import { useT } from "../../i18n/useT";

export interface LinkPickerItem {
  id: number | string;
  icon: ReactNode;
  label: ReactNode;
  /** Right-aligned content (tags, a URL); it brings its own classes. */
  trailing?: ReactNode;
  onPick: () => void;
}

/**
 * The inline "link an existing item" box of a project block (wiki articles,
 * resources): an inset Card with a scrolling list and a Cancel link.
 */
export function LinkPicker({
  items,
  emptyMessage,
  onCancel,
}: {
  items: LinkPickerItem[];
  emptyMessage: string;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <Card tone="inset" padding="sm" className="mt-2">
      {items.length === 0 ? (
        <EmptyState size="sm" message={emptyMessage} />
      ) : (
        <div className="max-h-32 overflow-y-auto space-y-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onPick}
              className="w-full text-left px-2 py-1 text-sm hover:bg-[var(--color-hover-row)] rounded-md flex items-center gap-2"
            >
              {item.icon}
              {item.label}
              {item.trailing}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={onCancel} className="text-xs text-muted mt-1 hover:text-[var(--color-text)]">
        {t.cancel}
      </button>
    </Card>
  );
}
