import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { confirmIfDirty, isConfirming, registerDirtyGuard } from "../lib/dirty-guard";

/**
 * Warns the user when navigating away from a form with unsaved changes.
 * Works with BrowserRouter (no data router required).
 *
 * Intercepts:
 * - In-app link clicks (anchor tags with href starting with /)
 * - Browser back/forward (popstate)
 * - Window close / hard refresh (beforeunload)
 * - Programmatic navigations (tab shortcuts, tab bar, command palette,
 *   sidebar keyboard nav) via the central dirty-guard registry — those
 *   sites await confirmIfDirty() before navigating.
 *
 * The confirmation dialog itself lives in confirmIfDirty (lib/dirty-guard),
 * which also handles the dirty check, re-entrancy, and marking the form
 * clean on confirm. This hook only intercepts the events and delegates.
 *
 * Set isDirty to false before programmatic navigation (e.g. after save)
 * so the warning does not trigger.
 */
export function useUnsavedChangesWarning(isDirty: boolean) {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const navigate = useNavigate();

  // Register with the central registry so programmatic navigation sites
  // can prompt before discarding this form.
  useEffect(() => {
    return registerDirtyGuard(
      () => dirtyRef.current,
      () => {
        dirtyRef.current = false;
      }
    );
  }, []);

  // Intercept in-app link clicks
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      // Don't intercept if modifier keys (open in new tab, etc.)
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      // Already marked clean (e.g. just confirmed via another interceptor)
      if (!dirtyRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      void confirmIfDirty(href).then((ok) => {
        if (ok) navigate(href);
      });
    };

    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [isDirty, navigate]);

  // Intercept browser back/forward
  useEffect(() => {
    if (!isDirty) return;

    const handler = () => {
      // Skip when already clean, or while a confirmation dialog is open —
      // never revert the history or stack a second dialog mid-confirm.
      if (!dirtyRef.current || isConfirming()) return;

      // Push the current URL back to cancel the popstate
      window.history.pushState(null, "", window.location.pathname);

      void confirmIfDirty().then((confirmed) => {
        if (confirmed) window.history.back();
      });
    };

    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [isDirty]);

  // Fallback: beforeunload for window close / hard refresh.
  // Stays hand-rolled: the API is synchronous, so confirmIfDirty cannot be
  // awaited here — the browser shows its own native prompt instead.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}
