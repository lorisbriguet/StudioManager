import { useQuery } from "@tanstack/react-query";
import { timeMachineStatus } from "../lib/network/commands";
import { qk } from "../db/queryKeys";

/** This Mac's Time Machine, refreshed every 5 minutes while the page is open. A failed read counts as not set up. */
export function useTimeMachine() {
  return useQuery({
    queryKey: qk.system.timeMachine,
    queryFn: () => timeMachineStatus().catch(() => null),
    refetchInterval: 300_000,
    retry: false,
  });
}
