import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DragHandle } from "../ui/Feedback";

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
      {/* Not reveal="sub": that is CSS :hover, the stale-hover bug above. Keyboard focus still shows it. */}
      <DragHandle {...attributes} {...listeners} className={hovered ? "opacity-100" : "opacity-0 focus-visible:opacity-100"} />
      {children}
    </div>
  );
}
