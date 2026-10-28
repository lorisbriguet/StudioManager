import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { addMonths, format, getDay, isSameDay, isToday, isValid, parse, startOfMonth, subMonths, addDays } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore, type DateFormatOption } from "../../stores/app-store";
import { useT } from "../../i18n/useT";
import { IconButton } from "./IconButton";
import { Popover } from "./Popover";
import { Input, type FieldSize } from "./Input";
import { Button } from "./Button";

/**
 * Calendar and DatePicker. See DESIGN-SYSTEM.md, "Dates".
 *
 *   <DatePicker value={due} onChange={setDue} />            "yyyy-MM-dd" | null; type or pick
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
  return (
    <div className="flex gap-1.5 mb-2">
      <Button variant="secondary" onClick={() => onPick(new Date())}>
        {t.today}
      </Button>
      <Button variant="secondary" onClick={() => onPick(addDays(new Date(), 1))}>
        {t.tomorrow}
      </Button>
      {children}
    </div>
  );
}

/**
 * Read a typed date. Tries the app's format (31.10.2026), its loose form
 * (1.2.2026), then ISO (2026-10-31); with `shortYear`, also 1.2.26.
 * Strict: the text must read back exactly, so 31.02.2026 and the half-typed
 * 1.2.202 fail.
 */
export function parseTypedDate(text: string, fmt: DateFormatOption, { shortYear = true } = {}): Date | null {
  const t = text.trim();
  if (!t) return null;
  const loose = fmt.replace("dd", "d").replace("MM", "M");
  const candidates = [fmt, loose, "yyyy-MM-dd"];
  if (shortYear) candidates.push(loose.replace("yyyy", "yy"));
  for (const f of candidates) {
    const d = parse(t, f, new Date(2000, 0, 1));
    if (!isValid(d) || d.getFullYear() < 1900 || d.getFullYear() > 2200) continue;
    // Loose forms accept 1 or 2 digits, so read back with the loose pattern
    if (format(d, f) === t || format(d, f.replace("dd", "d").replace("MM", "M")) === t.replace(/\b0(\d)/g, "$1")) return d;
  }
  return null;
}

interface DatePickerProps {
  /** "yyyy-MM-dd", or null for no date. */
  value: string | null;
  /**
   * Fires as soon as the text is a complete valid date (or is emptied → null),
   * and on a calendar pick. So an Enter handler on the form sees the new value,
   * like a native date field.
   */
  onChange: (value: string | null) => void;
  placeholder?: string;
  size?: FieldSize;
  /** bare: table cells. */
  variant?: "default" | "bare";
  fullWidth?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  name?: string;
  /** On the wrapper (layout: width, margins). */
  className?: string;
  /** On the text field itself (border highlights such as detected values). */
  inputClassName?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  "aria-label"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  "aria-required"?: boolean | "true" | "false";
  "data-testid"?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  size = "sm",
  variant = "default",
  fullWidth = true,
  disabled,
  autoFocus,
  id,
  name,
  className = "",
  inputClassName = "",
  onKeyDown,
  onBlur,
  ...aria
}: DatePickerProps) {
  const t = useT();
  const fmt = useAppStore((st) => st.dateFormat);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const shown = value ? format(parseLocalDate(value), fmt) : "";
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  const selected = value ? parseLocalDate(value) : undefined;
  const [month, setMonth] = useState(() => selected ?? new Date());

  // Follow outside changes (a pick, a reset) unless the text already means that date.
  useEffect(() => {
    setText((cur) => {
      const d = parseTypedDate(cur, fmt);
      const same = (d ? toDateString(d) : null) === (value ?? null);
      return same ? cur : shown;
    });
    if (value) setMonth(parseLocalDate(value));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, fmt]);

  const type = (next: string) => {
    setText(next);
    setInvalid(false);
    if (!next.trim()) {
      if (value !== null) onChange(null);
      return;
    }
    // While typing, only a full-year date commits: "1.2.20" on the way to
    // "1.2.2026" must not save 2020 (table cells save on every change).
    const d = parseTypedDate(next, fmt, { shortYear: false });
    if (d) {
      const iso = toDateString(d);
      if (iso !== value) onChange(iso);
    }
  };

  /** Enter / blur: also accept a two-digit year, then show the date in full. */
  const settle = () => {
    if (!text.trim()) return true;
    const d = parseTypedDate(text, fmt);
    if (!d) return false;
    const iso = toDateString(d);
    if (iso !== value) onChange(iso);
    setText(format(d, fmt));
    return true;
  };

  const pick = (d: Date) => {
    onChange(toDateString(d));
    setText(format(d, fmt));
    setInvalid(false);
    setOpen(false);
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <div ref={wrapRef} className={`relative ${fullWidth ? "w-full" : "inline-block"} ${className}`}>
      <Input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        size={size}
        variant={variant}
        disabled={disabled}
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder ?? fmt.toLowerCase()}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text !== shown) {
            // Undo the typing first; a second Esc reaches the dialog.
            e.preventDefault();
            e.stopPropagation();
            setText(shown);
            setInvalid(false);
            return;
          }
          if (e.key === "ArrowDown" && e.altKey) {
            e.preventDefault();
            setOpen(true);
            return;
          }
          if (e.key === "Enter" && !settle()) setInvalid(true);
          onKeyDown?.(e);
        }}
        onBlur={() => {
          if (!settle()) setInvalid(true);
          onBlur?.();
        }}
        aria-label={aria["aria-label"]}
        aria-invalid={invalid || aria["aria-invalid"] === true || aria["aria-invalid"] === "true" ? true : undefined}
        aria-describedby={aria["aria-describedby"]}
        aria-required={aria["aria-required"]}
        data-testid={aria["data-testid"]}
        className={`pr-8 tabular-nums aria-[invalid=true]:border-danger-text ${inputClassName}`}
      />
      <IconButton
        icon={CalendarIcon}
        label={t.pick_date}
        size={size === "sm" ? "xs" : "sm"}
        iconSize={size === "sm" ? 12 : 14}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="absolute right-1 top-1/2 -translate-y-1/2"
      />
      {open && (
        <Popover
          anchor={wrapRef}
          onClose={(returnFocus) => {
            setOpen(false);
            if (returnFocus) inputRef.current?.focus({ preventScroll: true });
          }}
          padding="content"
          className="w-[280px]"
          role="dialog"
          aria-label={aria["aria-label"] ?? t.pick_date}
        >
          <DateShortcuts onPick={pick} />
          <Calendar selected={selected} onSelect={pick} month={month} onMonthChange={setMonth} />
        </Popover>
      )}
    </div>
  );
}
