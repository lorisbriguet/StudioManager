import type { ReactNode } from "react";
import { SectionLabel } from "./SectionLabel";
import { STAT_VALUE } from "./tokens";

/**
 * StatTile — one number with its label: the SectionLabel, the value (20px
 * semibold, equal-width digits) and an optional muted caption. See DESIGN-SYSTEM.md.
 *
 *   <StatTile label={t.profit_margin} value={`${margin}%`} tone="success" caption={…} />
 *
 * It sets no padding: inside a Card it takes the card's padding; the dashboard
 * KPI widgets pass `className="h-full justify-center p-4"`.
 */

const TONE = {
  default: "",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** A muted line under the value (a comparison, a unit). */
  caption?: ReactNode;
  tone?: keyof typeof TONE;
  className?: string;
}

export function StatTile({ label, value, caption, tone = "default", className = "" }: StatTileProps) {
  return (
    <div className={`flex flex-col min-w-0 ${className}`}>
      <SectionLabel className="mb-1">{label}</SectionLabel>
      <div className={`${STAT_VALUE} truncate ${TONE[tone]}`}>{value}</div>
      {caption != null && caption !== false && <div className="text-xs text-muted mt-1 truncate">{caption}</div>}
    </div>
  );
}
