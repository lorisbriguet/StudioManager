import { useEffect, type ReactNode } from "react";
import { useOrgStore } from "../stores/org-store";
import { showFatalDbError } from "../db";
import { PageSpinner } from "./ui/Spinner";

/** Blocks the app until the organisation registry is loaded, so no query
 *  can open a database before the active organisation is known. */
export function OrgGate({ children }: { children: ReactNode }) {
  const loaded = useOrgStore((s) => s.loaded);
  useEffect(() => {
    if (loaded) return;
    useOrgStore.getState().load().catch((e) => showFatalDbError(e));
  }, [loaded]);
  if (!loaded) return <PageSpinner />;
  return <>{children}</>;
}
