/**
 * Short month names in the app language, January first: chart axes on the
 * Dashboard and Finances ("Jan", "Feb"… / "janv.", "févr."…).
 */
import type { AppLanguage } from "../i18n/ui";

const cache = new Map<AppLanguage, string[]>();

export function shortMonthNames(lang: AppLanguage): string[] {
  let names = cache.get(lang);
  if (!names) {
    const fmt = new Intl.DateTimeFormat(lang === "FR" ? "fr-CH" : "en-GB", { month: "short", timeZone: "UTC" });
    names = Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2024, i, 15))));
    cache.set(lang, names);
  }
  return names;
}
