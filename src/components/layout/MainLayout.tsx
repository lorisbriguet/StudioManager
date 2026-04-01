import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { useTabSync } from "../../hooks/useTabSync";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../i18n/useT";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { switchDb } from "../../db/index";
import { toast } from "sonner";
import { X } from "lucide-react";

export function MainLayout() {
  const testMode = useAppStore((s) => s.testMode);
  const setTestMode = useAppStore((s) => s.setTestMode);
  const presentationMode = useAppStore((s) => s.presentationMode);
  const setPresentationMode = useAppStore((s) => s.setPresentationMode);
  const t = useT();

  useTabSync();
  const location = useLocation();

  const exitTestMode = async () => {
    const confirmed = await ask(t.test_mode_confirm_exit, { kind: "warning" });
    if (!confirmed) return;
    try {
      await invoke("exit_test_mode");
      await switchDb("studiomanager.db");
      setTestMode(false);
      toast.success(t.toast_test_mode_exited);
      setTimeout(() => window.location.reload(), 500);
    } catch {
      toast.error(t.toast_test_mode_failed);
    }
  };

  const exitPresentationMode = async () => {
    const confirmed = await ask(t.presentation_mode_confirm_exit, { kind: "warning" });
    if (!confirmed) return;
    try {
      await invoke("exit_presentation_mode");
      await switchDb("studiomanager.db");
      setPresentationMode(false);
      toast.success(t.toast_presentation_exited);
      setTimeout(() => window.location.reload(), 500);
    } catch {
      toast.error(String(t.toast_presentation_failed));
    }
  };

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-hidden flex flex-col">
        {testMode && (
          <div className="bg-[var(--color-banner-test)] text-white text-sm font-semibold py-1.5 px-4 shrink-0 flex items-center justify-center gap-3">
            <span>{t.test_mode_banner}</span>
            <button
              onClick={exitTestMode}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-banner-test-hover)] hover:opacity-80 text-xs"
            >
              <X size={12} /> {t.exit_test_mode}
            </button>
          </div>
        )}
        {presentationMode && (
          <div className="bg-[var(--color-banner-presentation)] text-white text-sm font-semibold py-1.5 px-4 shrink-0 flex items-center justify-center gap-3">
            <span>{t.presentation_mode_banner}</span>
            <button
              onClick={exitPresentationMode}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-banner-presentation-hover)] hover:opacity-80 text-xs"
            >
              <X size={12} /> {t.exit_presentation_mode}
            </button>
          </div>
        )}
        <TabBar />
        <div key={location.pathname} className="page-transition p-8 w-full flex-1 overflow-y-auto flex flex-col min-h-0 bg-[var(--color-bg)]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
