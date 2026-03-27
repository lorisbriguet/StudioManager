import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ask } from "@tauri-apps/plugin-dialog";
import { useT } from "../i18n/useT";

/**
 * Warns the user when navigating away from a form with unsaved changes.
 * Works with BrowserRouter (no data router required).
 *
 * Intercepts:
 * - In-app link clicks (anchor tags with href starting with /)
 * - Browser back/forward (popstate)
 * - Window close / hard refresh (beforeunload)
 *
 * Set isDirty to false before programmatic navigation (e.g. after save)
 * so the warning does not trigger.
 */
export function useUnsavedChangesWarning(isDirty: boolean) {
  const t = useT();
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const handlingRef = useRef(false);
  const navigate = useNavigate();

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

      e.preventDefault();
      e.stopPropagation();

      if (handlingRef.current) return;
      handlingRef.current = true;

      ask(t.unsaved_changes_message, {
        title: t.unsaved_changes,
        kind: "warning",
        okLabel: t.leave,
        cancelLabel: t.stay,
      }).then((confirmed) => {
        if (confirmed) {
          dirtyRef.current = false;
          navigate(href);
        }
      }).finally(() => {
        handlingRef.current = false;
      });
    };

    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [isDirty, navigate, t]);

  // Intercept browser back/forward
  useEffect(() => {
    if (!isDirty) return;

    const handler = () => {
      if (!dirtyRef.current || handlingRef.current) return;
      handlingRef.current = true;

      // Push the current URL back to cancel the popstate
      window.history.pushState(null, "", window.location.pathname);

      ask(t.unsaved_changes_message, {
        title: t.unsaved_changes,
        kind: "warning",
        okLabel: t.leave,
        cancelLabel: t.stay,
      }).then((confirmed) => {
        if (confirmed) {
          dirtyRef.current = false;
          window.history.back();
        }
      }).finally(() => {
        handlingRef.current = false;
      });
    };

    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [isDirty, t]);

  // Fallback: beforeunload for window close / hard refresh
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}
