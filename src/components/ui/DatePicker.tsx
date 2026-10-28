import { useEffect, useState, type ReactNode } from "react";
import { addMonths, format, getDay, isSameDay, isToday, startOfMonth, subMonths, addDays } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../i18n/useT";
import { formatDisplayDate } from "../../utils/formatDate";
import { IconButton } from "./IconButton";
import { Popover, usePopover } from "./Popover";

/**
 * Calendar and DatePicker. See DESIGN-SYSTEM.md, "Dates".
 *
 *   <DatePicker value={due} onChange={setDue} />            "yyyy-MM-dd" | null
 *   <Calendar selected={d} onSelect={pick} />               month grid, for custom pickers
 *
 * Weeks start on Monday. Month and weekday names follow the app language.
 */

/** "yyyy-MM-dd" (or an ISO timestamp) → local Date at midnight. */
export function parseLocalDate(dateStr: string): Date {
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  return new Date(datePart + "T00:00:00");
}

export const toDateString = (d: Date) => format(d, "yyyy-MM-dd");

function useLocale() {
  const lang = useAppStore((s) => s.language);
  return lang === "FR" ? "fr-CH" : "en-GB";
}

/** Two-letter weekday names, Monday first. */
function weekdayNames(locale: string) {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  // 2024-01-01 is a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const s = fmt.format(new Date(2024, 0, 1 + i)).replace(".", "");
    return s.charAt(0).toUpperCase() + s.slice(1, 2);
  });
}

interface CalendarProps {
  selected?: Date;
  /** Range end; days between selected and selectedEnd are tinted. */
  selectedEnd?: Date;
  onSelect: (day: Date) => void;
  /** Controlled month (any day in it). Uncontrolled when omitted. */
  month?: Date;
  onMonthChange?: (month: Date) => void;
}

export function Calendar({ selected, selectedEnd, onSelect, month: monthProp, onMonthChange }: CalendarProps) {
  const t = useT();
  const locale = useLocale();
  const [own, setOwn] = useState(() => selected ?? new Date());
  const month = monthProp ?? own;
  const setMonth = (m: Date) => {
    if (monthProp === undefined) setOwn(m);
    onMonthChange?.(m);
  };

  const monthStart = startOfMonth(month);
  const startDow = (getDay(monthStart) + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const days: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (days.length % 7 !== 0) days.push(null);

  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <IconButton icon={ChevronLeft} label={t.previous} size="md" onClick={() => setMonth(subMonths(month, 1))} />
        <span className="text-xs font-medium first-letter:uppercase" aria-live="polite">
          {title}
        </span>
        <IconButton icon={ChevronRight} label={t.next} size="md" onClick={() => setMonth(addMonths(month, 1))} />
      </div>
      <div className="grid grid-cols-7 mb-1" aria-hidden="true">
        {weekdayNames(locale).map((d) => (
          <div key={d} className="text-center text-[10px] text-muted font-medium py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="h-8" />;
          const isStart = !!selected && isSameDay(day, selected);
          const isEnd = !!selectedEnd && isSameDay(day, selectedEnd);
          const inRange = !!selected && !!selectedEnd && day > selected && day < selectedEnd;
          const today = isToday(day);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(day)}
              aria-pressed={isStart || isEnd}
              aria-label={new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(day)}
              aria-current={today ? "date" : undefined}
              className={`h-8 w-full text-xs rounded-md transition-colors relative focus-accent ${
                isStart || isEnd
                  ? "bg-accent text-white font-medium"
                  : inRange
                    ? "bg-accent-tint-strong text-accent"
                    : today
                      ? "font-bold text-accent hover:bg-[var(--color-hover-row)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
              }`}
            >
              {day.getDate()}
              {today && !isStart && !isEnd && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Today / Tomorrow shortcut row used at the top of date popovers. */
export function DateShortcuts({ onPick, children }: { onPick: (d: Date) => void; children?: ReactNode }) {
  const t = useT();
  const chip =
    "px-2 py-1 text-xs font-medium rounded-md bg-[var(--color-input-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] focus-accent";
  return (
    <div className="flex gap-1.5 mb-2">
      <button type="button" className={chip} onClick={() => onPick(new Date())}>
        {t.today}
      </button>
      <button type="button" className={chip} onClick={() => onPick(addDays(new Date(), 1))}>
        {t.tomorrow}
      </button>
      {children}
    </div>
  );
}

interface DatePickerProps {
  /** "yyyy-MM-dd", or null for no date. */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Show the clear action. Default true. */
  clearable?: boolean;
  size?: "sm" | "md";
  fullWidth?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
}

const TRIGGER = {
  sm: "gap-1.5 rounded-md px-2.5 py-1 text-xs",
  md: "gap-2 rounded-lg px-3 py-2 text-sm",
};

export function DatePicker({
  value,
  onChange,
  placeholder,
  clearable = true,
  size = "md",
  fullWidth = true,
  disabled,
  id,
  className = "",
  ...aria
}: DatePickerProps) {
  const t = useT();
  const pop = usePopover();
  const selected = value ? parseLocalDate(value) : undefined;
  const [month, setMonth] = useState(() => selected ?? new Date());
  useEffect(() => {
    if (value) setMonth(parseLocalDate(value));
  }, [value]);

  const pick = (d: Date) => {
    onChange(toDateString(d));
    pop.close();
  };

  return (
    <>
      <button
        {...pop.triggerProps}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={aria["aria-label"]}
        aria-invalid={aria["aria-invalid"]}
        aria-describedby={aria["aria-describedby"]}
        className={`inline-flex items-center text-left border border-[var(--color-input-border)] bg-[var(--color-input-bg)] focus-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          TRIGGER[size]
        } ${fullWidth ? "w-full" : ""} ${className}`}
      >
        <CalendarIcon size={size === "sm" ? 12 : 14} className="shrink-0 text-muted" aria-hidden="true" />
        <span className={`flex-1 truncate ${value ? "" : "text-muted"}`}>
          {value ? formatDisplayDate(value) : (placeholder ?? t.no_date)}
        </span>
      </button>
      {pop.open && (
        <Popover anchor={pop.anchorRef} onClose={pop.close} padding="content" className="w-[280px]" role="dialog" aria-label={aria["aria-label"] ?? t.no_date}>
          <DateShortcuts onPick={pick} />
          <Calendar selected={selected} onSelect={pick} month={month} onMonthChange={setMonth} />
          {clearable && value && (
            <div className="border-t border-[var(--color-border-divider)] mt-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  pop.close();
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 py-1 text-xs text-[var(--color-danger-text)] hover:underline focus-accent rounded-md"
              >
                <X size={12} aria-hidden="true" />
                {t.clear_date}
              </button>
            </div>
          )}
        </Popover>
      )}
    </>
  );
}
