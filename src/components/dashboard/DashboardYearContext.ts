import { createContext, useContext } from "react";

/**
 * Year selected in the dashboard header. Financial widgets read it instead
 * of hardcoding the current calendar year (the "January cliff").
 */
export const DashboardYearContext = createContext<number>(new Date().getFullYear());

export function useDashboardYear(): number {
  return useContext(DashboardYearContext);
}
