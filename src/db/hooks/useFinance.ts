import { useQuery } from "@tanstack/react-query";
import * as q from "../queries/finance";

export function usePLData(year: number) {
  return useQuery({
    queryKey: ["finance", "pl", year],
    queryFn: () => q.getPLData(year),
  });
}

export function useMonthlyData(year: number) {
  return useQuery({
    queryKey: ["finance", "monthly", year],
    queryFn: () => q.getMonthlyData(year),
  });
}

export function useDashboardKPIs(year: number) {
  return useQuery({
    queryKey: ["finance", "dashboard", year],
    queryFn: () => q.getDashboardKPIs(year),
  });
}

export function useRevenueByActivity(year: number) {
  return useQuery({
    queryKey: ["finance", "revenue-by-activity", year],
    queryFn: () => q.getRevenueByActivity(year),
  });
}

export function useRevenueByClient(year: number) {
  return useQuery({
    queryKey: ["finance", "revenue-by-client", year],
    queryFn: () => q.getRevenueByClient(year),
  });
}
