/**
 * An activity whose FR and EN names are identical prints the same (usually
 * French) text on English-language invoices — flag it wherever it matters:
 * the activities editor and the invoice form for EN clients.
 */
export function isUntranslatedActivity(a: { name_fr: string; name_en: string }): boolean {
  const fr = a.name_fr.trim();
  return fr !== "" && fr === a.name_en.trim();
}
