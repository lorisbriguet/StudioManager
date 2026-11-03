import type { useT } from "../../i18n/useT";
import type { CheckResult } from "./commands";

type T = ReturnType<typeof useT>;

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function formatAgo(from: string | number, now: number, t: T): string {
  const ms = now - (typeof from === "number" ? from : new Date(from).getTime());
  const min = Math.floor(ms / 60_000);
  if (!(min >= 1)) return t.ago_now;
  if (min < 60) return t.ago_min.replace("{n}", String(min));
  const h = Math.floor(min / 60);
  if (h < 24) return t.ago_hour.replace("{n}", String(h));
  return t.ago_day.replace("{n}", String(Math.floor(h / 24)));
}

/** The short reason shown next to a service: "Unreachable", "Error 502", "Certificate not trusted". */
export function checkReason(result: CheckResult | undefined, t: T): string | null {
  if (!result || result.state === "up") return null;
  if (result.state === "unreachable") return t.net_unreachable;
  if (result.reason === "certificate") return t.net_cert_untrusted;
  const code = /^http_(\d{3})$/.exec(result.reason ?? "")?.[1];
  return code ? t.net_error_code.replace("{code}", code) : t.net_error;
}
