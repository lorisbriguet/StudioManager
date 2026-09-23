import { useEffect, useRef, useState, type ReactNode } from "react";
import { useOrgStore } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { getActiveDb, getInitError } from "../lib/orgs";
import { showFatalDbError, switchDb } from "../db";
import { PageSpinner } from "./ui/Spinner";

const PROD_DB = "studiomanager.db";

/**
 * Test and presentation mode are remembered in localStorage, but the mode
 * databases live in the organisation folder and are disposable — the layout
 * upgrade deletes the ones it finds at the root, and Rust always starts on
 * the production file. A stale flag would then open (and create) an empty
 * mode database inside the organisation. Trust Rust: if it says we are on
 * production, drop the flags and point the connection at production too.
 */
async function reconcileModeFlags(): Promise<void> {
  const { testMode, presentationMode, setTestMode, setPresentationMode } = useAppStore.getState();
  if (!testMode && !presentationMode) return;
  const activeDb = await getActiveDb();
  // "studiomanager_test.db" / "studiomanager_presentation.db" do not end
  // with the production file name, so a real mode is left alone.
  if (!activeDb.endsWith(PROD_DB)) return;
  if (testMode) setTestMode(false);
  if (presentationMode) setPresentationMode(false);
  await switchDb(PROD_DB);
}

/** Blocks the app until the organisation registry is loaded, so no query
 *  can open a database before the active organisation is known. */
export function OrgGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      // Rust never aborts startup any more, so ask it first whether the
      // organisation layout is actually usable. If it is not, the registry
      // is missing and every database call would fail in a confusing way —
      // show the error and stop here instead of loading anything.
      const initError = await getInitError();
      if (initError) {
        showFatalDbError(new Error(initError));
        return;
      }
      await useOrgStore.getState().load();
      await reconcileModeFlags();
      setReady(true);
    })().catch((e) => showFatalDbError(e));
  }, []);

  if (!ready) return <PageSpinner />;
  return <>{children}</>;
}
