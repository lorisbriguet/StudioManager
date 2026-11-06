/**
 * What "new item" means on each page. Cmd+N (GlobalShortcuts) and the
 * command palette's New actions both read this map, so they stay in step.
 */
export type NewEntity =
  /** The page's new item has its own route (invoice and quote forms). */
  | { kind: "route"; to: string }
  /** The page opens its own form: it listens with useNewItem(path, open). */
  | { kind: "form"; path: string }
  /** The global New task form, with the project preselected when known. */
  | { kind: "task"; projectId: number | null };

const ROUTES: Record<string, string> = {
  "/invoices": "/invoices/new",
  "/quotes": "/quotes/new",
};

const FORM_PAGES = ["/clients", "/projects", "/expenses", "/income", "/wiki"];

export function newEntityFor(pathname: string): NewEntity | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (ROUTES[path]) return { kind: "route", to: ROUTES[path] };
  if (FORM_PAGES.includes(path)) return { kind: "form", path };
  if (path === "/tasks") return { kind: "task", projectId: null };
  const project = path.match(/^\/projects\/(\d+)$/);
  if (project) return { kind: "task", projectId: Number(project[1]) };
  return null;
}

export const NEW_ITEM_EVENT = "sm:new-item";

/** The page whose form should open, until that page has opened it. */
let pending: string | null = null;

/**
 * Ask the page at `path` to open its new-item form. It opens right away when
 * the page is shown, or as soon as it mounts (the palette navigates first).
 */
export function requestNewItem(path: string) {
  pending = path;
  window.dispatchEvent(new CustomEvent(NEW_ITEM_EVENT));
}

/** True once for the page a request was made for. */
export function takeNewItemRequest(path: string): boolean {
  if (pending !== path) return false;
  pending = null;
  return true;
}
