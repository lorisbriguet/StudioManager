import type { MouseEvent, ReactNode } from "react";
import { ICONS, ICON_SIZE } from "./icons";
import { useT } from "../../i18n/useT";
import { useTagColor } from "./tagColor";
import { PILL, PILL_XS } from "./tokens";

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
  /** 20px */
  sm: { box: PILL, x: ICON_SIZE.pill },
  /** 16px: dense rows, table cells */
  xs: { box: PILL_XS, x: ICON_SIZE.pill },
};

export function Tag({ name, color, children, size = "sm", onRemove, onClick, title, className = "" }: TagProps) {
  const t = useT();
  const c = useTagColor(name, color);
  const cls = `${SIZE[size].box} max-w-full ${className}`;
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
          className="shrink-0 -mr-1 w-4 h-4 grid place-items-center rounded-full opacity-60 hover:opacity-100 hover:bg-overlay-hover focus-accent transition"
        >
          <ICONS.close size={SIZE[size].x} />
        </button>
      )}
    </span>
  );
}
