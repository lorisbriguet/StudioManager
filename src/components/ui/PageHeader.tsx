import type { ReactNode } from "react";
import { ICONS } from "./icons";
import { useT } from "../../i18n/useT";
import { IconButton } from "./IconButton";
import { HEADING_1, HEADING_2 } from "./tokens";

/**
 * PageHeader — every page's title row. See DESIGN-SYSTEM.md, "Typography".
 *
 *   <PageHeader title={t.clients}><Button …>{t.new_client}</Button></PageHeader>
 *   <PageHeader title={client.name} back={() => navigate(-1)} actions={…} />
 *   <PageHeader title={calTitle} leading={<>‹ › Today</>} actions={<SegmentedControl …/>} />
 *   <PageHeader title={`${ref} — ${client}`} back={…} compact actions={…} />   preview bar
 *   <PageHeader as="h2" title={project.name} meta={clientLink} />             peek panel
 *
 * The title is the page's one h1 at level 1 (20px). `compact` keeps the h1 but
 * at level 2 (14px) in a full-bleed bar (preview pages). `as="h2"` is for a
 * page shown inside another page (peek panels): a level-2 h2.
 */
interface PageHeaderProps {
  title: ReactNode;
  /** Shows one back button before the title. Put an unsaved-changes check in the callback. */
  back?: () => void;
  /** A muted line under the title (client link, unread count). */
  meta?: ReactNode;
  /** Content before the title (calendar arrows and Today). */
  leading?: ReactNode;
  /** Right-aligned content. `children` works the same. */
  actions?: ReactNode;
  children?: ReactNode;
  /** A level-2 title in a full-bleed bar with a bottom border (preview pages). */
  compact?: boolean;
  /** "h2" for a page nested in another (peek panels): a level-2 h2. */
  as?: "h1" | "h2";
  className?: string;
}

export function PageHeader({ title, back, meta, leading, actions, children, compact, as: Tag = "h1", className = "" }: PageHeaderProps) {
  const t = useT();
  const right = actions ?? children;
  const level2 = compact || Tag === "h2";
  const frame = compact
    ? "shrink-0 px-6 py-3 border-b border-[var(--color-border-divider)] bg-[var(--color-surface)]"
    : Tag === "h2"
      ? "mb-4"
      : "mb-6";
  return (
    <div className={`flex items-center gap-3 ${frame} ${className}`}>
      {back && <IconButton icon={ICONS.back} label={t.back} onClick={back} />}
      {leading}
      <div className="min-w-0 flex-1">
        <Tag className={`${level2 ? HEADING_2 : HEADING_1} truncate`}>{title}</Tag>
        {meta != null && meta !== false && <div className="text-xs text-muted mt-0.5 truncate">{meta}</div>}
      </div>
      {right != null && right !== false && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}
