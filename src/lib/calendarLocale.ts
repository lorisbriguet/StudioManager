/**
 * FullCalendar settings that follow the app language (U9): British English or
 * Swiss French, week starting Monday, 24-hour times everywhere.
 */
import type { FormatterInput, LocaleInput } from "@fullcalendar/core";
import enGbLocale from "@fullcalendar/core/locales/en-gb";
import frChLocale from "@fullcalendar/core/locales/fr-ch";
import type { AppLanguage } from "../i18n/ui";

/** The FullCalendar locale for the app language: EN uses en-gb, FR uses fr-ch. */
export function calendarLocale(lang: AppLanguage): LocaleInput {
  return lang === "FR" ? frChLocale : enGbLocale;
}

/** 24-hour times (06:00, 13:30) for slot labels and event times. */
export const CALENDAR_TIME_FORMAT: FormatterInput = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};
