import { useQuery } from "@tanstack/react-query";
import * as q from "../queries/finance";
import { qk } from "../queryKeys";

export function usePLData(year: number) {
  return useQuery({
    queryKey: qk.finance.pl(year),
    queryFn: () => q.getPLData(year),
  });
}

export function useMonthlyData(year: number) {
  return useQuery({
    queryKey: qk.finance.monthly(year),
    queryFn: () => q.getMonthlyData(year),
  });
}

export function useDashboardKPIs(year: number) {
  return useQuery({
    queryKey: qk.finance.kpis(year),
    queryFn: () => q.getDashboardKPIs(year),
  });
}

export function useRevenueByActivity(year: number) {
  return useQuery({
    queryKey: qk.finance.revenueByActivity(year),
    queryFn: () => q.getRevenueByActivity(year),
  });
}

export function useRevenueByClient(year: number) {
  return useQuery({
    queryKey: qk.finance.revenueByClient(year),
    queryFn: () => q.getRevenueByClient(year),
  });
}
