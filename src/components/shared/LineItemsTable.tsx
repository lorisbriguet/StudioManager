import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
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
import { Button, Card, DragHandle, Select, IconButton, Input, Table } from "../ui";
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
    <div>
      <Card.Header
        title={t.line_items}
        action={
          <div className="flex items-center gap-3">
            {headerActions}
            <Button variant="link" icon={<Plus size={12} />} onClick={onAdd}>
              {t.add_line}
            </Button>
          </div>
        }
      />
      {globalRateLabel && (
        <div className="text-xs text-muted mb-2 italic">{globalRateLabel}</div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={lineItemIds} strategy={verticalListSortingStrategy}>
          <Table density="compact">
            <Table.Head>
              <Table.Th narrow />
              <Table.Th>{t.designation}</Table.Th>
              {!hideRate && <Table.Th numeric className="w-24">{t.rate}</Table.Th>}
              {!hideRate && <Table.Th className="w-24">{t.unit}</Table.Th>}
              <Table.Th numeric className="w-20">{t.qty}</Table.Th>
              <Table.Th numeric className="w-28">{t.amount}</Table.Th>
              <Table.ActionsTh />
            </Table.Head>
            <Table.Body>
              {items.map((item, i) => (
                <SortableLineItemRow key={item._id} id={item._id}>
                  <Table.Td narrow>
                    <div className="flex items-center">
                      <SortableLineItemHandle id={item._id} />
                      <div className="flex flex-col">
                        <IconButton size="xs" icon={ChevronUp} label={t.move_up} onClick={() => moveRow(i, i - 1)} disabled={i === 0} />
                        <IconButton size="xs" icon={ChevronDown} label={t.move_down} onClick={() => moveRow(i, i + 1)} disabled={i === items.length - 1} />
                      </div>
                    </div>
                  </Table.Td>
                  <Table.Td>
                    {renderDesignation ? (
                      renderDesignation(item, i)
                    ) : (
                      <Input
                        value={item.designation}
                        onChange={(e) => onUpdate(i, "designation", e.target.value)}
                        placeholder={t.description}
                        aria-label={t.designation}
                      />
                    )}
                  </Table.Td>
                  {!hideRate && (
                    <Table.Td numeric>
                      <Input
                        numeric
                        step="0.01"
                        value={item.rate ?? ""}
                        onChange={(e) => onUpdate(i, "rate", e.target.value ? Number(e.target.value) : null)}
                        placeholder="0"
                        aria-label={t.rate}
                      />
                    </Table.Td>
                  )}
                  {!hideRate && (
                    <Table.Td>
                      <Select
                        value={item.unit ?? ""}
                        onChange={(e) => onUpdate(i, "unit", e.target.value || null)}
                        aria-label={t.unit}
                      >
                        <option value="">—</option>
                        <option value="hours">{t.hours}</option>
                        <option value="days">{t.days}</option>
                        <option value="units">{t.units}</option>
                        <option value="flat">{t.flat_rate}</option>
                      </Select>
                    </Table.Td>
                  )}
                  <Table.Td numeric>
                    <Input
                      numeric
                      value={item.quantity}
                      onChange={(e) => onUpdate(i, "quantity", Number(e.target.value))}
                      aria-label={t.qty}
                    />
                  </Table.Td>
                  <Table.Td numeric>
                    <Input
                      numeric
                      step="0.01"
                      value={item.amount}
                      onChange={(e) => onUpdate(i, "amount", Number(e.target.value))}
                      aria-label={t.amount}
                    />
                  </Table.Td>
                  <Table.Actions>
                    {items.length > 1 && (
                      <IconButton size="xs" icon={Trash2} label={t.delete} tone="danger" onClick={() => onRemove(i)} />
                    )}
                  </Table.Actions>
                </SortableLineItemRow>
              ))}
            </Table.Body>
            {/* Totals: subtotal, discount, total, the labels under the line's fields and the sums under Amount. */}
            <Table.Foot>
              <td />
              <Table.Td colSpan={hideRate ? 2 : 4} className="py-2">
                <div className="space-y-1">
                  <div className="text-muted font-normal">{t.subtotal}</div>
                  {discountRate > 0 && (
                    <div className="text-muted font-normal">
                      {t.cultural_discount} ({(discountRate * 100).toFixed(0)}%)
                    </div>
                  )}
                  <div className="font-semibold text-base">{t.total}</div>
                </div>
              </Table.Td>
              <Table.Td numeric className="py-2 whitespace-nowrap">
                <div className="space-y-1">
                  <div className="font-normal">{currency} {subtotal.toFixed(2)}</div>
                  {discountRate > 0 && (
                    <div className="text-muted font-normal">- {currency} {discountAmount.toFixed(2)}</div>
                  )}
                  <div className="font-semibold text-base">{currency} {total.toFixed(2)}</div>
                </div>
              </Table.Td>
              <td />
            </Table.Foot>
          </Table>
        </SortableContext>
      </DndContext>
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
    <Table.Row ref={setNodeRef} style={style}>
      {children}
    </Table.Row>
  );
}

function SortableLineItemHandle({ id }: { id: number }) {
  const { attributes, listeners } = useSortable({ id });

  return <DragHandle {...attributes} {...listeners} className="flex items-center justify-center" />;
}
