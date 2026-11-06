import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useT } from "../i18n/useT";
import { logError } from "../lib/log";
import { isDemoBuild } from "../lib/demoBuild";
import { Button } from "./ui/Button";

export function UpdateChecker() {
  const t = useT();
  // Checks on mount (never in the demo build: it has no updater endpoint).
  const [status, setStatus] = useState<"idle" | "checking" | "available" | "downloading" | "ready" | "none" | "error">(
    () => (isDemoBuild() ? "idle" : "checking")
  );
  const [version, setVersion] = useState("");
  const [progress, setProgress] = useState(0);

  /** Shows what the updater answers (status is already "checking"). */
  const showCheck = (answer: ReturnType<typeof check>) =>
    answer.then(
      (update) => {
        if (update) {
          setVersion(update.version);
          setStatus("available");
        } else {
          setStatus("none");
        }
      },
      (e: unknown) => {
        logError("Update check failed:", e);
        setStatus("error");
      }
    );

  const checkForUpdate = () => {
    setStatus("checking");
    void showCheck(check());
  };

  const downloadAndInstall = async () => {
    setStatus("downloading");
    try {
      const update = await check();
      if (!update) return;

      let totalLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalLength = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (totalLength > 0) {
            setProgress(Math.round((downloaded / totalLength) * 100));
          }
        } else if (event.event === "Finished") {
          setStatus("ready");
        }
      });

      setStatus("ready");
    } catch (e) {
      logError("Update download failed:", e);
      setStatus("error");
    }
  };

  const doRelaunch = async () => {
    await relaunch();
  };

  // Check on mount (never in the demo build: it has no updater endpoint)
  useEffect(() => {
    if (!isDemoBuild()) void showCheck(check());
  }, []);

  if (isDemoBuild()) {
    return <div className="text-sm text-muted">{t.updates_demo_build}</div>;
  }

  if (status === "idle" || status === "checking") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        {t.checking_for_updates}
      </div>
    );
  }

  if (status === "none") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">{t.up_to_date}</span>
        <Button variant="link" onClick={checkForUpdate}>
          {t.check_again}
        </Button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">{t.update_check_failed}</span>
        <Button variant="link" onClick={checkForUpdate}>
          {t.check_again}
        </Button>
      </div>
    );
  }

  if (status === "available") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>{t.update_available}: <strong>v{version}</strong></span>
        <Button variant="primary" onClick={downloadAndInstall}>
          {t.download_and_install}
        </Button>
      </div>
    );
  }

  if (status === "downloading") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">{t.downloading_update} {progress > 0 ? `${progress}%` : ""}</span>
      </div>
    );
  }

  if (status === "ready") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>{t.update_ready}</span>
        <Button variant="primary" onClick={doRelaunch}>
          {t.restart_now}
        </Button>
      </div>
    );
  }

  return null;
}
