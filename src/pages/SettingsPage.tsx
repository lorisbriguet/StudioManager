import { useState, useEffect, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { FolderOpen, HardDrive, RotateCcw, FlaskConical, Camera, Settings2, Palette, SlidersHorizontal, CalendarDays, LayoutList, Tags, Download, Archive, Shield, X, Clock, Store, Building2, Database as DatabaseIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { purgeAllCalendarEvents, syncAllExisting, listWritableCalendars } from "../lib/appleCalendar";
import { createBackup, listBackups, restoreFromBackup, RestoreError, validateBackupPath, isBackupRunning, setBackupRunning, isScopeDenied } from "../lib/backup";
import { resetDb } from "../db";
import { enterTestMode, exitTestMode, enterPresentationMode, exitPresentationMode } from "../lib/modes";
import { useAppStore, ACCENT_PRESETS, type DateFormatOption, type ProjectOpenMode } from "../stores/app-store";
import { THEMES } from "../lib/themes";
import { useT } from "../i18n/useT";
import type { AppLanguage } from "../i18n/ui";
import { UpdateChecker } from "../components/UpdateChecker";
import { WorkloadTemplateManager } from "../components/workload/WorkloadTemplateManager";
import { Input, Select, Button } from "../components/ui";
import { Toggle } from "../components/ui/Toggle";
import { logError } from "../lib/log";
import { OrganisationsCard } from "../components/settings/OrganisationsCard";
import { DemoDataCard } from "../components/settings/DemoDataCard";
import { isDemoBuild } from "../lib/demoBuild";
import { SettingRow, SettingsCard } from "../components/settings/SettingsPrimitives";
import { AccentColorPicker } from "../components/settings/AccentColorPicker";
import { SuppliersManager } from "../components/settings/SuppliersManager";
import { ExpenseCategoryManager } from "../components/settings/ExpenseCategoryManager";
import { CustomListsManager } from "../components/settings/CustomListsManager";
import { TimeEntriesManager } from "../components/settings/TimeEntriesManager";

type SettingsCategory = "general" | "appearance" | "behavior" | "calendar" | "workload" | "organisations" | "categories" | "suppliers" | "lists" | "time_entries" | "updates" | "backup" | "sandbox" | "demo_data";

const SETTINGS_CATEGORIES_BASE: SettingsCategory[] = ["general", "appearance", "behavior", "calendar", "workload", "organisations", "categories", "suppliers", "lists", "time_entries", "updates", "backup"];

export function SettingsPage() {
  const dateFormat = useAppStore((s) => s.dateFormat);
  const setDateFormat = useAppStore((s) => s.setDateFormat);
  const accentColor = useAppStore((s) => s.accentColor);
  const setAccentColor = useAppStore((s) => s.setAccentColor);
  const calendarSync = useAppStore((s) => s.calendarSync);
  const setCalendarSync = useAppStore((s) => s.setCalendarSync);
  const calendarName = useAppStore((s) => s.calendarName);
  const setCalendarName = useAppStore((s) => s.setCalendarName);
  const projectOpenMode = useAppStore((s) => s.projectOpenMode);
  const setProjectOpenMode = useAppStore((s) => s.setProjectOpenMode);
  const showTasksPage = useAppStore((s) => s.showTasksPage);
  const setShowTasksPage = useAppStore((s) => s.setShowTasksPage);
  const showIncome = useAppStore((s) => s.showIncome);
  const setShowIncome = useAppStore((s) => s.setShowIncome);
  const showTimeOverview = useAppStore((s) => s.showTimeOverview);
  const setShowTimeOverview = useAppStore((s) => s.setShowTimeOverview);
  const themeId = useAppStore((s) => s.themeId);
  const setTheme = useAppStore((s) => s.setTheme);
  const reduceMotion = useAppStore((s) => s.reduceMotion);
  const setReduceMotion = useAppStore((s) => s.setReduceMotion);
  const nativeNotifications = useAppStore((s) => s.nativeNotifications);
  const setNativeNotifications = useAppStore((s) => s.setNativeNotifications);
  const backupPath = useAppStore((s) => s.backupPath);
  const setBackupPath = useAppStore((s) => s.setBackupPath);
  const backupPath2 = useAppStore((s) => s.backupPath2);
  const setBackupPath2 = useAppStore((s) => s.setBackupPath2);
  const maxBackups = useAppStore((s) => s.maxBackups);
  const setMaxBackups = useAppStore((s) => s.setMaxBackups);
  const autoBackupInterval = useAppStore((s) => s.autoBackupInterval);
  const setAutoBackupInterval = useAppStore((s) => s.setAutoBackupInterval);
  const lastAutoBackup = useAppStore((s) => s.lastAutoBackup);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const exportLanguage = useAppStore((s) => s.exportLanguage);
  const setExportLanguage = useAppStore((s) => s.setExportLanguage);
  const [syncing, setSyncing] = useState(false);
  const [backing, setBacking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [availableBackups, setAvailableBackups] = useState<string[]>([]);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [availableCalendars, setAvailableCalendars] = useState<string[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [searchParams] = useSearchParams();
  const requestedCategory = searchParams.get("category");
  // demo_data is only a valid ?category= target in the demo build — in the
  // real build it would otherwise resolve to an empty pane instead of
  // falling back to "general".
  // Test and presentation modes are demo-build tools: the real app keeps only the exit paths (banners) for anyone mid-mode at update time.
  const settingsCategories: SettingsCategory[] = isDemoBuild() ? [...SETTINGS_CATEGORIES_BASE, "sandbox", "demo_data"] : SETTINGS_CATEGORIES_BASE;
  const validCategory: SettingsCategory | null =
    requestedCategory && (settingsCategories as string[]).includes(requestedCategory)
      ? (requestedCategory as SettingsCategory)
      : null;
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(validCategory ?? "general");
  const [appVersion, setAppVersion] = useState("");
  const testMode = useAppStore((s) => s.testMode);
  const presentationMode = useAppStore((s) => s.presentationMode);
  const [togglingTestMode, setTogglingTestMode] = useState(false);
  const [togglingPresentation, setTogglingPresentation] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [restoringSnapshot, setRestoringSnapshot] = useState(false);
  const [hasSnapshotFile, setHasSnapshotFile] = useState(false);
  const t = useT();

  // ?category= is not only an initial value: "Manage organisations…" in the
  // switcher navigates here while Settings may already be mounted, and the
  // initial state alone would leave the page on whatever category was open.
  useEffect(() => {
    if (validCategory) setActiveCategory(validCategory);
  }, [validCategory]);

  useEffect(() => {
    getVersion().then(setAppVersion).catch((e) => logError("Failed to read app version:", e));
  }, []);
  useEffect(() => {
    invoke<boolean>("has_snapshot")
      .then(setHasSnapshotFile)
      .catch((e) => logError("Failed to check for snapshot:", e));
  }, []);

  const handleEnterTestMode = async () => {
    setTogglingTestMode(true);
    try {
      await enterTestMode();
      toast.success(t.toast_test_mode_entered);
    } catch (e) {
      logError("Enter test mode failed:", e);
      toast.error(`${t.toast_test_mode_failed}: ${String(e)}`);
    } finally {
      setTogglingTestMode(false);
    }
  };

  const handleExitTestMode = async () => {
    const confirmed = await ask(t.test_mode_confirm_exit, { kind: "warning" });
    if (!confirmed) return;
    setTogglingTestMode(true);
    try {
      await exitTestMode();
      toast.success(t.toast_test_mode_exited);
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      logError("Exit test mode failed:", e);
      toast.error(`${t.toast_test_mode_failed}: ${String(e)}`);
    } finally {
      setTogglingTestMode(false);
    }
  };

  const handleEnterPresentation = async () => {
    setTogglingPresentation(true);
    try {
      await enterPresentationMode();
      toast.success(t.toast_presentation_entered);
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      logError("Enter presentation mode failed:", e);
      toast.error(`${t.toast_presentation_failed}: ${String(e)}`);
    } finally {
      setTogglingPresentation(false);
    }
  };

  const handleExitPresentation = async () => {
    const confirmed = await ask(t.presentation_mode_confirm_exit, { kind: "warning" });
    if (!confirmed) return;
    setTogglingPresentation(true);
    try {
      await exitPresentationMode();
      toast.success(t.toast_presentation_exited);
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      logError("Exit presentation mode failed:", e);
      toast.error(`${t.toast_presentation_failed}: ${String(e)}`);
    } finally {
      setTogglingPresentation(false);
    }
  };

  const handleCreateSnapshot = async () => {
    setSnapshotting(true);
    try {
      await invoke<string>("snapshot_db");
      setHasSnapshotFile(true);
      toast.success(t.toast_snapshot_created);
    } catch (e) {
      logError("Snapshot failed:", e);
      toast.error(`${t.toast_snapshot_failed}: ${String(e)}`);
    } finally {
      setSnapshotting(false);
    }
  };

  const handleRestoreSnapshot = async () => {
    const confirmed = await ask(t.restore_snapshot_confirm, { kind: "warning" });
    if (!confirmed) return;
    setRestoringSnapshot(true);
    try {
      await invoke("restore_snapshot");
      await resetDb();
      toast.success(t.toast_snapshot_restored);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      logError("Restore snapshot failed:", e);
      toast.error(`${t.toast_snapshot_failed}: ${String(e)}`);
    } finally {
      setRestoringSnapshot(false);
    }
  };

  const handleCalendarToggle = async () => {
    const enabling = !calendarSync;
    setCalendarSync(enabling);
    if (enabling) {
      setSyncing(true);
      try {
        await purgeAllCalendarEvents();
        const count = await syncAllExisting();
        if (count > 0) toast.success(t.synced_events.replace("{count}", String(count)));
      } catch (e) {
        logError("Sync failed:", e);
        toast.error(t.toast_failed_sync);
      } finally {
        setSyncing(false);
      }
    }
  };

  const browseBackupDir = async (secondary?: boolean) => {
    // recursive: true extends the session fs scope to the whole subtree —
    // backups write nested folders (backup-<ts>/data/...), so a plain pick
    // outside the static scope roots would otherwise fail on the first mkdir.
    const dir = await open({ directory: true, recursive: true, title: t.backup_directory });
    if (typeof dir === "string") {
      const writable = await validateBackupPath(dir);
      if (!writable) {
        toast.error(t.backup_path_not_writable);
        return;
      }
      if (secondary) setBackupPath2(dir);
      else setBackupPath(dir);
    }
  };

  const runBackup = async () => {
    if (!backupPath) {
      toast.error(t.toast_backup_dir_first);
      return;
    }
    if (isBackupRunning()) {
      toast.error(t.backup_already_running);
      return;
    }
    setBacking(true);
    setBackupRunning(true);
    try {
      const path = await createBackup(backupPath, maxBackups);
      if (backupPath2) {
        await createBackup(backupPath2, maxBackups);
      }
      toast.success(t.backup_created.replace("{name}", path.split("/").pop() ?? ""));
    } catch (e) {
      toast.error(
        isScopeDenied(e)
          ? t.backup_path_not_allowed
          : t.backup_failed.replace("{error}", String(e))
      );
    } finally {
      setBacking(false);
      setBackupRunning(false);
    }
  };

  const loadBackupList = async () => {
    if (!backupPath) return;
    setLoadingBackups(true);
    try {
      const backups = await listBackups(backupPath);
      setAvailableBackups(backups);
      setSelectedBackup(backups[0] ?? "");
    } catch (e) {
      if (isScopeDenied(e)) toast.error(t.backup_path_not_allowed);
      setAvailableBackups([]);
    } finally {
      setLoadingBackups(false);
    }
  };

  const runRestore = async () => {
    if (!backupPath || !selectedBackup) {
      toast.error(t.toast_set_backup_dir);
      return;
    }
    const confirmed = await ask(t.restore_confirm, { kind: "warning" });
    if (!confirmed) return;
    setRestoring(true);
    try {
      const { warnings, valuesDefaulted, safetyBackup } = await restoreFromBackup(`${backupPath}/${selectedBackup}`);
      if (warnings.length > 0) {
        toast.warning(`${t.restore_warnings} ${warnings.join(", ")}`, { duration: 8000 });
      }
      let successMsg = valuesDefaulted > 0
        ? `${t.toast_restore_success} ${t.restore_values_defaulted.replace("{count}", String(valuesDefaulted))}`
        : t.toast_restore_success;
      successMsg += ` ${t.restore_safety_created.replace("{name}", safetyBackup)}`;
      toast.success(successMsg);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      // Restore runs in a single transaction — on failure it rolled back
      if (e instanceof RestoreError) {
        const base = e.code === "backup_empty" ? t.restore_backup_empty : t.restore_safety_backup_failed;
        toast.error(e.detail ? `${base} (${e.detail})` : base, { duration: 10000 });
      } else if (isScopeDenied(e)) {
        toast.error(`${t.backup_path_not_allowed} ${t.restore_no_changes}`, { duration: 10000 });
      } else {
        toast.error(`${t.toast_restore_failed}: ${String(e)}. ${t.restore_no_changes}`, { duration: 10000 });
      }
    } finally {
      setRestoring(false);
    }
  };

  const categorySections: { label: string; items: { key: SettingsCategory; label: string; icon: React.ReactNode }[] }[] = [
    {
      label: t.settings_group_preferences,
      items: [
        { key: "general", label: t.general, icon: <Settings2 size={14} /> },
        { key: "appearance", label: t.appearance, icon: <Palette size={14} /> },
        { key: "behavior", label: t.behavior, icon: <SlidersHorizontal size={14} /> },
        { key: "calendar", label: t.calendar_sync, icon: <CalendarDays size={14} /> },
        { key: "workload", label: t.workload_templates, icon: <LayoutList size={14} /> },
      ],
    },
    {
      label: t.settings_group_data,
      items: [
        { key: "organisations", label: t.organisations, icon: <Building2 size={14} /> },
        { key: "categories", label: t.expense_categories, icon: <Tags size={14} /> },
        { key: "suppliers", label: t.suppliers, icon: <Store size={14} /> },
        { key: "lists", label: t.custom_lists, icon: <LayoutList size={14} /> },
        { key: "time_entries", label: t.time_entries_management, icon: <Clock size={14} /> },
        { key: "backup", label: t.backup, icon: <Archive size={14} /> },
        ...(isDemoBuild()
          ? [
              { key: "sandbox" as const, label: t.test_mode, icon: <Shield size={14} /> },
              { key: "demo_data" as const, label: t.demo_data, icon: <DatabaseIcon size={14} /> },
            ]
          : []),
      ],
    },
    {
      label: t.settings_group_app,
      items: [
        { key: "updates", label: t.updates, icon: <Download size={14} /> },
      ],
    },
  ];

  const categories = categorySections.flatMap((s) => s.items);

  // Keyboard navigation for settings sidebar
  const handleSettingsKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement).isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = categories.findIndex((c) => c.key === activeCategory);
        const len = categories.length;
        const next = e.key === "ArrowDown" ? (idx + 1) % len : (idx - 1 + len) % len;
        setActiveCategory(categories[next].key);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("sidebar-focus"));
      }
    },
    [activeCategory, categories]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleSettingsKeyDown);
    return () => window.removeEventListener("keydown", handleSettingsKeyDown);
  }, [handleSettingsKeyDown]);

  return (
    <div className="flex gap-0 h-full -m-8">
      {/* Category sidebar */}
      <div className="w-48 shrink-0 border-r border-[var(--color-border-divider)] py-5">
        <h1 className="text-sm font-semibold px-5 mb-4 text-muted uppercase tracking-wider">{t.settings}</h1>
        <nav className="space-y-3 px-1">
          {categorySections.map((section) => (
            <div key={section.label}>
              <div className="text-[10px] font-medium uppercase tracking-widest text-muted px-3 mb-1">{section.label}</div>
              <div className="space-y-px">
                {section.items.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setActiveCategory(cat.key)}
                    className={`w-full text-left px-3 py-1.5 mx-1 rounded-md text-xs transition-colors flex items-center gap-2 ${
                      activeCategory === cat.key
                        ? "bg-accent-light text-accent font-medium"
                        : "text-muted hover:bg-[var(--color-hover-row)]"
                    }`}
                    style={{ width: "calc(100% - 8px)" }}
                  >
                    {cat.icon}
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        {appVersion && (
          <p className="text-[10px] text-muted px-5 mt-6">v{appVersion}</p>
        )}
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className={activeCategory === "time_entries" ? "max-w-4xl" : activeCategory === "categories" ? "max-w-3xl" : "max-w-xl"}>
          {activeCategory === "general" && (
            <div className="space-y-4">
              <SettingsCard title={t.general}>
              <SettingRow label={t.app_language}>
                <Select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as AppLanguage)}
                  fullWidth={false}
                >
                  <option value="EN">{t.english}</option>
                  <option value="FR">{t.french}</option>
                </Select>
              </SettingRow>
              <SettingRow label={t.export_language}>
                <Select
                  value={exportLanguage}
                  onChange={(e) => setExportLanguage(e.target.value as AppLanguage)}
                  fullWidth={false}
                >
                  <option value="EN">{t.english}</option>
                  <option value="FR">{t.french}</option>
                </Select>
              </SettingRow>
              <SettingRow label={t.date_format}>
                <Select
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value as DateFormatOption)}
                  fullWidth={false}
                >
                  <option value="dd.MM.yyyy">05.03.2026</option>
                  <option value="dd/MM/yyyy">05/03/2026</option>
                  <option value="MM/dd/yyyy">03/05/2026</option>
                  <option value="yyyy-MM-dd">2026-03-05</option>
                </Select>
              </SettingRow>
              </SettingsCard>

              <SettingsCard title={t.wiki}>
              <SettingRow label={t.reset_user_guide} desc={t.reset_user_guide_desc}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    if (!(await ask(t.reset_user_guide_confirm ?? "Reset the User Guide to default? This will delete the current guide and re-create it.", { kind: "warning" }))) return;
                    try {
                      const db = await import("../db").then((m) => m.getDb());
                      const { resetUserGuide } = await import("../db/seeds/user-guide");
                      await resetUserGuide(db);
                      toast.success(t.reset_user_guide_done ?? "User Guide reset");
                    } catch (e) {
                      toast.error(String(e));
                    }
                  }}
                >
                  {t.reset_user_guide_btn ?? "Reset"}
                </Button>
              </SettingRow>
              </SettingsCard>
            </div>
          )}

          {activeCategory === "appearance" && (
            <SettingsCard title={t.appearance}>
              <div className="pb-3">
                <div className="text-sm mb-2">{t.theme}</div>
                <div className="grid grid-cols-5 gap-2">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => setTheme(theme.id)}
                      className={`flex flex-col rounded-lg overflow-hidden border-2 transition-colors ${
                        themeId === theme.id
                          ? "border-accent shadow-sm"
                          : "border-[var(--color-border-divider)] hover:border-[var(--color-input-border)]"
                      }`}
                      title={theme.name}
                    >
                      <div className="flex h-10" style={{ background: theme.colors.bg }}>
                        <div className="w-3 shrink-0" style={{ background: theme.colors.sidebar, borderRight: `1px solid ${theme.colors.sidebarBorder}` }} />
                        <div className="flex-1 p-1 flex flex-col gap-0.5 justify-center">
                          <div className="h-1 w-3/4 rounded-full" style={{ background: theme.colors.accent }} />
                          <div className="h-1 w-1/2 rounded-full opacity-40" style={{ background: theme.colors.textMuted }} />
                          <div className="h-1 w-2/3 rounded-full opacity-25" style={{ background: theme.colors.textMuted }} />
                        </div>
                      </div>
                      <div className="text-[10px] text-center py-0.5 truncate px-1" style={{ background: theme.colors.surface, color: theme.colors.text }}>
                        {theme.name}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="py-3 border-b border-[var(--color-border-divider)]">
                <div className="text-sm mb-2">{t.accent_color}</div>
                <AccentColorPicker
                  presets={ACCENT_PRESETS}
                  value={accentColor}
                  onChange={setAccentColor}
                />
              </div>
              <SettingRow label={t.reduce_motion} desc={t.reduce_motion_desc}>
                <Toggle checked={reduceMotion} onChange={setReduceMotion} ariaLabel={t.reduce_motion} />
              </SettingRow>
            </SettingsCard>
          )}

          {activeCategory === "behavior" && (
            <SettingsCard title={t.behavior}>
              <SettingRow label={t.project_open_mode}>
                <Select
                  value={projectOpenMode}
                  onChange={(e) => setProjectOpenMode(e.target.value as ProjectOpenMode)}
                  fullWidth={false}
                >
                  <option value="peek">{t.side_peek}</option>
                  <option value="page">{t.full_page}</option>
                </Select>
              </SettingRow>
              <SettingRow label={t.show_tasks_page} desc={t.show_tasks_page_desc}>
                <Toggle checked={showTasksPage} onChange={setShowTasksPage} ariaLabel={t.show_tasks_page} />
              </SettingRow>
              <SettingRow label={t.show_income} desc={t.show_income_desc}>
                <Toggle checked={showIncome} onChange={setShowIncome} ariaLabel={t.show_income} />
              </SettingRow>
              <SettingRow label={t.show_time_overview} desc={t.show_time_overview_desc}>
                <Toggle checked={showTimeOverview} onChange={setShowTimeOverview} ariaLabel={t.show_time_overview} />
              </SettingRow>
              <SettingRow label={t.native_notifications} desc={t.native_notifications_desc}>
                <Toggle checked={nativeNotifications} onChange={setNativeNotifications} ariaLabel={t.native_notifications} />
              </SettingRow>
            </SettingsCard>
          )}

          {activeCategory === "calendar" && (
            <SettingsCard title={t.calendar_sync} desc={t.calendar_permission_help}>
              <SettingRow label={t.target_calendar}>
                <div className="flex items-center gap-2">
                  <Select
                    value={calendarName}
                    onChange={(e) => setCalendarName(e.target.value)}
                    onFocus={() => {
                      if (availableCalendars.length === 0 && !loadingCalendars) {
                        setLoadingCalendars(true);
                        listWritableCalendars()
                          .then(setAvailableCalendars)
                          .catch(() => toast.error(t.toast_failed_calendars))
                          .finally(() => setLoadingCalendars(false));
                      }
                    }}
                    fullWidth={false}
                  >
                    <option value="">{t.select_calendar}</option>
                    {availableCalendars.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                    {calendarName && !availableCalendars.includes(calendarName) && (
                      <option value={calendarName}>{calendarName}</option>
                    )}
                  </Select>
                  {loadingCalendars && <span className="text-xs text-muted">{t.loading}</span>}
                </div>
              </SettingRow>
              <SettingRow label={t.sync_to_apple} desc={t.calendar_hint}>
                <Toggle
                  checked={calendarSync}
                  disabled={syncing}
                  ariaLabel={t.sync_to_apple}
                  onChange={(_v: boolean) => {
                    if (!calendarName && !calendarSync) {
                      toast.error(t.toast_select_calendar);
                      return;
                    }
                    handleCalendarToggle();
                  }}
                />
              </SettingRow>
              <SettingRow label={t.calendar_color_hint_label} desc={t.calendar_color_hint_desc}>
                <span />
              </SettingRow>
            </SettingsCard>
          )}

          {activeCategory === "workload" && (
            <SettingsCard title={t.workload_templates}>
              <WorkloadTemplateManager />
            </SettingsCard>
          )}

          {activeCategory === "organisations" && <OrganisationsCard />}

          {activeCategory === "demo_data" && isDemoBuild() && <DemoDataCard />}

          {activeCategory === "categories" && (
            <SettingsCard title={t.expense_categories} desc={t.expense_categories_desc}>
              <ExpenseCategoryManager />
            </SettingsCard>
          )}

          {activeCategory === "suppliers" && (
            <SettingsCard title={t.suppliers}>
              <SuppliersManager />
            </SettingsCard>
          )}

          {activeCategory === "lists" && (
            <SettingsCard title={t.custom_lists}>
              <CustomListsManager />
            </SettingsCard>
          )}

          {activeCategory === "time_entries" && (
            <section className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-divider)] px-4 pt-3 pb-1">
              <TimeEntriesManager />
            </section>
          )}

          {activeCategory === "updates" && (
            <SettingsCard title={t.updates}>
              <UpdateChecker />
            </SettingsCard>
          )}

          {activeCategory === "sandbox" && isDemoBuild() && (
            <div className="space-y-4">
              <SettingsCard title={t.test_mode} desc={t.test_mode_desc}>
              <SettingRow label={t.test_mode}>
                {testMode ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-warning-text)] font-medium flex items-center gap-1"><FlaskConical size={12} /> {t.test_mode_active}</span>
                    <button type="button" onClick={handleExitTestMode} disabled={togglingTestMode} className="px-2 py-1 border border-[var(--color-danger-text)]/30 text-[var(--color-danger-text)] text-xs rounded-md hover:bg-[var(--color-danger-bg)] disabled:opacity-50">
                      {t.exit_test_mode}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={handleEnterTestMode} disabled={togglingTestMode} className="flex items-center gap-1 px-2.5 py-1 bg-[var(--color-warning-text)] text-white text-xs rounded-md hover:opacity-90 disabled:opacity-50">
                    <FlaskConical size={12} />
                    {togglingTestMode ? t.loading : t.enter_test_mode}
                  </button>
                )}
              </SettingRow>
              </SettingsCard>

              <SettingsCard title={t.presentation_mode} desc={t.presentation_mode_desc}>
              <SettingRow label={t.presentation_mode}>
                {presentationMode ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-indigo-text)] font-medium">{t.presentation_active}</span>
                    <button type="button" onClick={handleExitPresentation} disabled={togglingPresentation} className="px-2 py-1 border border-[var(--color-danger-text)]/30 text-[var(--color-danger-text)] text-xs rounded-md hover:bg-[var(--color-danger-bg)] disabled:opacity-50">
                      {t.exit_presentation_mode}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={handleEnterPresentation} disabled={togglingPresentation || testMode} className="flex items-center gap-1 px-2.5 py-1 bg-[var(--color-indigo-text)] text-white text-xs rounded-md hover:opacity-90 disabled:opacity-50">
                    {togglingPresentation ? t.loading : t.enter_presentation_mode}
                  </button>
                )}
              </SettingRow>
              </SettingsCard>
            </div>
          )}

          {activeCategory === "backup" && (
            <div className="space-y-4">
              <SettingsCard title={t.backup} desc={t.backup_desc}>
              <SettingRow label={t.backup_directory}>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted truncate max-w-[180px]" title={backupPath}>{backupPath || t.not_set}</span>
                  <Button type="button" variant="ghost" size="sm" icon={<FolderOpen size={12} />} onClick={() => browseBackupDir()}>
                    {t.browse}
                  </Button>
                </div>
              </SettingRow>
              <SettingRow label={t.backup_directory_2}>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted truncate max-w-[180px]" title={backupPath2}>{backupPath2 || t.not_set}</span>
                  <Button type="button" variant="ghost" size="sm" icon={<FolderOpen size={12} />} onClick={() => browseBackupDir(true)}>
                    {t.browse}
                  </Button>
                  {backupPath2 && (
                    <button type="button" onClick={() => setBackupPath2("")} aria-label={t.remove} className="text-muted hover:text-[var(--color-text)]"><X size={12} /></button>
                  )}
                </div>
              </SettingRow>
              <SettingRow label={t.keep_last_n}>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={maxBackups}
                  onChange={(e) => setMaxBackups(Math.max(1, Number(e.target.value) || 5))}
                  fullWidth={false}
                  className="w-16"
                />
              </SettingRow>
              <SettingRow label={t.auto_backup_interval}>
                <div className="flex items-center gap-2">
                  <Select
                    value={autoBackupInterval}
                    onChange={(e) => setAutoBackupInterval(Number(e.target.value))}
                    fullWidth={false}
                  >
                    <option value={0}>{t.disabled}</option>
                    <option value={1440}>{t.daily}</option>
                    <option value={10080}>{t.weekly}</option>
                    <option value={20160}>{t.biweekly}</option>
                    <option value={43200}>{t.monthly}</option>
                  </Select>
                  {autoBackupInterval > 0 && lastAutoBackup > 0 && (
                    <span className="text-xs text-muted">
                      Last: {new Date(lastAutoBackup).toLocaleString()}
                    </span>
                  )}
                </div>
              </SettingRow>
              <div className="py-3 flex items-center gap-2">
                <Button type="button" size="sm" icon={<HardDrive size={12} />} onClick={runBackup} disabled={backing || !backupPath}>
                  {backing ? t.backing_up : t.backup_now}
                </Button>
              </div>
              </SettingsCard>

              <SettingsCard title={t.restore_from_backup}>
              <SettingRow label={t.select_backup}>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={selectedBackup}
                    onChange={(e) => setSelectedBackup(e.target.value)}
                    onFocus={() => {
                      if (availableBackups.length === 0 && !loadingBackups) loadBackupList();
                    }}
                    disabled={!backupPath || restoring}
                    fullWidth={false}
                    className="max-w-[180px]"
                  >
                    {availableBackups.length === 0 && !loadingBackups && (
                      <option value="">{backupPath ? t.select_backup : t.toast_set_backup_dir}</option>
                    )}
                    {loadingBackups && <option value="">{t.loading}</option>}
                    {availableBackups.map((name) => (
                      <option key={name} value={name}>{name.replace("backup-", "")}</option>
                    ))}
                  </Select>
                  <button type="button" onClick={runRestore} disabled={restoring || !selectedBackup || !backupPath} className="flex items-center gap-1 px-2 py-1 border border-[var(--color-danger-text)]/30 text-[var(--color-danger-text)] text-xs rounded-md hover:bg-[var(--color-danger-bg)] disabled:opacity-50">
                    <RotateCcw size={12} /> {restoring ? t.restoring : t.restore}
                  </button>
                </div>
              </SettingRow>
              </SettingsCard>

              <SettingsCard title={t.snapshot} desc={t.snapshot_desc}>
              <SettingRow label={t.snapshot}>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" icon={<Camera size={12} />} onClick={handleCreateSnapshot} disabled={snapshotting || testMode}>
                    {snapshotting ? t.loading : t.create_snapshot}
                  </Button>
                  <button type="button" onClick={handleRestoreSnapshot} disabled={restoringSnapshot || !hasSnapshotFile || testMode} className="flex items-center gap-1 px-2.5 py-1 border border-[var(--color-danger-text)]/30 text-[var(--color-danger-text)] text-xs rounded-md hover:bg-[var(--color-danger-bg)] disabled:opacity-50">
                    <RotateCcw size={12} /> {restoringSnapshot ? t.loading : t.restore_snapshot}
                  </button>
                  {!hasSnapshotFile && <span className="text-xs text-muted">{t.no_snapshot_available}</span>}
                </div>
              </SettingRow>
              </SettingsCard>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
