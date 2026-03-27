import { useState, useEffect, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { FolderOpen, HardDrive, RotateCcw, FlaskConical, Camera, Settings2, Palette, SlidersHorizontal, CalendarDays, LayoutList, Tags, Download, Archive, Shield, X } from "lucide-react";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { purgeAllCalendarEvents, syncAllExisting, listWritableCalendars } from "../lib/appleCalendar";
import { createBackup, listBackups, restoreFromBackup, validateBackupPath, isBackupRunning, setBackupRunning } from "../lib/backup";
import { switchDb, resetDb, seedPresentationDb } from "../db";
import { useExpenseCategories, useCreateExpenseCategory, useUpdateExpenseCategory, useDeleteExpenseCategory, isDefaultCategory } from "../db/hooks/useExpenses";
import { isCategoryInUse } from "../db/queries/expenses";
import type { ExpenseCategory } from "../types/expense";
import { useAppStore, ACCENT_PRESETS, type DateFormatOption, type AccentPreset, type ProjectOpenMode } from "../stores/app-store";
import { THEMES } from "../lib/themes";
import { useT } from "../i18n/useT";
import type { AppLanguage } from "../i18n/ui";
import { UpdateChecker } from "../components/UpdateChecker";
import { WorkloadTemplateManager } from "../components/workload/WorkloadTemplateManager";
import { Input, Select } from "../components/ui";
import { Toggle } from "../components/ui/Toggle";
import { logError } from "../lib/log";

type SettingsCategory = "general" | "appearance" | "behavior" | "calendar" | "workload" | "categories" | "updates" | "backup" | "sandbox";

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
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("general");
  const [appVersion, setAppVersion] = useState("");
  const testMode = useAppStore((s) => s.testMode);
  const setTestMode = useAppStore((s) => s.setTestMode);
  const presentationMode = useAppStore((s) => s.presentationMode);
  const setPresentationMode = useAppStore((s) => s.setPresentationMode);
  const enableModularProjects = useAppStore((s) => s.enableModularProjects);
  const setEnableModularProjects = useAppStore((s) => s.setEnableModularProjects);
  const [togglingTestMode, setTogglingTestMode] = useState(false);
  const [togglingPresentation, setTogglingPresentation] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [restoringSnapshot, setRestoringSnapshot] = useState(false);
  const [hasSnapshotFile, setHasSnapshotFile] = useState(false);
  const t = useT();

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);
  useEffect(() => { invoke<boolean>("has_snapshot").then(setHasSnapshotFile).catch(() => {}); }, []);

  const handleEnterTestMode = async () => {
    setTogglingTestMode(true);
    try {
      await invoke<string>("enter_test_mode");
      await switchDb("studiomanager_test.db");
      setTestMode(true);
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
      await invoke("exit_test_mode");
      await switchDb("studiomanager.db");
      setTestMode(false);
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
      await invoke<string>("enter_presentation_mode");
      await switchDb("studiomanager_presentation.db");
      await seedPresentationDb();
      setPresentationMode(true);
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
      await invoke("exit_presentation_mode");
      await switchDb("studiomanager.db");
      setPresentationMode(false);
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
        if (count > 0) toast.success(`Synced ${count} events to Apple Calendar`);
      } catch (e) {
        logError("Sync failed:", e);
        toast.error(t.toast_failed_sync);
      } finally {
        setSyncing(false);
      }
    }
  };

  const browseBackupDir = async (secondary?: boolean) => {
    const dir = await open({ directory: true, title: t.backup_directory });
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
      toast.success(`Backup created: ${path.split("/").pop()}`);
    } catch (e) {
      toast.error(`Backup failed: ${String(e)}`);
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
    } catch {
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
      const warnings = await restoreFromBackup(`${backupPath}/${selectedBackup}`);
      if (warnings.length > 0) {
        toast.warning(`${t.restore_warnings} ${warnings.join(", ")}`, { duration: 8000 });
      }
      toast.success(t.toast_restore_success);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast.error(`${t.toast_restore_failed}: ${String(e)}`);
    } finally {
      setRestoring(false);
    }
  };

  const categorySections: { label: string; items: { key: SettingsCategory; label: string; icon: React.ReactNode }[] }[] = [
    {
      label: "Preferences",
      items: [
        { key: "general", label: t.general, icon: <Settings2 size={14} /> },
        { key: "appearance", label: t.appearance, icon: <Palette size={14} /> },
        { key: "behavior", label: t.behavior, icon: <SlidersHorizontal size={14} /> },
        { key: "calendar", label: t.calendar_sync, icon: <CalendarDays size={14} /> },
        { key: "workload", label: t.workload_templates, icon: <LayoutList size={14} /> },
      ],
    },
    {
      label: "Data",
      items: [
        { key: "categories", label: t.expense_categories, icon: <Tags size={14} /> },
        { key: "backup", label: t.backup, icon: <Archive size={14} /> },
        { key: "sandbox", label: t.test_mode, icon: <Shield size={14} /> },
      ],
    },
    {
      label: "App",
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
              <div className="text-[9px] font-medium uppercase tracking-widest text-muted px-3 mb-1">{section.label}</div>
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
        <div className="max-w-xl">
          {activeCategory === "general" && (
            <div className="space-y-1">
              <SectionHeader title={t.general} />
              <SettingRow label={t.app_language}>
                <Select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as AppLanguage)}
                  fullWidth={false}
                >
                  <option value="EN">English</option>
                  <option value="FR">Francais</option>
                </Select>
              </SettingRow>
              <SettingRow label={t.export_language}>
                <Select
                  value={exportLanguage}
                  onChange={(e) => setExportLanguage(e.target.value as AppLanguage)}
                  fullWidth={false}
                >
                  <option value="EN">English</option>
                  <option value="FR">Francais</option>
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
            </div>
          )}

          {activeCategory === "appearance" && (
            <div className="space-y-1">
              <SectionHeader title={t.appearance} />
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
                <Toggle checked={reduceMotion} onChange={setReduceMotion} />
              </SettingRow>
            </div>
          )}

          {activeCategory === "behavior" && (
            <div className="space-y-1">
              <SectionHeader title={t.behavior} />
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
                <Toggle checked={showTasksPage} onChange={setShowTasksPage} />
              </SettingRow>
              <SettingRow label={t.show_income} desc={t.show_income_desc}>
                <Toggle checked={showIncome} onChange={setShowIncome} />
              </SettingRow>
              <SettingRow label={t.show_time_overview} desc={t.show_time_overview_desc}>
                <Toggle checked={showTimeOverview} onChange={setShowTimeOverview} />
              </SettingRow>
              <SettingRow label={t.native_notifications} desc={t.native_notifications_desc}>
                <Toggle checked={nativeNotifications} onChange={setNativeNotifications} />
              </SettingRow>
            </div>
          )}

          {activeCategory === "calendar" && (
            <div className="space-y-1">
              <SectionHeader title={t.calendar_sync} desc={t.calendar_permission_help} />
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
                  {loadingCalendars && <span className="text-[11px] text-muted">{t.loading}</span>}
                </div>
              </SettingRow>
              <SettingRow label={t.sync_to_apple} desc={t.calendar_hint}>
                <Toggle
                  checked={calendarSync}
                  disabled={syncing}
                  onChange={(_v: boolean) => {
                    if (!calendarName && !calendarSync) {
                      toast.error(t.toast_select_calendar);
                      return;
                    }
                    handleCalendarToggle();
                  }}
                />
              </SettingRow>
            </div>
          )}

          {activeCategory === "workload" && (
            <div>
              <SectionHeader title={t.workload_templates} />
              <WorkloadTemplateManager />
            </div>
          )}

          {activeCategory === "categories" && (
            <div>
              <SectionHeader title={t.expense_categories} desc={t.expense_categories_desc} />
              <ExpenseCategoryManager />
            </div>
          )}

          {activeCategory === "updates" && (
            <div>
              <SectionHeader title={t.updates} />
              <UpdateChecker />
            </div>
          )}

          {activeCategory === "sandbox" && (
            <div className="space-y-1">
              <SectionHeader title={t.test_mode} desc={t.test_mode_desc} />
              <SettingRow label={t.test_mode}>
                {testMode ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-amber-600 font-medium flex items-center gap-1"><FlaskConical size={12} /> {t.test_mode_active}</span>
                    <button type="button" onClick={handleExitTestMode} disabled={togglingTestMode} className="px-2 py-1 border border-red-300 text-red-600 text-xs rounded hover:bg-red-50 disabled:opacity-50">
                      {t.exit_test_mode}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={handleEnterTestMode} disabled={togglingTestMode} className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 text-white text-xs rounded hover:bg-amber-600 disabled:opacity-50">
                    <FlaskConical size={12} />
                    {togglingTestMode ? t.loading : t.enter_test_mode}
                  </button>
                )}
              </SettingRow>

              <div className="border-t border-[var(--color-border-divider)] my-3" />
              <SectionHeader title={t.presentation_mode} desc={t.presentation_mode_desc} />
              <SettingRow label={t.presentation_mode}>
                {presentationMode ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-indigo-600 font-medium">Presentation active</span>
                    <button type="button" onClick={handleExitPresentation} disabled={togglingPresentation} className="px-2 py-1 border border-red-300 text-red-600 text-xs rounded hover:bg-red-50 disabled:opacity-50">
                      {t.exit_presentation_mode}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={handleEnterPresentation} disabled={togglingPresentation || testMode} className="flex items-center gap-1 px-2.5 py-1 bg-indigo-500 text-white text-xs rounded hover:bg-indigo-600 disabled:opacity-50">
                    {togglingPresentation ? t.loading : t.enter_presentation_mode}
                  </button>
                )}
              </SettingRow>

              <div className="border-t border-[var(--color-border-divider)] my-3" />
              <SectionHeader title={t.modular_projects} desc={t.modular_projects_desc} />
              <SettingRow label={t.modular_projects} desc={t.modular_projects_desc}>
                <Toggle checked={enableModularProjects} onChange={setEnableModularProjects} />
              </SettingRow>

              <div className="border-t border-[var(--color-border-divider)] my-3" />
              <SectionHeader title={t.snapshot} desc={t.snapshot_desc} />
              <SettingRow label={t.snapshot}>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleCreateSnapshot} disabled={snapshotting || testMode} className="flex items-center gap-1 px-2.5 py-1 bg-accent text-white text-xs rounded hover:bg-accent-hover disabled:opacity-50">
                    <Camera size={12} /> {snapshotting ? t.loading : t.create_snapshot}
                  </button>
                  <button type="button" onClick={handleRestoreSnapshot} disabled={restoringSnapshot || !hasSnapshotFile || testMode} className="flex items-center gap-1 px-2.5 py-1 border border-red-300 text-red-600 text-xs rounded hover:bg-red-50 disabled:opacity-50">
                    <RotateCcw size={12} /> {restoringSnapshot ? t.loading : t.restore_snapshot}
                  </button>
                  {!hasSnapshotFile && <span className="text-[11px] text-muted">{t.no_snapshot_available}</span>}
                </div>
              </SettingRow>
            </div>
          )}

          {activeCategory === "backup" && (
            <div className="space-y-1">
              <SectionHeader title={t.backup} desc={t.backup_desc} />
              <SettingRow label={t.backup_directory}>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted truncate max-w-[180px]" title={backupPath}>{backupPath || t.not_set}</span>
                  <button type="button" onClick={() => browseBackupDir()} className="flex items-center gap-1 px-2 py-1 border border-[var(--color-input-border)] rounded text-xs hover:bg-[var(--color-hover-row)]">
                    <FolderOpen size={12} /> {t.browse}
                  </button>
                </div>
              </SettingRow>
              <SettingRow label={t.backup_directory_2}>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted truncate max-w-[180px]" title={backupPath2}>{backupPath2 || t.not_set}</span>
                  <button type="button" onClick={() => browseBackupDir(true)} className="flex items-center gap-1 px-2 py-1 border border-[var(--color-input-border)] rounded text-xs hover:bg-[var(--color-hover-row)]">
                    <FolderOpen size={12} /> {t.browse}
                  </button>
                  {backupPath2 && (
                    <button type="button" onClick={() => setBackupPath2("")} className="text-muted hover:text-[var(--color-text)]"><X size={12} /></button>
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
                    <span className="text-[11px] text-muted">
                      Last: {new Date(lastAutoBackup).toLocaleString()}
                    </span>
                  )}
                </div>
              </SettingRow>
              <div className="pt-3 flex items-center gap-2">
                <button type="button" onClick={runBackup} disabled={backing || !backupPath} className="flex items-center gap-1 px-2.5 py-1 bg-accent text-white text-xs rounded hover:bg-accent-hover disabled:opacity-50">
                  <HardDrive size={12} /> {backing ? t.backing_up : t.backup_now}
                </button>
              </div>

              <div className="border-t border-[var(--color-border-divider)] my-3" />
              <SettingRow label={t.restore_from_backup}>
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
                  <button type="button" onClick={runRestore} disabled={restoring || !selectedBackup || !backupPath} className="flex items-center gap-1 px-2 py-1 border border-red-300 text-red-600 text-xs rounded hover:bg-red-50 disabled:opacity-50">
                    <RotateCcw size={12} /> {restoring ? t.restoring : t.restore}
                  </button>
                </div>
              </SettingRow>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact inline row: label left, control right, separated by faint dividers */
function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 min-h-[36px] border-b border-[var(--color-border-divider)]">
      <div className="flex-1 min-w-0 pr-4">
        <div className="text-sm">{label}</div>
        {desc && <div className="text-[11px] text-muted leading-tight mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Flat section label with optional description */
function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="border-b border-[var(--color-border-divider)] pb-2 mb-3">
      <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted">{title}</h2>
      {desc && <p className="text-[11px] text-muted mt-1 normal-case tracking-normal">{desc}</p>}
    </div>
  );
}


function AccentColorPicker({
  presets,
  value,
  onChange,
}: {
  presets: AccentPreset[];
  value: AccentPreset;
  onChange: (preset: AccentPreset) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((preset) => {
        const isActive = value.color.toLowerCase() === preset.color.toLowerCase();
        return (
          <button
            key={preset.color}
            type="button"
            onClick={() => onChange(preset)}
            title={preset.name}
            className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
              isActive ? "ring-2 ring-white ring-offset-2 ring-offset-[var(--color-bg)]" : ""
            }`}
            style={{ backgroundColor: preset.color }}
          />
        );
      })}
    </div>
  );
}

function ExpenseCategoryManager() {
  const t = useT();
  const { data: categories } = useExpenseCategories();
  const cats = categories ?? [];
  const createCategory = useCreateExpenseCategory();
  const updateCategory = useUpdateExpenseCategory();
  const deleteCategory = useDeleteExpenseCategory();
  const [adding, setAdding] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseCategory>({
    code: "",
    name_fr: "",
    name_en: "",
    pl_section: "operating",
  });
  const [categoryUsage, setCategoryUsage] = useState<Record<string, boolean>>({});

  const catCodes = cats.map((c) => c.code).join(",");
  useEffect(() => {
    if (!catCodes) return;
    Promise.all(
      cats.map(async (c) => [c.code, await isCategoryInUse(c.code)] as const)
    ).then((results) => {
      setCategoryUsage(Object.fromEntries(results));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catCodes]);

  const handleSaveNew = async () => {
    if (!form.code || !form.name_fr || !form.name_en) return;
    try {
      await createCategory.mutateAsync(form);
      toast.success(t.toast_category_created);
      setAdding(false);
      setForm({ code: "", name_fr: "", name_en: "", pl_section: "operating" });
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleSaveEdit = async () => {
    if (!editingCode) return;
    try {
      const { code: _, ...data } = form;
      await updateCategory.mutateAsync({ code: editingCode, data });
      toast.success(t.toast_category_updated);
      setEditingCode(null);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleDelete = async (code: string) => {
    if (isDefaultCategory(code)) {
      toast.error(t.toast_category_default);
      return;
    }
    try {
      await deleteCategory.mutateAsync(code);
      toast.success(t.toast_category_deleted);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("in use")) toast.error(t.toast_category_in_use);
      else toast.error(msg);
    }
  };

  const startEdit = (cat: ExpenseCategory) => {
    setEditingCode(cat.code);
    setForm({ ...cat });
    setAdding(false);
  };

  return (
    <div className="max-w-3xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border-divider)] text-left text-xs text-muted uppercase">
            <th className="py-2 pr-2 w-20">{t.category_code}</th>
            <th className="py-2 pr-2">{t.category_name_fr}</th>
            <th className="py-2 pr-2">{t.category_name_en}</th>
            <th className="py-2 pr-2 w-32">{t.category_pl_section}</th>
            <th className="py-2 w-28" />
          </tr>
        </thead>
        <tbody>
          {cats.map((cat) => (
            <tr key={cat.code} className="border-b border-[var(--color-border-divider)]">
              {editingCode === cat.code ? (
                <>
                  <td className="py-2 pr-2 text-muted">{cat.code}</td>
                  <td className="py-2 pr-2">
                    <Input
                      value={form.name_fr}
                      onChange={(e) => setForm({ ...form, name_fr: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      value={form.name_en}
                      onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Select
                      value={form.pl_section}
                      onChange={(e) => setForm({ ...form, pl_section: e.target.value as ExpenseCategory["pl_section"] })}
                    >
                      <option value="operating">{t.pl_operating}</option>
                      <option value="social_charges">{t.pl_social_charges}</option>
                    </Select>
                  </td>
                  <td className="py-2 flex gap-1">
                    <button type="button" onClick={handleSaveEdit} className="px-2 py-1 bg-accent text-white text-xs rounded hover:bg-accent-hover">
                      {t.save}
                    </button>
                    <button type="button" onClick={() => setEditingCode(null)} className="px-2 py-1 border border-[var(--color-input-border)] text-xs rounded hover:bg-[var(--color-hover-row)]">
                      {t.cancel}
                    </button>
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 pr-2 font-mono">{cat.code}</td>
                  <td className="py-2 pr-2">{cat.name_fr}</td>
                  <td className="py-2 pr-2">{cat.name_en}</td>
                  <td className="py-2 pr-2 text-muted">
                    {cat.pl_section === "operating" ? t.pl_operating : t.pl_social_charges}
                  </td>
                  <td className="py-2 flex gap-1">
                    <button type="button" onClick={() => startEdit(cat)} className="px-2 py-1 border border-[var(--color-input-border)] text-xs rounded hover:bg-[var(--color-hover-row)]">
                      {t.edit}
                    </button>
                    {isDefaultCategory(cat.code) ? (
                      <span className="px-2 py-1 text-xs text-muted">{t.default_category}</span>
                    ) : categoryUsage[cat.code] ? (
                      <span className="px-2 py-1 text-xs text-muted">{t.category_in_use}</span>
                    ) : (
                      <button type="button" onClick={() => handleDelete(cat.code)} className="px-2 py-1 border border-red-200 text-red-600 text-xs rounded hover:bg-red-50">
                        {t.delete}
                      </button>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
          {adding && (
            <tr className="border-b border-[var(--color-border-divider)]">
              <td className="py-2 pr-2">
                <Input
                  fullWidth={false}
                  className="w-16"
                  placeholder="XX"
                  maxLength={4}
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                />
              </td>
              <td className="py-2 pr-2">
                <Input value={form.name_fr} onChange={(e) => setForm({ ...form, name_fr: e.target.value })} />
              </td>
              <td className="py-2 pr-2">
                <Input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
              </td>
              <td className="py-2 pr-2">
                <Select
                  value={form.pl_section}
                  onChange={(e) => setForm({ ...form, pl_section: e.target.value as ExpenseCategory["pl_section"] })}
                >
                  <option value="operating">{t.pl_operating}</option>
                  <option value="social_charges">{t.pl_social_charges}</option>
                </Select>
              </td>
              <td className="py-2 flex gap-1">
                <button type="button" onClick={handleSaveNew} className="px-2 py-1 bg-accent text-white text-xs rounded hover:bg-accent-hover">
                  {t.save}
                </button>
                <button type="button" onClick={() => setAdding(false)} className="px-2 py-1 border border-[var(--color-input-border)] text-xs rounded hover:bg-[var(--color-hover-row)]">
                  {t.cancel}
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!adding && !editingCode && (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setForm({ code: "", name_fr: "", name_en: "", pl_section: "operating" });
          }}
          className="mt-3 px-3 py-1.5 text-sm text-accent border border-accent rounded-md hover:bg-accent-light"
        >
          + {t.add_category}
        </button>
      )}
    </div>
  );
}
