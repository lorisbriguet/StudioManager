import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useT } from "../../i18n/useT";

export function SortableSubtaskRow({
  id,
  hovered,
  onHoverChange,
  children,
}: {
  id: number;
  /** Handle visibility is explicit state, not CSS :hover — WebKit can leave
   *  :hover stale when dnd re-renders move rows under a stationary cursor,
   *  making the handle stick after the pointer left (#335). */
  hovered: boolean;
  onHoverChange: (id: number | null) => void;
  children: React.ReactNode;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 py-1 group/sub"
      onMouseEnter={() => onHoverChange(id)}
      onMouseLeave={() => onHoverChange(null)}
    >
      <div
        {...attributes}
        {...listeners}
        className={`cursor-grab text-muted hover:text-[var(--color-text-secondary)] transition-opacity shrink-0 ${hovered ? "opacity-100" : "opacity-0"}`}
        aria-label={t.drag_to_reorder}
      >
        <GripVertical size={14} />
      </div>
      {children}
    </div>
  );
}
