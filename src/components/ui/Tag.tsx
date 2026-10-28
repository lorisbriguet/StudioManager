import type { MouseEvent, ReactNode } from "react";
import { X } from "lucide-react";
import { getStoredTagColor, getTagColor } from "../../lib/tagColors";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../i18n/useT";

/**
 * Tag — a coloured pill for user tags and list options. See DESIGN-SYSTEM.md, "Tags".
 *
 *   <Tag name="typography" />                         colour from the name (hash)
 *   <Tag name={opt.value} color={opt.color} />        stored colour name (workload, custom lists)
 *   <Tag name={tag} onRemove={() => remove(tag)} />   with a × button
 *   <Tag name={tag} size="xs" />                      dense rows
 *
 * Reads dark mode itself; callers never pass it.
 */
export interface TagProps {
  /** Tag text; also picks the colour unless `color` is given. */
  name: string;
  /** Stored colour name ("blue", "purple", legacy "pink"…). */
  color?: string | null;
  /** Shown instead of `name` (e.g. a translated label). */
  children?: ReactNode;
  size?: "sm" | "xs";
  onRemove?: () => void;
  /** Makes the whole tag a button. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  className?: string;
}

const SIZE = {
  sm: { box: "text-xs px-2 py-0.5 gap-1", x: 10 },
  xs: { box: "text-[10px] px-1.5 py-0.5 gap-0.5", x: 10 },
};

export function Tag({ name, color, children, size = "sm", onRemove, onClick, title, className = "" }: TagProps) {
  const dark = useAppStore((s) => s.darkMode);
  const t = useT();
  const c = color !== undefined ? getStoredTagColor(color, dark) : getTagColor(name, dark);
  const cls = `inline-flex items-center rounded-full font-medium whitespace-nowrap max-w-full ${SIZE[size].box} ${className}`;
  const style = { background: c.bg, color: c.text };
  const label = <span className="truncate">{children ?? name}</span>;

  if (onClick && !onRemove) {
    return (
      <button type="button" onClick={onClick} title={title} style={style} className={`${cls} focus-accent hover:opacity-80 transition-opacity`}>
        {label}
      </button>
    );
  }
  return (
    <span title={title} style={style} className={cls}>
      {onClick ? (
        <button type="button" onClick={onClick} className="truncate focus-accent rounded-full">
          {children ?? name}
        </button>
      ) : (
        label
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`${t.remove_tag} ${name}`}
          title={`${t.remove_tag} ${name}`}
          className="shrink-0 -mr-0.5 rounded-full opacity-60 hover:opacity-100 focus-accent transition-opacity"
        >
          <X size={SIZE[size].x} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
