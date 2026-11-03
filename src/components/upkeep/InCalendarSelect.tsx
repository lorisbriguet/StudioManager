import { DropdownSelect, type DropdownOption } from "../ui";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../i18n/useT";

/** Value of the "Not in calendar" row; every other value is a calendar's key. */
const NONE = "none";
/** The organisation's one calendar (Settings › Calendar), until more can be added. */
const ORG_CALENDAR = "org";

/**
 * Where an upkeep item or renewal lives in Apple Calendar: "Not in calendar" or
 * the organisation's calendar by name. The stored value is still the 0/1
 * `in_calendar` flag; the options are a list so more calendars can join later.
 * With no calendar set up, only "Not in calendar" shows, with a hint.
 */
export function InCalendarSelect({
  inCalendar,
  onChange,
  variant,
  fullWidth,
}: {
  inCalendar: boolean;
  onChange: (inCalendar: boolean) => void;
  variant?: "default" | "bare";
  fullWidth?: boolean;
}) {
  const t = useT();
  const calendarName = useAppStore((s) => s.calendarName).trim();
  const options: DropdownOption[] = [{ value: NONE, label: t.upkeep_not_in_calendar }];
  if (calendarName) options.push({ value: ORG_CALENDAR, label: calendarName });
  else options.push({ value: "hint", label: t.upkeep_calendar_setup_hint, disabled: true });
  const value = inCalendar && calendarName ? ORG_CALENDAR : NONE;
  return (
    <DropdownSelect
      aria-label={t.upkeep_in_calendar}
      variant={variant}
      fullWidth={fullWidth}
      options={options}
      value={value}
      onChange={(v) => onChange(v !== NONE)}
    />
  );
}
