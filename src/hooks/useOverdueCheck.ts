import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { markOverdueInvoices } from "../db/queries/invoices";
import { createNotification } from "../db/queries/notifications";

export function useOverdueCheck() {
  const qc = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    markOverdueInvoices().then(async (overdue) => {
      if (overdue.length > 0) {
        qc.invalidateQueries({ queryKey: ["invoices"] });

        const msg = `${overdue.length} invoice${overdue.length > 1 ? "s" : ""} marked as overdue: ${overdue.map((i) => i.reference).join(", ")}`;

        toast.warning(msg, { duration: 8000 });

        await createNotification({
          type: "overdue",
          title: "Invoices overdue",
          message: msg,
          read: 0,
          link: "/invoices",
        });

        qc.invalidateQueries({ queryKey: ["notifications"] });
      }
    }).catch((e) => {
      console.error("Overdue check failed:", e);
    });
  }, [qc]);
}
