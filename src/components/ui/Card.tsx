import type { HTMLAttributes, KeyboardEvent, ReactNode, Ref } from "react";
import { X } from "lucide-react";
import { useT } from "../../i18n/useT";
import { IconButton } from "./IconButton";
import { PanelTitle, type PanelTitleProps } from "./PanelTitle";
import { HEADING_COUNT } from "./tokens";

/**
 * Card — the block surface. See DESIGN-SYSTEM.md, "Card".
 *
 *   <Card>…</Card>                                   16px padding, surface fill
 *   <Card tone="inset" padding="sm">…</Card>         a card inside a card: 1px divider border, 12px
 *   <Card tone="dashed" padding="sm">…</Card>        an add / draft box
 *   <Card interactive selected={open} onClick={…}>   a clickable card (Enter / Space too)
 *
 *   <Card>
 *     <Card.Header title={t.contacts} count={contacts.length} variant="label" action={<Button …/>} />
 *     …
 *   </Card>
 */

export type CardPadding = "none" | "sm" | "md";
export type CardTone = "surface" | "inset" | "dashed";

const PADDING: Record<CardPadding, string> = { none: "", sm: "p-3", md: "p-4" };

const TONE: Record<CardTone, string> = {
  surface: "bg-[var(--color-surface)]",
  inset: "bg-[var(--color-surface)] border border-[var(--color-border-divider)]",
  dashed: "border border-dashed border-[var(--color-input-border)]",
};

const INTERACTIVE = "cursor-pointer transition-colors hover:bg-[var(--color-hover-row)] focus-accent";
const SELECTED = "bg-[var(--color-hover-row)] outline outline-1 outline-accent";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  /** md 16px (default), sm 12px (nested and compact cards), none (the content pads itself). */
  padding?: CardPadding;
  /** surface (default), inset (a card inside a card), dashed (an add or draft box). */
  tone?: CardTone;
  /** Hover tint, pointer and focus ring. A div gets role="button", tabIndex 0 and Enter / Space. */
  interactive?: boolean;
  /** The accent outline of the selected / open card. */
  selected?: boolean;
  /** The element: `section` / `article` when the card is a landmark, `button` for a card that is one action. */
  as?: "div" | "section" | "article" | "li" | "button";
  ref?: Ref<HTMLDivElement>;
}

/** The class string of a card, for elements that can't be a Card (a dnd-kit node, a <label>). */
export function cardClass({
  padding = "md",
  tone = "surface",
  interactive = false,
  selected = false,
}: Pick<CardProps, "padding" | "tone" | "interactive" | "selected"> = {}): string {
  return [
    "rounded-xl",
    selected ? SELECTED : TONE[tone],
    PADDING[padding],
    interactive ? INTERACTIVE : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Block surface. Other props (onClick, onContextMenu, style, ref, aria-*) pass through. */
export function Card({
  children,
  className = "",
  padding = "md",
  tone = "surface",
  interactive = false,
  selected = false,
  as = "div",
  ...props
}: CardProps) {
  // Typed as "div" so the props and ref type-check; the other tags take the same ones.
  const Tag = as as "div";
  const extra: HTMLAttributes<HTMLDivElement> & { type?: "button" } = {};
  if (as === "button") {
    extra.type = "button";
  } else if (interactive && props.onClick) {
    extra.role = "button";
    extra.tabIndex = 0;
    extra.onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      props.onKeyDown?.(e);
      if (e.defaultPrevented || e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        // Handled here: a page-level list shortcut (useListNavigation) must not act on it too.
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.click();
      }
    };
  }
  return (
    <Tag
      {...extra}
      {...props}
      onKeyDown={extra.onKeyDown ?? props.onKeyDown}
      className={`${cardClass({ padding, tone, interactive, selected })} ${className}`}
    >
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  title: ReactNode;
  /** A count after the title, muted ("Contacts 3"). */
  count?: number;
  /** One muted line under the title. */
  subtitle?: ReactNode;
  /** Leading content: an icon, a drag handle, a collapse chevron. */
  icon?: ReactNode;
  /** Right-aligned controls (several are fine). */
  action?: ReactNode;
  /** Adds the close IconButton after `action`. */
  onClose?: () => void;
  /** title: the level-2 title (14px). label: the 10px uppercase SectionLabel. */
  variant?: "title" | "label";
  /** A rule under the header, like SettingsCard. */
  divider?: boolean;
  tone?: PanelTitleProps["tone"];
  as?: PanelTitleProps["as"];
  id?: string;
  /** Classes on the header; they replace the default 12px bottom margin (`mb-3`). */
  className?: string;
}

/** The card's title row: icon, title, count, then the action and close button on the right. */
function CardHeader({
  title,
  count,
  subtitle,
  icon,
  action,
  onClose,
  variant = "title",
  divider = false,
  tone,
  as = "h2",
  id,
  className = "mb-3",
}: CardHeaderProps) {
  const t = useT();
  const heading = (
    <>
      {title}
      {count != null && <span className={HEADING_COUNT}>{count}</span>}
    </>
  );
  const actions =
    onClose || (action != null && action !== false) ? (
      <>
        {action}
        {onClose && <IconButton icon={X} label={t.close} onClick={onClose} />}
      </>
    ) : undefined;
  const row = <PanelTitle title={heading} action={actions} variant={variant} tone={tone} as={as} id={id} className="flex-1 min-w-0" />;
  return (
    <div className={`${divider ? "border-b border-[var(--color-border-divider)] pb-2" : ""} ${className}`}>
      {icon != null && icon !== false ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 shrink-0">{icon}</span>
          {row}
        </div>
      ) : (
        row
      )}
      {subtitle != null && subtitle !== false && <p className="text-xs text-muted mt-1">{subtitle}</p>}
    </div>
  );
}

Card.Header = CardHeader;
