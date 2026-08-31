import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

/** Pages whose "new item" is a route. */
const NEW_ROUTES: Record<string, string> = {
  "/invoices": "/invoices/new",
  "/quotes": "/quotes/new",
};

/** Pages whose "new item" is an inline form — they listen for this event. */
const NEW_EVENT_PAGES = ["/expenses", "/income"];

/**
 * Context-sensitive Cmd+N (audit item 343): creates the item for the page
 * you are on. Must render inside the Router.
 */
export function GlobalShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== "n" && e.key !== "N") return;

      const path = location.pathname;
      if (NEW_ROUTES[path]) {
        e.preventDefault();
        navigate(NEW_ROUTES[path]);
      } else if (NEW_EVENT_PAGES.includes(path)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("sm:new-item"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, location.pathname]);

  return null;
}
