import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAppStore } from "../stores/app-store";
import { newEntityFor, requestNewItem } from "../lib/newEntity";

/** True while the user is typing somewhere Cmd+B could mean formatting. */
function inTypingContext(e: KeyboardEvent): boolean {
  const target = e.target;
  return (
    target instanceof HTMLElement &&
    !!target.closest('input, textarea, [contenteditable="true"]')
  );
}

/**
 * Context-sensitive Cmd+N (audit item 343), Cmd+B sidebar toggle (351), and
 * Cmd+Shift+O organisation switcher (Task 16).
 * Must render inside the Router.
 */
export function GlobalShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;

      if (e.shiftKey && (e.key === "o" || e.key === "O") && !inTypingContext(e)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("sm:open-org-switcher"));
        return;
      }
      if (e.shiftKey) return;

      if ((e.key === "b" || e.key === "B") && !inTypingContext(e)) {
        e.preventDefault();
        useAppStore.getState().toggleSidebar();
        return;
      }

      if (e.key !== "n" && e.key !== "N") return;
      const entity = newEntityFor(location.pathname);
      if (!entity) return;
      e.preventDefault();
      if (entity.kind === "route") navigate(entity.to);
      else if (entity.kind === "form") requestNewItem(entity.path);
      else useAppStore.getState().openNewTask(entity.projectId);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, location.pathname]);

  return null;
}
