import { useState, useEffect } from "react";
import { format } from "date-fns";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { formatDisplayDate } from "../utils/formatDate";
import { Button, ICONS, ICON_SIZE, Input, Select, Toggle } from "./ui";
import { Calendar, DateShortcuts, parseLocalDate } from "./ui/DatePicker";
import { Popover, usePopover } from "./ui/Popover";
import { useT } from "../i18n/useT";

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
}: TaskDatePickerProps) {
  const t = useT();
  const pop = usePopover();
  const [month, setMonth] = useState(() =>
    dueDate ? parseLocalDate(dueDate) : new Date()
  );
  const [showEndDate, setShowEndDate] = useState(!!endDate);
  const [showTime, setShowTime] = useState(!!(startTime || endTime));

  const selectedDate = dueDate ? parseLocalDate(dueDate) : undefined;
  const selectedEndDate = endDate ? parseLocalDate(endDate) : undefined;

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
    pop.close();
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
      <Button
        {...pop.triggerProps}
        variant="outline"
        icon={ICONS.dateField}
        aria-label={dueDate ? undefined : t.no_date}
        className={dueDate ? "" : "border-dashed text-muted"}
      >
        {dueDate && displayLabel}
      </Button>

      {pop.open && (
        <Popover anchor={pop.anchorRef} onClose={pop.close} align="end" padding="content" className="w-[300px]" aria-label={t.pick_date}>
          <DateShortcuts
            onPick={(d) => {
              onChange({ due_date: format(d, "yyyy-MM-dd") });
              setMonth(d);
            }}
          />

          <Calendar
            month={month}
            onMonthChange={setMonth}
            selected={selectedDate}
            selectedEnd={showEndDate ? selectedEndDate : undefined}
            onSelect={handleDayClick}
          />

          {/* Divider */}
          <div className="border-t border-[var(--color-input-border)] my-2" />

          {/* End date toggle */}
          <ToggleRow
            icon={ICONS.dateRange}
            label={t.end_date}
            checked={showEndDate}
            onChange={(v) => {
              setShowEndDate(v);
              if (!v) onChange({ end_date: null });
            }}
          />

          {/* Include time toggle */}
          <ToggleRow
            icon={ICONS.time}
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
                label={t.start_time}
                value={startTime ?? ""}
                onCommit={(v) => onChange({ start_time: v || null })}
              />
              <ArrowRight size={ICON_SIZE.control} className="text-muted shrink-0" />
              <TimeInput
                label={t.end_time}
                value={endTime ?? ""}
                onCommit={(v) => onChange({ end_time: v || null })}
              />
            </div>
          )}

          {/* Reminder */}
          <div className="flex items-center gap-2 mb-2">
            <ICONS.reminder size={ICON_SIZE.menu} className="text-muted shrink-0" />
            <span className="text-xs flex-1">{t.reminder}</span>
            <Select
              value={reminder ?? "none"}
              aria-label={t.reminder}
              onChange={(e) =>
                onChange({
                  reminder: e.target.value === "none" ? null : (e.target.value as ReminderOption),
                })
              }
              fullWidth={false}
            >
              {REMINDER_KEYS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t[opt.labelKey]}
                </option>
              ))}
            </Select>
          </div>

          {/* Clear button */}
          <div className="border-t border-[var(--color-input-border)] pt-2">
            <Button
              type="button"
              variant="link"
              icon={ICONS.close}
              onClick={handleClear}
              className="w-full justify-center py-1 text-danger-text"
            >
              {t.clear_date}
            </Button>
          </div>
        </Popover>
      )}
    </>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  checked,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon size={ICON_SIZE.menu} className="text-muted shrink-0" />
      <span className="text-xs flex-1">{label}</span>
      <Toggle size="sm" checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

// Time input with local state — only commits on blur to avoid mid-typing resets
function TimeInput({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <Input
      width="sm"
      type="time"
      aria-label={label}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onCommit(local); }}
    />
  );
}
