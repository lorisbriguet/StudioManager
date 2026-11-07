import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { getLabels, notify } from "../lib/notify";
import { plural } from "../i18n/plural";
import { noticeKeys } from "../lib/notificationText";
import { useQueryClient } from "@tanstack/react-query";
import { markOverdueInvoices } from "../db/queries/invoices";
import { qk, invalidateMoney } from "../db/queryKeys";
import { createNotification } from "../db/queries/notifications";
import { logError } from "../lib/log";
import { sendNativeNotification } from "../lib/nativeNotification";
import { useOrgStore } from "../stores/org-store";
import { todayLocalISO } from "../utils/localDate";

function runOverdueCheck(qc: QueryClient) {
  const org = useOrgStore.getState().activeId;

  markOverdueInvoices().then(async (overdue) => {
    // A switch may have landed while the query ran: the notification below
    // would be written into the organisation we just moved to, about
    // invoices belonging to the one we left.
    if (useOrgStore.getState().activeId !== org) return;
    if (overdue.length > 0) {
      qc.invalidateQueries({ queryKey: qk.invoices.all });
      invalidateMoney(qc);

      const t = getLabels();
      const title = plural(overdue.length, t.overdue_marked_one, t.overdue_marked_other);
      const refs = overdue.map((i) => i.reference).join(", ");

      notify.warning(title, { description: refs });

      await createNotification({
        type: "overdue",
        title,
        message: refs,
        read: 0,
        link: "/invoices",
        // English and French agree on the plural form from 1 up.
        ...noticeKeys(overdue.length === 1 ? "overdue_marked_one" : "overdue_marked_other", null, { count: overdue.length }),
      });

      qc.invalidateQueries({ queryKey: qk.notifications.all });

      sendNativeNotification(title, refs);
    }
  }).catch((e) => {
    logError("Overdue check failed:", e);
  });
}

/** Milliseconds from now to one second past the next local midnight. */
function msToNextLocalDay(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime() + 1000;
}

/**
 * Marks sent invoices past their due date as overdue: on launch and on an
 * organisation switch, then again each time the local day changes, since the
 * menu bar keeps the app open for days. A timer catches midnight; focus and
 * the window showing again catch a day change the timer missed while the Mac
 * slept.
 */
export function useOverdueCheck() {
  const qc = useQueryClient();
  const ran = useRef(false);
  const lastDay = useRef<string | null>(null);

  useEffect(() => {
    const check = () => {
      lastDay.current = todayLocalISO();
      runOverdueCheck(qc);
    };
    const checkIfNewDay = () => {
      if (lastDay.current !== todayLocalISO()) check();
    };
    if (!ran.current) {
      ran.current = true;
      check();
    }

    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        checkIfNewDay();
        arm();
      }, msToNextLocalDay());
    };
    arm();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkIfNewDay();
    };
    window.addEventListener("focus", checkIfNewDay);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", checkIfNewDay);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [qc]);
}
