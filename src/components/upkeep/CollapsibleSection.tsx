import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "../../i18n/useT";
import { useOrgStore } from "../../stores/org-store";

const PREFIX = "upkeep-collapsed:";

function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/**
 * A section with a chevron header, same affordance as the project blocks
 * (ChevronDown open, ChevronRight closed). The state is remembered per `id`.
 */
export function CollapsibleSection({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const storageKey = useOrgStore((s) => s.orgKey(PREFIX + id));
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey));

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      /* storage unavailable: the section still toggles for this session */
    }
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? t.expand : t.collapse}: ${title}`}
          className="flex items-center gap-1.5 text-muted hover:text-[var(--color-text-secondary)] transition-colors"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="text-xs font-semibold tracking-tight">{title}</span>
        </button>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {!collapsed && children}
    </section>
  );
}
