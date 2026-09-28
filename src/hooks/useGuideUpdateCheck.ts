import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { createNotification } from "../db/queries/notifications";
import { isUserGuideOutdated, USER_GUIDE_VERSION } from "../db/seeds/user-guide";
import { getLabels } from "../lib/notifyError";
import { logError } from "../lib/log";
import { useOrgStore } from "../stores/org-store";

/**
 * The built-in user guide is seeded into an organisation's wiki when the
 * organisation is created, so a release that adds articles never reaches an
 * existing one on its own. Once per organisation and per guide version, tell
 * the owner that Settings > General > Reset guide has something to give them.
 *
 * Silent when the guide is already current or absent; the flag is written in
 * both cases, so the check costs one pair of queries per organisation per
 * version and nothing afterwards.
 */
export function useGuideUpdateCheck() {
  const qc = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const org = useOrgStore.getState().activeId;
    const key = useOrgStore.getState().orgKey("guideUpdateNotified");
    if (localStorage.getItem(key) === String(USER_GUIDE_VERSION)) return;

    (async () => {
      const outdated = await isUserGuideOutdated(await getDb());
      // A switch may have landed while the queries ran: the notification would
      // be written into the organisation we just moved to, about the guide of
      // the one we left.
      if (useOrgStore.getState().activeId !== org) return;

      if (outdated) {
        const t = getLabels();
        await createNotification({
          type: "info",
          title: t.guide_updated_title,
          message: t.guide_updated_message,
          read: 0,
          link: "/settings?category=general",
        });
        qc.invalidateQueries({ queryKey: ["notifications"] });
      }
      localStorage.setItem(key, String(USER_GUIDE_VERSION));
    })().catch((e) => {
      logError("Guide update check failed:", e);
    });
  }, [qc]);
}
