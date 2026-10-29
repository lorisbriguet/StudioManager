import { createContext, useContext, type KeyboardEvent, type ReactNode } from "react";
import { IconButton } from "./IconButton";
import { MUTED_INTERACTIVE } from "./tokens";
import { ICONS, ICON_SIZE, renderIcon, type IconProp } from "./icons";

/**
 * One tab, as in the app's tab bar: an accent underline on the active tab,
 * a close button on hover. Used by every tab row in the app so they all
 * look the same. A non-interactive container holds two sibling buttons
 * (activate, close): a button inside a button is invalid.
 *
 * As ARIA tabs, inside a TabList (below): give each tab `id` and `controls`
 * (its panel's id), and the panel `role="tabpanel" id aria-labelledby={tab id}`.
 * TabList then makes the row one Tab stop (the active tab) and moves with
 * Left/Right/Home/End, activating as it goes.
 *
 *   const ids = tabIds(useId(), key);   // { tab, panel }
 *   <TabList label={t.upkeep}>
 *     <TabItem role="tab" id={ids.tab} controls={ids.panel} … />
 *   </TabList>
 *   <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} tabIndex={0}>…</div>
 */
type TabItemProps = {
  label: string;
  active: boolean;
  onActivate: () => void;
  pinned?: boolean;
  /** A lucide component (drawn at 14px) or an element. */
  icon?: IconProp;
  /** "tab" inside a role="tablist"; the app's page tabs are links to pages. */
  role?: "tab";
  /** The tab button's id, for its panel's aria-labelledby. */
  id?: string;
  /** The id of the tabpanel this tab shows (aria-controls). */
  controls?: string;
} & (
  /** Omit both for tabs that can't be closed. */
  | { onClose?: undefined; closeLabel?: undefined }
  /** Closable (middle-click closes too); the close button needs a name. */
  | { onClose: () => void; closeLabel: string }
);

/** The ids that wire a tab to its panel: `${base}-tab-${key}` and `${base}-panel-${key}`. */
export function tabIds(base: string, key: string): { tab: string; panel: string } {
  return { tab: `${base}-tab-${key}`, panel: `${base}-panel-${key}` };
}

/** Set by TabList: its tabs use a roving tabindex (only the active one is a Tab stop). */
const RovingTabs = createContext(false);

/** Left/Right/Home/End across the row's tabs: focus the next one and activate it. */
function onTabListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const current = tabs.findIndex((tab) => tab === e.target);
  if (current < 0 || tabs.length === 0) return;
  const last = tabs.length - 1;
  const next =
    e.key === "ArrowRight" ? (current === last ? 0 : current + 1)
    : e.key === "ArrowLeft" ? (current === 0 ? last : current - 1)
    : e.key === "Home" ? 0
    : e.key === "End" ? last
    : -1;
  if (next < 0) return;
  e.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

/** A row of `role="tab"` TabItems: the tablist role, its name, and the keyboard pattern. */
export function TabList({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="tablist" aria-label={label} onKeyDown={onTabListKeyDown} className={className}>
      <RovingTabs.Provider value={true}>{children}</RovingTabs.Provider>
    </div>
  );
}

export function TabItem({ label, active, onActivate, onClose, closeLabel, pinned = false, icon, role, id, controls }: TabItemProps) {
  const roving = useContext(RovingTabs) && role === "tab";
  return (
    <div
      onAuxClick={(e) => {
        if (e.button === 1 && onClose) {
          e.preventDefault();
          onClose();
        }
      }}
      className={`flex items-center gap-1.5 px-3.5 py-2 text-sm shrink-0 border-b-2 transition-colors group select-none ${
        active
          ? "border-accent text-[var(--color-text)] font-medium"
          : `border-transparent ${MUTED_INTERACTIVE}`
      }`}
    >
      <button
        type="button"
        onClick={onActivate}
        role={role}
        id={id}
        aria-controls={controls}
        tabIndex={roving && !active ? -1 : undefined}
        aria-selected={role === "tab" ? active : undefined}
        aria-current={role === "tab" ? undefined : active ? "page" : undefined}
        className="flex items-center gap-1.5 cursor-pointer min-w-0 rounded focus-accent"
      >
        {pinned && <ICONS.pin size={ICON_SIZE.pill} className="text-muted shrink-0" />}
        {renderIcon(icon, ICON_SIZE.menu, { className: "shrink-0" })}
        <span className="max-w-[160px] truncate">{label}</span>
      </button>
      {onClose && !pinned && (
        <IconButton
          icon={ICONS.close}
          label={closeLabel}
          size="xs"
          tone="danger"
          reveal
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-0.5"
        />
      )}
    </div>
  );
}
