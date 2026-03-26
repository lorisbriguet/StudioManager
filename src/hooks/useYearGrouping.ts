import { useState, useMemo } from "react";

/**
 * Shared hook for year-based grouping with collapsible sections.
 * Used by InvoicesPage, ExpensesPage, IncomePage.
 */
export function useYearGrouping<T>(
  items: T[],
  getDateStr: (item: T) => string | null | undefined
) {
  const currentYear = new Date().getFullYear();
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set([currentYear]));

  const groupedByYear = useMemo(() => {
    const groups = new Map<number, T[]>();
    for (const item of items) {
      const dateStr = getDateStr(item);
      const year = dateStr ? parseInt(dateStr.substring(0, 4)) : currentYear;
      const arr = groups.get(year) ?? [];
      arr.push(item);
      groups.set(year, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b - a);
  }, [items, getDateStr, currentYear]);

  const toggleYear = (year: number) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      next.has(year) ? next.delete(year) : next.add(year);
      return next;
    });
  };

  return { currentYear, expandedYears, groupedByYear, toggleYear };
}
