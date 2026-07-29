import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
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
import { Button } from "../ui";
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
  /** Currency label (defaults to "CHF") */
  currency?: string;
  /** Hide the rate and unit columns (used when global rate is active) */
  hideRate?: boolean;
  /** Label shown above table when global rate is active, e.g. "All items at 150 CHF/h" */
  globalRateLabel?: string;
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
  currency = "CHF",
  hideRate,
  globalRateLabel,
}: LineItemsTableProps) {
  const t = useT();

  /**
   * Move a row to a neighboring position via the same commit path as
   * drag-and-drop: synthesize a minimal DragEndEvent carrying the two row ids
   * and hand it to onDragEnd. handleDragEnd (useLineItemForm) only reads
   * active.id / over.id, and parents wrap onDragEnd with their dirty-tracking
   * (e.g. markDirty), so button reorders behave identically to drag reorders.
   */
  const moveRow = (from: number, to: number) => {
    const active = items[from];
    const over = items[to];
    if (!active || !over) return;
    onDragEnd({
      active: { id: active._id },
      over: { id: over._id },
    } as unknown as DragEndEvent);
  };

  return (
    <div className="p-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">{t.line_items}</h2>
        <div className="flex items-center gap-3">
          {headerActions}
          <Button variant="link" size="sm" icon={<Plus size={14} />} onClick={onAdd}>
            {t.add_line}
          </Button>
        </div>
      </div>
      {globalRateLabel && (
        <div className="text-xs text-muted mb-2 italic">{globalRateLabel}</div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={lineItemIds} strategy={verticalListSortingStrategy}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="w-12"></th>
                <th className="text-left pb-2">{t.designation}</th>
                {!hideRate && <th className="text-right pb-2 w-24">{t.rate}</th>}
                {!hideRate && <th className="text-left pb-2 w-24">{t.unit}</th>}
                <th className="text-right pb-2 w-20">{t.qty}</th>
                <th className="text-right pb-2 w-28">{t.amount}</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <SortableLineItemRow key={item._id} id={item._id}>
                  <td className="py-1 w-12">
                    <div className="flex items-center">
                      <SortableLineItemHandle id={item._id} />
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => moveRow(i, i - 1)}
                          disabled={i === 0}
                          aria-label={t.move_up}
                          className="text-muted hover:text-[var(--color-text-secondary)] disabled:opacity-30 disabled:pointer-events-none"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRow(i, i + 1)}
                          disabled={i === items.length - 1}
                          aria-label={t.move_down}
                          className="text-muted hover:text-[var(--color-text-secondary)] disabled:opacity-30 disabled:pointer-events-none"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="pr-2 py-1">
                    {renderDesignation ? (
                      renderDesignation(item, i)
                    ) : (
                      <input
                        value={item.designation}
                        onChange={(e) => onUpdate(i, "designation", e.target.value)}
                        className="w-full border border-[var(--color-border-divider)] rounded-lg px-2 py-1.5 text-sm"
                        placeholder={t.description}
                      />
                    )}
                  </td>
                  {!hideRate && (
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={item.rate ?? ""}
                        onChange={(e) => onUpdate(i, "rate", e.target.value ? Number(e.target.value) : null)}
                        className="w-full border border-[var(--color-border-divider)] rounded-lg px-2 py-1.5 text-sm text-right"
                        placeholder="0"
                      />
                    </td>
                  )}
                  {!hideRate && (
                    <td className="px-1 py-1">
                      <select
                        value={item.unit ?? ""}
                        onChange={(e) => onUpdate(i, "unit", e.target.value || null)}
                        className="w-full border border-[var(--color-border-divider)] rounded-lg px-2 py-1.5 text-sm"
                      >
                        <option value="">—</option>
                        <option value="hours">{t.hours}</option>
                        <option value="days">{t.days}</option>
                        <option value="units">{t.units}</option>
                        <option value="flat">{t.flat_rate}</option>
                      </select>
                    </td>
                  )}
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => onUpdate(i, "quantity", Number(e.target.value))}
                      className="w-full border border-[var(--color-border-divider)] rounded-lg px-2 py-1.5 text-sm text-right"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      value={item.amount}
                      onChange={(e) => onUpdate(i, "amount", Number(e.target.value))}
                      className="w-full border border-[var(--color-border-divider)] rounded-lg px-2 py-1.5 text-sm text-right"
                    />
                  </td>
                  <td className="pl-1 py-1">
                    {items.length > 1 && (
                      <button onClick={() => onRemove(i)} aria-label={t.delete} className="text-muted hover:text-danger">
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

      <div className="border-t border-[var(--color-border-divider)] mt-3 pt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">{t.subtotal}</span>
          <span>{currency} {subtotal.toFixed(2)}</span>
        </div>
        {discountRate > 0 && (
          <div className="flex justify-between text-muted">
            <span>{t.cultural_discount} ({(discountRate * 100).toFixed(0)}%)</span>
            <span>- {currency} {discountAmount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-base pt-1">
          <span>{t.total}</span>
          <span>{currency} {total.toFixed(2)}</span>
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
  const t = useT();
  const { attributes, listeners } = useSortable({ id });

  return (
    <div
      {...attributes}
      {...listeners}
      className="cursor-grab text-muted hover:text-[var(--color-text-secondary)] flex items-center justify-center"
      aria-label={t.drag_to_reorder}
    >
      <GripVertical size={14} />
    </div>
  );
}
