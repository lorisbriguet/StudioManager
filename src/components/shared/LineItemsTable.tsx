import { Plus, Trash2, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LineItem } from "../../lib/lineItems";
import { useT } from "../../i18n/useT";

interface LineItemsTableProps {
  items: LineItem[];
  lineItemIds: number[];
  sensors: ReturnType<typeof import("@dnd-kit/core").useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof LineItem, value: unknown) => void;
  /** Extra buttons to render in the header next to "Add line" */
  headerActions?: React.ReactNode;
  /** Custom designation cell renderer per row */
  renderDesignation?: (item: LineItem, index: number) => React.ReactNode;
  /** Totals */
  subtotal: number;
  discountRate: number;
  discountAmount: number;
  total: number;
}

export function LineItemsTable({
  items,
  lineItemIds,
  sensors,
  onDragEnd,
  onAdd,
  onRemove,
  onUpdate,
  headerActions,
  renderDesignation,
  subtotal,
  discountRate,
  discountAmount,
  total,
}: LineItemsTableProps) {
  const t = useT();

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">{t.line_items}</h2>
        <div className="flex items-center gap-3">
          {headerActions}
          <button onClick={onAdd} className="flex items-center gap-1 text-xs text-accent hover:underline">
            <Plus size={14} /> {t.add_line}
          </button>
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={lineItemIds} strategy={verticalListSortingStrategy}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="w-8"></th>
                <th className="text-left pb-2">{t.designation}</th>
                <th className="text-right pb-2 w-24">{t.rate}</th>
                <th className="text-right pb-2 w-20">{t.qty}</th>
                <th className="text-right pb-2 w-28">{t.amount}</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <SortableLineItemRow key={item._id} id={item._id}>
                  <td className="py-1 w-8">
                    <SortableLineItemHandle id={item._id} />
                  </td>
                  <td className="pr-2 py-1">
                    {renderDesignation ? (
                      renderDesignation(item, i)
                    ) : (
                      <input
                        value={item.designation}
                        onChange={(e) => onUpdate(i, "designation", e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                        placeholder={t.description}
                      />
                    )}
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      value={item.rate ?? ""}
                      onChange={(e) => onUpdate(i, "rate", e.target.value ? Number(e.target.value) : null)}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-right"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => onUpdate(i, "quantity", Number(e.target.value))}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-right"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      value={item.amount}
                      onChange={(e) => onUpdate(i, "amount", Number(e.target.value))}
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm text-right"
                    />
                  </td>
                  <td className="pl-1 py-1">
                    {items.length > 1 && (
                      <button onClick={() => onRemove(i)} className="text-muted hover:text-danger">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </SortableLineItemRow>
              ))}
            </tbody>
          </table>
        </SortableContext>
      </DndContext>

      <div className="border-t border-gray-200 mt-3 pt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">{t.subtotal}</span>
          <span>CHF {subtotal.toFixed(2)}</span>
        </div>
        {discountRate > 0 && (
          <div className="flex justify-between text-muted">
            <span>{t.cultural_discount} ({(discountRate * 100).toFixed(0)}%)</span>
            <span>- CHF {discountAmount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-base pt-1">
          <span>{t.total}</span>
          <span>CHF {total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

function SortableLineItemRow({ id, children }: { id: number; children: React.ReactNode }) {
  const { setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <tr ref={setNodeRef} style={style}>
      {children}
    </tr>
  );
}

function SortableLineItemHandle({ id }: { id: number }) {
  const { attributes, listeners } = useSortable({ id });

  return (
    <div
      {...attributes}
      {...listeners}
      className="cursor-grab text-gray-300 hover:text-gray-600 flex items-center justify-center"
      aria-label="Drag to reorder"
    >
      <GripVertical size={14} />
    </div>
  );
}
