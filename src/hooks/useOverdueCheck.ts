import { useEffect, useRef } from "react";
import { getLabels, notify } from "../lib/notify";
import { plural } from "../i18n/plural";
import { useQueryClient } from "@tanstack/react-query";
import { markOverdueInvoices } from "../db/queries/invoices";
import { createNotification } from "../db/queries/notifications";
import { logError } from "../lib/log";
import { sendNativeNotification } from "../lib/nativeNotification";
import { useOrgStore } from "../stores/org-store";

export function useOverdueCheck() {
  const qc = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const org = useOrgStore.getState().activeId;

    markOverdueInvoices().then(async (overdue) => {
      // A switch may have landed while the query ran: the notification below
      // would be written into the organisation we just moved to, about
      // invoices belonging to the one we left.
      if (useOrgStore.getState().activeId !== org) return;
      if (overdue.length > 0) {
        qc.invalidateQueries({ queryKey: ["invoices"] });
        qc.invalidateQueries({ queryKey: ["finance"] });

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
        });

        qc.invalidateQueries({ queryKey: ["notifications"] });

        sendNativeNotification(title, refs);
      }
    }).catch((e) => {
      logError("Overdue check failed:", e);
    });
  }, [qc]);
}
