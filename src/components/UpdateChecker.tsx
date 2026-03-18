import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useT } from "../i18n/useT";

export function UpdateChecker() {
  const t = useT();
  const [status, setStatus] = useState<"idle" | "checking" | "available" | "downloading" | "ready" | "none" | "error">("idle");
  const [version, setVersion] = useState("");
  const [progress, setProgress] = useState(0);

  const checkForUpdate = async () => {
    setStatus("checking");
    try {
      const update = await check();
      if (update) {
        setVersion(update.version);
        setStatus("available");
      } else {
        setStatus("none");
      }
    } catch (e) {
      console.error("Update check failed:", e);
      setStatus("error");
    }
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
      console.error("Update download failed:", e);
      setStatus("error");
    }
  };

  const doRelaunch = async () => {
    await relaunch();
  };

  // Check on mount
  useEffect(() => {
    checkForUpdate();
  }, []);

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
        <button
          onClick={checkForUpdate}
          className="text-xs text-accent hover:underline"
        >
          {t.check_again}
        </button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">{t.update_check_failed}</span>
        <button
          onClick={checkForUpdate}
          className="text-xs text-accent hover:underline"
        >
          {t.check_again}
        </button>
      </div>
    );
  }

  if (status === "available") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>{t.update_available}: <strong>v{version}</strong></span>
        <button
          onClick={downloadAndInstall}
          className="px-3 py-1 bg-accent text-white text-xs rounded-md hover:bg-accent-hover"
        >
          {t.download_and_install}
        </button>
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
        <button
          onClick={doRelaunch}
          className="px-3 py-1 bg-accent text-white text-xs rounded-md hover:bg-accent-hover"
        >
          {t.restart_now}
        </button>
      </div>
    );
  }

  return null;
}
