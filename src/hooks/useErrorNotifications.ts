import { useEffect } from "react";
import { createNotification } from "../db/queries/notifications";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Intercepts console.error calls and saves them as "error" notifications.
 * Deduplicates by keeping track of recent messages to avoid spam.
 */
export function useErrorNotifications() {
  const qc = useQueryClient();

  useEffect(() => {
    const originalError = console.error;
    const recentErrors = new Set<string>();

    console.error = (...args: unknown[]) => {
      // Always call the original
      originalError.apply(console, args);

      const message = args
        .map((a) => {
          if (a instanceof Error) return a.message;
          if (typeof a === "string") return a;
          try { return JSON.stringify(a); } catch { return String(a); }
        })
        .join(" ")
        .slice(0, 500);

      if (!message || recentErrors.has(message)) return;

      // Deduplicate for 30 seconds
      recentErrors.add(message);
      setTimeout(() => recentErrors.delete(message), 30_000);

      // Extract a short title from the message
      const title = message.split(/[:\n]/)[0].slice(0, 80) || "Error";

      createNotification({
        type: "error",
        title,
        message,
        read: 0,
        link: null,
      }).then(() => {
        qc.invalidateQueries({ queryKey: ["notifications"] });
      }).catch(() => {
        // Don't recurse if notification creation itself fails
      });
    };

    return () => {
      console.error = originalError;
    };
  }, [qc]);
}
