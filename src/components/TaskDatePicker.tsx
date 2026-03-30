import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
  format,
  isToday,
  addDays,
  addMonths,
  subMonths,
  startOfMonth,
  isSameDay,
  getDay,
} from "date-fns";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  CalendarRange,
  Bell,
  X,
} from "lucide-react";
import { formatDisplayDate } from "../utils/formatDate";
import { useT } from "../i18n/useT";

/** Parse a date string safely — handles both "yyyy-MM-dd" and full ISO timestamps */
function parseLocalDate(dateStr: string): Date {
  // If it already contains "T", it's a full timestamp — just extract the date part
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  return new Date(datePart + "T00:00:00");
}
import type { ReminderOption } from "../types/task";

interface TaskDatePickerProps {
  dueDate: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  reminder?: ReminderOption | null;
  onChange: (values: {
    due_date?: string | null;
    end_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    reminder?: ReminderOption | null;
  }) => void;
  compact?: boolean;
}

import type { UIKey } from "../i18n/ui";

const REMINDER_KEYS: { value: ReminderOption; labelKey: UIKey }[] = [
  { value: "none", labelKey: "none" },
  { value: "at_time", labelKey: "at_time" },
  { value: "5min", labelKey: "min_5_before" },
  { value: "15min", labelKey: "min_15_before" },
  { value: "30min", labelKey: "min_30_before" },
  { value: "1h", labelKey: "hour_1_before" },
  { value: "1d", labelKey: "day_1_before" },
];

export function TaskDatePicker({
  dueDate,
  endDate,
  startTime,
  endTime,
  reminder,
  onChange,
  compact,
}: TaskDatePickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() =>
    dueDate ? parseLocalDate(dueDate) : new Date()
  );
  const [showEndDate, setShowEndDate] = useState(!!endDate);
  const [showTime, setShowTime] = useState(!!(startTime || endTime));
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedDate = dueDate ? parseLocalDate(dueDate) : undefined;
  const selectedEndDate = endDate ? parseLocalDate(endDate) : undefined;

  // Position popover relative to trigger
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverW = 300;
    let left = rect.right - popoverW;
    if (left < 8) left = 8;
    let top = rect.bottom + 4;
    // If popover would go below viewport, show above
    if (top + 420 > window.innerHeight) {
      top = Math.max(8, rect.top - 420 - 4);
    }
    setPopoverPos({ top, left });
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Sync month when date changes externally
  useEffect(() => {
    if (dueDate) setMonth(parseLocalDate(dueDate));
  }, [dueDate]);

  const handleDayClick = (day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd");
    if (showEndDate && dueDate && !endDate) {
      // Second click sets end date
      if (day >= parseLocalDate(dueDate)) {
        onChange({ end_date: dateStr });
      } else {
        onChange({ due_date: dateStr, end_date: dueDate });
      }
    } else {
      onChange({ due_date: dateStr });
      if (endDate) {
        // Reset end date if new start is after current end
        if (day > parseLocalDate(endDate)) {
          onChange({ due_date: dateStr, end_date: null });
        }
      }
    }
  };

  const handleClear = () => {
    onChange({
      due_date: null,
      end_date: null,
      start_time: null,
      end_time: null,
      reminder: null,
    });
    setShowEndDate(false);
    setShowTime(false);
    setOpen(false);
  };

  const handleToday = () => {
    const today = format(new Date(), "yyyy-MM-dd");
    onChange({ due_date: today });
    setMonth(new Date());
  };

  const handleTomorrow = () => {
    const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
    onChange({ due_date: tomorrow });
    setMonth(addDays(new Date(), 1));
  };

  // Build display label
  let displayLabel: string = t.no_date;
  if (dueDate) {
    displayLabel = formatDisplayDate(dueDate);
    if (endDate) {
      displayLabel += " → " + formatDisplayDate(endDate);
    }
    if (showTime && startTime) {
      displayLabel += " \u2022 " + startTime;
      if (endTime) displayLabel += " → " + endTime;
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 border transition-colors ${
          dueDate
            ? "border-[var(--color-input-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
            : "border-dashed border-[var(--color-input-border)] text-muted hover:border-[var(--color-input-border)] hover:bg-[var(--color-hover-row)]"
        } ${compact ? "px-1.5 py-0.5" : ""}`}
      >
        <Calendar size={compact ? 12 : 14} className="shrink-0" />
        {dueDate && <span className={compact ? "text-[11px]" : ""}>{displayLabel}</span>}
      </button>

      {open && popoverPos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[9999] bg-[var(--color-surface)] border border-[var(--color-border-divider)] rounded-xl shadow-lg p-3 w-[300px]"
          style={{ top: popoverPos.top, left: popoverPos.left }}
        >
          {/* Quick shortcuts */}
          <div className="flex gap-1.5 mb-2">
            <button
              type="button"
              onClick={handleToday}
              className="px-2 py-1 text-[11px] font-medium rounded bg-[var(--color-input-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] "
            >
              {t.today}
            </button>
            <button
              type="button"
              onClick={handleTomorrow}
              className="px-2 py-1 text-[11px] font-medium rounded bg-[var(--color-input-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] "
            >
              {t.tomorrow}
            </button>
          </div>

          {/* Calendar header */}
          <div className="flex items-center justify-between mb-1">
            <button
              type="button"
              onClick={() => setMonth(subMonths(month, 1))}
              className="p-1 text-muted hover:text-[var(--color-text)]"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-medium">{format(month, "MMMM yyyy")}</span>
            <button
              type="button"
              onClick={() => setMonth(addMonths(month, 1))}
              className="p-1 text-muted hover:text-[var(--color-text)]"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Calendar grid */}
          <CalendarGrid
            month={month}
            selected={selectedDate}
            selectedEnd={showEndDate ? selectedEndDate : undefined}
            onDayClick={handleDayClick}
          />

          {/* Divider */}
          <div className="border-t border-[var(--color-input-border)] my-2" />

          {/* End date toggle */}
          <ToggleRow
            icon={<CalendarRange size={14} />}
            label={t.end_date}
            checked={showEndDate}
            onChange={(v) => {
              setShowEndDate(v);
              if (!v) onChange({ end_date: null });
            }}
          />

          {/* Include time toggle */}
          <ToggleRow
            icon={<Clock size={14} />}
            label={t.include_time}
            checked={showTime}
            onChange={(v) => {
              setShowTime(v);
              if (!v) onChange({ start_time: null, end_time: null });
            }}
          />

          {/* Time inputs */}
          {showTime && (
            <div className="flex items-center gap-2 ml-6 mb-2">
              <TimeInput
                value={startTime ?? ""}
                onCommit={(v) => onChange({ start_time: v || null })}
              />
              <span className="text-xs text-muted">→</span>
              <TimeInput
                value={endTime ?? ""}
                onCommit={(v) => onChange({ end_time: v || null })}
              />
            </div>
          )}

          {/* Reminder */}
          <div className="flex items-center gap-2 mb-2">
            <Bell size={14} className="text-muted shrink-0" />
            <span className="text-xs flex-1">{t.reminder}</span>
            <select
              value={reminder ?? "none"}
              onChange={(e) =>
                onChange({
                  reminder: e.target.value === "none" ? null : (e.target.value as ReminderOption),
                })
              }
              className="border border-[var(--color-input-border)] rounded px-2 py-1 text-xs"
            >
              {REMINDER_KEYS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t[opt.labelKey]}
                </option>
              ))}
            </select>
          </div>

          {/* Clear button */}
          <div className="border-t border-[var(--color-input-border)] pt-2">
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 w-full justify-center py-1"
            >
              <X size={14} />
              {t.clear_date}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function ToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 mb-2 cursor-pointer">
      <span className="text-muted shrink-0">{icon}</span>
      <span className="text-xs flex-1">{label}</span>
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-8 h-4.5 rounded-full transition-colors cursor-pointer ${
          checked ? "bg-accent" : "bg-[var(--color-input-bg)]"
        }`}
      >
        <div
          className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </div>
    </label>
  );
}

// Time input with local state — only commits on blur to avoid mid-typing resets
function TimeInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <input
      type="time"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onCommit(local); }}
      className="border border-[var(--color-input-border)] rounded px-2 py-1 text-xs w-24"
    />
  );
}

// Minimal calendar grid built with date-fns (no react-day-picker CSS dependency)
function CalendarGrid({
  month,
  selected,
  selectedEnd,
  onDayClick,
}: {
  month: Date;
  selected?: Date;
  selectedEnd?: Date;
  onDayClick: (day: Date) => void;
}) {
  const monthStart = startOfMonth(month);
  // Monday = 0 for week start
  const startDow = (getDay(monthStart) + 6) % 7; // 0=Mon
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  const days: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(new Date(month.getFullYear(), month.getMonth(), d));
  }
  // Fill remaining cells
  while (days.length % 7 !== 0) days.push(null);

  const isInRange = (day: Date) => {
    if (!selected || !selectedEnd) return false;
    return day > selected && day < selectedEnd;
  };

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div
            key={d}
            className="text-center text-[10px] text-muted font-medium py-1"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          if (!day) {
            return <div key={`empty-${i}`} className="h-8" />;
          }
          const isSelected = selected && isSameDay(day, selected);
          const isSelectedEnd = selectedEnd && isSameDay(day, selectedEnd);
          const inRange = isInRange(day);
          const today = isToday(day);

          return (
            <button
              key={i}
              type="button"
              onClick={() => onDayClick(day)}
              className={`h-8 w-full text-xs rounded-md transition-colors relative ${
                isSelected || isSelectedEnd
                  ? "bg-accent text-white font-medium"
                  : inRange
                  ? "bg-accent/10 text-accent"
                  : today
                  ? "font-bold text-accent"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
              }`}
            >
              {format(day, "d")}
              {today && !isSelected && !isSelectedEnd && (
                <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
