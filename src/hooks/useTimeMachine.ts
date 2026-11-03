import { useQuery } from "@tanstack/react-query";
import { timeMachineStatus } from "../lib/network/commands";

/** This Mac's Time Machine, refreshed every 5 minutes while the page is open. A failed read counts as not set up. */
export function useTimeMachine() {
  return useQuery({
    queryKey: ["time-machine"],
    queryFn: () => timeMachineStatus().catch(() => null),
    refetchInterval: 300_000,
    retry: false,
  });
}
