import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button, Callout } from "../ui";
import { useT } from "../../i18n/useT";
import { plural } from "../../i18n/plural";
import { useAppStore } from "../../stores/app-store";
import { logError } from "../../lib/log";
import { AGENTS_LOGIN, checkLogin, getLoginStatus, type LoginStatus } from "../../lib/agents";

const DAY_MS = 86_400_000;
/** The warning shows from this many days out. */
export const WARN_DAYS = 10;

export type LoginState =
  | { kind: "none" }
  | { kind: "ok"; expiresAt: number }
  | { kind: "soon"; expiresAt: number; daysLeft: number }
  | { kind: "ended"; expiresAt: number }
  | { kind: "signed-out" };

/** What to show for a status. Days left are rounded up, like the notifications (login.rs). */
export function loginState(status: LoginStatus | null, now: number): LoginState {
  if (!status) return { kind: "none" };
  if (!status.loggedIn) return { kind: "signed-out" };
  const expiresAt = status.expiresAt;
  // An env token or an API key: no date to show.
  if (expiresAt == null) return { kind: "none" };
  if (expiresAt <= now) return { kind: "ended", expiresAt };
  const daysLeft = Math.ceil((expiresAt - now) / DAY_MS);
  return daysLeft <= WARN_DAYS ? { kind: "soon", expiresAt, daysLeft } : { kind: "ok", expiresAt };
}

/** The last sign-in check, then every `agents:login` event. */
export function useLoginStatus(): [LoginStatus | null, (s: LoginStatus | null) => void] {
  const [status, setStatus] = useState<LoginStatus | null>(null);
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | null = null;
    getLoginStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus(null));
    listen<LoginStatus | null>(AGENTS_LOGIN, (e) => {
      if (alive) setStatus(e.payload);
    }).then((u) => {
      if (alive) unlisten = u;
      else u();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  return [status, setStatus];
}

/** "8 Nov", with the year when it isn't this year. */
function dateText(epochMs: number, locale: string, now: number): string {
  const d = new Date(epochMs);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

/**
 * When the Claude sign-in ends, on the Agents page and the menu bar Agents tab. More than
 * 10 days out, a muted line (the page only, `quiet`); from 10 days, a warning; once it has
 * ended or Claude is signed out, a danger callout. Nothing for a sign-in without a date.
 */
export function LoginNotice({ quiet = false, className = "" }: { quiet?: boolean; className?: string }) {
  const t = useT();
  const locale = useAppStore((s) => (s.language === "FR" ? "fr" : "en"));
  const [status, setStatus] = useLoginStatus();
  const [checking, setChecking] = useState(false);
  const now = Date.now();
  const state = loginState(status, now);

  if (state.kind === "none") return null;
  if (state.kind === "ok") {
    if (!quiet) return null;
    return (
      <p className={`text-xs text-muted ${className}`}>
        {t.agents_login_until.replace("{date}", dateText(state.expiresAt, locale, now))}
      </p>
    );
  }

  const check = () => {
    setChecking(true);
    checkLogin()
      .then(setStatus)
      .catch((e) => void logError("Agents: sign-in check failed:", e))
      .finally(() => setChecking(false));
  };
  const action = (
    <Button variant="outline" loading={checking} onClick={check}>
      {t.agents_login_check}
    </Button>
  );
  const message =
    state.kind === "soon"
      ? plural(state.daysLeft, t.agents_login_ends_one, t.agents_login_ends_other).replace(
          "{date}",
          dateText(state.expiresAt, locale, now),
        )
      : state.kind === "ended"
        ? t.agents_login_ended.replace("{date}", dateText(state.expiresAt, locale, now))
        : t.agents_login_signed_out;
  return (
    <Callout tone={state.kind === "soon" ? "warning" : "danger"} action={action} className={className}>
      {message}
    </Callout>
  );
}
