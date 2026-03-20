import { useState, useMemo, useCallback } from "react";
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";

export interface LineItem {
  _id: number;
  designation: string;
  rate: number | null;
  unit: string | null;
  quantity: number;
  amount: number;
}

let nextLineItemId = 1;

export function makeLineItem(partial?: Partial<Omit<LineItem, "_id">>): LineItem {
  return {
    _id: nextLineItemId++,
    designation: "",
    rate: null,
    unit: null,
    quantity: 1,
    amount: 0,
    ...partial,
  };
}

/** Strips _id and adds sort_order for persistence */
export function toPersistedLineItems(items: LineItem[]) {
  return items.map(({ _id, ...item }, i) => ({ ...item, sort_order: i }));
}

export function useLineItemForm(initial?: LineItem[]) {
  const [items, setItems] = useState<LineItem[]>(initial ?? [makeLineItem()]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const lineItemIds = useMemo(() => items.map((i) => i._id), [items]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = items.findIndex((i) => i._id === active.id);
      const newIndex = items.findIndex((i) => i._id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setItems(arrayMove(items, oldIndex, newIndex));
      }
    },
    [items]
  );

  const addItem = useCallback(() => setItems((prev) => [...prev, makeLineItem()]), []);

  const removeItem = useCallback(
    (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i)),
    []
  );

  const updateItem = useCallback(
    (i: number, field: keyof LineItem, value: unknown) => {
      setItems((prev) => {
        const updated = [...prev];
        (updated[i] as unknown as Record<string, unknown>)[field] = value;
        if (field === "rate" || field === "quantity") {
          const rate = updated[i].rate ?? 0;
          updated[i].amount = rate * updated[i].quantity;
        }
        return updated;
      });
    },
    []
  );

  return {
    items,
    setItems,
    sensors,
    lineItemIds,
    handleDragEnd,
    addItem,
    removeItem,
    updateItem,
  };
}
