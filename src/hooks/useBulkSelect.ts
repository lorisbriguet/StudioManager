import { useState, useCallback, useMemo } from "react";

/**
 * Hook for managing multi-select state on list pages.
 * Supports individual toggle, shift+click range select, and select-all.
 */
export function useBulkSelect<T extends { id: number | string }>(items: T[]) {
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<number | string | null>(null);

  const toggleItem = useCallback(
    (id: number | string, shiftKey?: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);

        if (shiftKey && lastClickedId !== null) {
          // Range selection
          const ids = items.map((i) => i.id);
          const fromIdx = ids.indexOf(lastClickedId);
          const toIdx = ids.indexOf(id);
          if (fromIdx !== -1 && toIdx !== -1) {
            const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
            for (let i = start; i <= end; i++) {
              next.add(ids[i]);
            }
          }
        } else {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        return next;
      });
      setLastClickedId(id);
    },
    [items, lastClickedId]
  );

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === items.length) return new Set();
      return new Set(items.map((i) => i.id));
    });
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setLastClickedId(null);
  }, []);

  const isAllSelected = useMemo(
    () => items.length > 0 && selected.size === items.length,
    [items.length, selected.size]
  );

  return {
    selected,
    toggleItem,
    toggleAll,
    clearSelection,
    isAllSelected,
    count: selected.size,
  };
}
