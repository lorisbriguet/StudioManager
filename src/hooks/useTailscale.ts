import { useQuery } from "@tanstack/react-query";
import { tailscaleStatus } from "../lib/network/commands";
import { qk } from "../db/queryKeys";

/** The tailnet from this Mac's Tailscale, refreshed every 5 minutes while the page is open. A failed read counts as not installed. */
export function useTailscale() {
  return useQuery({
    queryKey: qk.system.tailscale,
    queryFn: () => tailscaleStatus().catch(() => null),
    refetchInterval: 300_000,
    retry: false,
  });
}
