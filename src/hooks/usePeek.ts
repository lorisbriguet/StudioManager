import { useCallback, useState } from "react";

/**
 * Which record a page shows in its side peek. `openKey` changes on every open,
 * even of the record already shown, so it goes to `SidePeek`'s `focusKey`:
 * reopening the record while the panel slides out keeps it open and focuses it.
 * `move` shows another record without counting as an open (arrow keys).
 */
export function usePeek() {
  const [peekId, setPeekId] = useState<number | null>(null);
  const [openKey, setOpenKey] = useState(0);
  const open = useCallback((id: number) => {
    setPeekId(id);
    setOpenKey((n) => n + 1);
  }, []);
  const close = useCallback(() => setPeekId(null), []);
  return { peekId, openKey, open, move: setPeekId, close };
}
