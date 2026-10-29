import { useState, useEffect, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { notify } from "../lib/notify";
import { HardDrive, RotateCcw, FlaskConical, Camera, LayoutList, Tags, Archive, Shield, Store, type LucideIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { purgeAllCalendarEvents, syncAllExisting, listWritableCalendars } from "../lib/appleCalendar";
import { syncAllUpkeepEvents } from "../lib/upkeep/calendar";
import { createBackup, listBackups, restoreFromBackup, RestoreError, validateBackupPath, isBackupRunning, setBackupRunning, isScopeDenied } from "../lib/backup";
import { resetDb } from "../db";
import { enterTestMode, enterPresentationMode } from "../lib/modes";
import { useExitMode } from "../hooks/useExitMode";
import { useConfirm } from "../lib/confirm";
import { useAppStore, ACCENT_PRESETS, type DateFormatOption, type ProjectOpenMode } from "../stores/app-store";
import { THEMES } from "../lib/themes";
import { useT } from "../i18n/useT";
import type { AppLanguage } from "../i18n/ui";
import { UpdateChecker } from "../components/UpdateChecker";
import { WorkloadTemplateManager } from "../components/workload/WorkloadTemplateManager";
import { ICONS, ICON_SIZE, Input, Select, Button, IconButton, SectionLabel, SidebarTitle, SettingRow, SettingsCard, NavItem, Tooltip, FieldError, Spinner } from "../components/ui";
import { Toggle } from "../components/ui/Toggle";
import { logError } from "../lib/log";
import { UpkeepSettingsCard } from "../components/settings/UpkeepSettingsCard";
import { AgentAccessCard } from "../components/settings/AgentAccessCard";
import { AgentsCard } from "../components/settings/AgentsCard";
import { RoutinesCard } from "../components/settings/RoutinesCard";
import { OrganisationsCard } from "../components/settings/OrganisationsCard";
import { DemoDataCard } from "../components/settings/DemoDataCard";
import { isDemoBuild } from "../lib/demoBuild";
import { AccentColorPicker } from "../components/settings/AccentColorPicker";
import { SuppliersManager } from "../components/settings/SuppliersManager";
import { ExpenseCategoryManager } from "../components/settings/ExpenseCategoryManager";
import { CustomListsManager } from "../components/settings/CustomListsManager";
import { TimeEntriesManager } from "../components/settings/TimeEntriesManager";

type SettingsCategory = "general" | "appearance" | "behavior" | "calendar" | "agents" | "upkeep" | "workload" | "organisations" | "categories" | "suppliers" | "lists" | "time_entries" | "updates" | "backup" | "sandbox" | "demo_data";

const SETTINGS_CATEGORIES_BASE: SettingsCategory[] = ["general", "appearance", "behavior", "calendar", "agents", "upkeep", "workload", "organisations", "categories", "suppliers", "lists", "time_entries", "updates", "backup"];

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
  // Inline errors for the backup folders and the target calendar
  const [backupDirError, setBackupDirError] = useState<{ which: "primary" | "secondary"; message: string } | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [availableBackups, setAvailableBackups] = useState<string[]>([]);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [availableCalendars, setAvailableCalendars] = useState<string[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [searchParams] = useSearchParams();
  // "agent_access" was merged into "agents"; old links still land there.
  const requestedCategory = searchParams.get("category") === "agent_access" ? "agents" : searchParams.get("category");
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
  const { exitMode, exiting } = useExitMode();
  const confirm = useConfirm();
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
      notify.success(t.toast_test_mode_entered);
    } catch (e) {
      notify.error(t.toast_test_mode_failed, e);
    } finally {
      setTogglingTestMode(false);
    }
  };


  const handleEnterPresentation = async () => {
    setTogglingPresentation(true);
    try {
      await enterPresentationMode();
      notify.success(t.toast_presentation_entered);
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      notify.error(t.toast_presentation_failed, e);
    } finally {
      setTogglingPresentation(false);
    }
  };


  const handleCreateSnapshot = async () => {
    setSnapshotting(true);
    try {
      await invoke<string>("snapshot_db");
      setHasSnapshotFile(true);
      notify.success(t.toast_snapshot_created);
    } catch (e) {
      notify.error(t.toast_snapshot_failed, e);
    } finally {
      setSnapshotting(false);
    }
  };

  const handleRestoreSnapshot = async () => {
    const confirmed = await confirm({
      title: t.restore_snapshot_title,
      message: t.restore_snapshot_confirm,
      confirmLabel: t.restore,
      tone: "danger",
    });
    if (!confirmed) return;
    setRestoringSnapshot(true);
    try {
      await invoke("restore_snapshot");
      await resetDb();
      notify.success(t.toast_snapshot_restored);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      notify.error(t.toast_snapshot_restore_failed, e);
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
        const count = (await syncAllExisting()) + (await syncAllUpkeepEvents());
        if (count > 0) notify.success(t.synced_events.replace("{count}", String(count)));
      } catch (e) {
        notify.error(t.toast_failed_sync, e);
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
      const which = secondary ? "secondary" : "primary";
      if (!writable) {
        setBackupDirError({ which, message: t.backup_path_not_writable });
        return;
      }
      setBackupDirError(null);
      if (secondary) setBackupPath2(dir);
      else setBackupPath(dir);
    }
  };

  const runBackup = async () => {
    if (!backupPath) return; // the button is disabled without a folder
    if (isBackupRunning()) {
      notify.info(t.backup_already_running);
      return;
    }
    setBacking(true);
    setBackupRunning(true);
    try {
      const path = await createBackup(backupPath, maxBackups);
      if (backupPath2) {
        await createBackup(backupPath2, maxBackups);
      }
      notify.success(t.backup_created.replace("{name}", path.split("/").pop() ?? ""));
    } catch (e) {
      notify.error(isScopeDenied(e) ? t.backup_path_not_allowed : t.backup_failed, e);
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
      if (isScopeDenied(e)) notify.error(t.backup_path_not_allowed, e);
      setAvailableBackups([]);
    } finally {
      setLoadingBackups(false);
    }
  };

  const runRestore = async () => {
    if (!backupPath || !selectedBackup) return; // the button is disabled until both are set
    const confirmed = await confirm({
      title: t.restore_backup_title.replace("{name}", selectedBackup),
      message: t.restore_confirm,
      confirmLabel: t.restore,
      tone: "danger",
    });
    if (!confirmed) return;
    setRestoring(true);
    try {
      const { warnings, valuesDefaulted, safetyBackup } = await restoreFromBackup(`${backupPath}/${selectedBackup}`);
      if (warnings.length > 0) {
        notify.warning(t.restore_warnings, { description: warnings.join(", ") });
      }
      const details = [
        valuesDefaulted > 0 ? t.restore_values_defaulted.replace("{count}", String(valuesDefaulted)) : null,
        t.restore_safety_created.replace("{name}", safetyBackup),
      ];
      notify.success(t.toast_restore_success, { description: details.filter(Boolean).join(" ") });
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      // Restore runs in a single transaction — on failure it rolled back
      // (the raw cause, e.g. RestoreError.detail, is in the log and behind "Details")
      const noChanges = { description: t.restore_no_changes };
      if (e instanceof RestoreError) {
        notify.error(e.code === "backup_empty" ? t.restore_backup_empty : t.restore_safety_backup_failed, e.detail ?? e, noChanges);
      } else if (isScopeDenied(e)) {
        notify.error(t.backup_path_not_allowed, e, noChanges);
      } else {
        notify.error(t.toast_restore_failed, e, noChanges);
      }
    } finally {
      setRestoring(false);
    }
  };

  const categorySections: { label: string; items: { key: SettingsCategory; label: string; icon: LucideIcon }[] }[] = [
    {
      label: t.settings_group_preferences,
      items: [
        { key: "general", label: t.general, icon: ICONS.settings },
        { key: "appearance", label: t.appearance, icon: ICONS.appearance },
        { key: "behavior", label: t.behavior, icon: ICONS.behavior },
        { key: "calendar", label: t.calendar_sync, icon: ICONS.calendar },
        { key: "agents", label: t.agents, icon: ICONS.agents },
        { key: "upkeep", label: t.upkeep_settings, icon: ICONS.upkeep },
        { key: "workload", label: t.workload_templates, icon: LayoutList },
      ],
    },
    {
      label: t.settings_group_data,
      items: [
        { key: "organisations", label: t.organisations, icon: ICONS.organisation },
        { key: "categories", label: t.expense_categories, icon: Tags },
        { key: "suppliers", label: t.suppliers, icon: Store },
        { key: "lists", label: t.custom_lists, icon: LayoutList },
        { key: "time_entries", label: t.time_entries_management, icon: ICONS.time },
        { key: "backup", label: t.backup, icon: Archive },
        ...(isDemoBuild()
          ? [
              { key: "sandbox" as const, label: t.test_mode, icon: Shield },
              { key: "demo_data" as const, label: t.demo_data, icon: ICONS.demoData },
            ]
          : []),
      ],
    },
    {
      label: t.settings_group_app,
      items: [
        { key: "updates", label: t.updates, icon: ICONS.updates },
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
    <div className="flex gap-0 flex-1 min-h-0 -m-8">
      {/* Category sidebar */}
      <div className="w-48 shrink-0 border-r border-[var(--color-border-divider)] py-5">
        <SidebarTitle className="px-5 mb-4">{t.settings}</SidebarTitle>
        <nav aria-label={t.settings} className="space-y-3 px-1">
          {categorySections.map((section) => (
            <div key={section.label}>
              <SectionLabel className="px-3 mb-1">{section.label}</SectionLabel>
              <div className="space-y-px px-1">
                {section.items.map((cat) => (
                  <NavItem
                    key={cat.key}
                    active={activeCategory === cat.key}
                    icon={cat.icon}
                    onClick={() => setActiveCategory(cat.key)}
                  >
                    {cat.label}
                  </NavItem>
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
                  variant="outline"
                  onClick={async () => {
                    const ok = await confirm({
                      title: t.reset_user_guide_title,
                      message: t.reset_user_guide_confirm,
                      confirmLabel: t.reset_user_guide_btn,
                      tone: "danger",
                    });
                    if (!ok) return;
                    try {
                      const db = await import("../db").then((m) => m.getDb());
                      const { resetUserGuide } = await import("../db/seeds/user-guide");
                      await resetUserGuide(db);
                      notify.success(t.reset_user_guide_done);
                    } catch (e) {
                      notify.error(t.error_reset_user_guide, e);
                    }
                  }}
                >
                  {t.reset_user_guide_btn}
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
                    <Tooltip key={theme.id} content={theme.name}>
                      <button
                        type="button"
                        onClick={() => setTheme(theme.id)}
                        className={`flex flex-col rounded-lg overflow-hidden border-2 transition-colors ${
                          themeId === theme.id
                            ? "border-accent shadow-control"
                            : "border-[var(--color-border-divider)] hover:border-[var(--color-input-border)]"
                        }`}
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
                    </Tooltip>
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

          {activeCategory === "agents" && (
            <div className="space-y-4">
              <AgentsCard />
              <RoutinesCard />
              <AgentAccessCard />
            </div>
          )}

          {activeCategory === "upkeep" && <UpkeepSettingsCard />}

          {activeCategory === "calendar" && (
            <SettingsCard title={t.calendar_sync} desc={t.calendar_permission_help}>
              <SettingRow label={t.target_calendar}>
                <div className="flex items-center gap-2">
                  <Select
                    value={calendarName}
                    aria-label={t.target_calendar}
                    onChange={(e) => { setCalendarName(e.target.value); setCalendarError(null); }}
                    aria-invalid={calendarError ? true : undefined}
                    aria-describedby={calendarError ? "calendar-error" : undefined}
                    onFocus={() => {
                      if (availableCalendars.length === 0 && !loadingCalendars) {
                        setLoadingCalendars(true);
                        listWritableCalendars()
                          .then(setAvailableCalendars)
                          .catch((e) => notify.error(t.toast_failed_calendars, e))
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
                  {loadingCalendars && <Spinner size={12} />}
                </div>
                {calendarError && <FieldError id="calendar-error" className="text-right">{calendarError}</FieldError>}
              </SettingRow>
              <SettingRow label={t.sync_to_apple} desc={t.calendar_hint}>
                <Toggle
                  checked={calendarSync}
                  disabled={syncing}
                  ariaLabel={t.sync_to_apple}
                  onChange={(_v: boolean) => {
                    if (!calendarName && !calendarSync) {
                      setCalendarError(t.toast_select_calendar);
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
            <SettingsCard>
              <TimeEntriesManager />
            </SettingsCard>
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
                    <span className="text-xs text-[var(--color-warning-text)] font-medium flex items-center gap-1"><FlaskConical size={ICON_SIZE.control} /> {t.test_mode_active}</span>
                    <Button variant="danger" onClick={() => void exitMode("test")} disabled={togglingTestMode || exiting === "test"}>
                      {t.exit_test_mode}
                    </Button>
                  </div>
                ) : (
                  <button type="button" onClick={handleEnterTestMode} disabled={togglingTestMode} className="flex items-center gap-1 px-2.5 py-1 bg-[var(--color-banner-test)] text-on-banner text-xs rounded-md hover:opacity-90 disabled:opacity-50">
                    {togglingTestMode ? <Spinner size={12} tone="current" /> : <FlaskConical size={ICON_SIZE.control} />}
                    {t.enter_test_mode}
                  </button>
                )}
              </SettingRow>
              </SettingsCard>

              <SettingsCard title={t.presentation_mode} desc={t.presentation_mode_desc}>
              <SettingRow label={t.presentation_mode}>
                {presentationMode ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-indigo-text)] font-medium">{t.presentation_active}</span>
                    <Button variant="danger" onClick={() => void exitMode("presentation")} disabled={togglingPresentation || exiting === "presentation"}>
                      {t.exit_presentation_mode}
                    </Button>
                  </div>
                ) : (
                  <button type="button" onClick={handleEnterPresentation} disabled={togglingPresentation || testMode} className="flex items-center gap-1 px-2.5 py-1 bg-[var(--color-banner-presentation)] text-on-banner text-xs rounded-md hover:opacity-90 disabled:opacity-50">
                    {togglingPresentation && <Spinner size={12} tone="current" />}
                    {t.enter_presentation_mode}
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
                  <Button type="button" variant="outline" icon={ICONS.openFolder} onClick={() => browseBackupDir()}>
                    {t.browse}
                  </Button>
                </div>
                {backupDirError?.which === "primary" && <FieldError className="text-right">{backupDirError.message}</FieldError>}
              </SettingRow>
              <SettingRow label={t.backup_directory_2}>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted truncate max-w-[180px]" title={backupPath2}>{backupPath2 || t.not_set}</span>
                  <Button type="button" variant="outline" icon={ICONS.openFolder} onClick={() => browseBackupDir(true)}>
                    {t.browse}
                  </Button>
                  {backupPath2 && (
                    <IconButton icon={ICONS.close} label={t.remove} size="xs" onClick={() => setBackupPath2("")} />
                  )}
                </div>
                {backupDirError?.which === "secondary" && <FieldError className="text-right">{backupDirError.message}</FieldError>}
              </SettingRow>
              <SettingRow label={t.keep_last_n}>
                <Input
                  numeric
                  min={1}
                  max={50}
                  value={maxBackups}
                  onChange={(e) => setMaxBackups(Math.max(1, Number(e.target.value) || 5))}
                  width="xs"
                  aria-label={t.keep_last_n}
                />
              </SettingRow>
              <SettingRow label={t.auto_backup_interval}>
                <div className="flex items-center gap-2">
                  <Select
                    value={autoBackupInterval}
                    aria-label={t.auto_backup_interval}
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
                <Button type="button" icon={HardDrive} onClick={runBackup} disabled={backing || !backupPath}>
                  {backing ? t.backing_up : t.backup_now}
                </Button>
              </div>
              </SettingsCard>

              <SettingsCard title={t.restore_from_backup}>
              <SettingRow label={t.select_backup}>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={selectedBackup}
                    aria-label={t.select_backup}
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
                    {loadingBackups && <option value="">{t.select_backup}</option>}
                    {availableBackups.map((name) => (
                      <option key={name} value={name}>{name.replace("backup-", "")}</option>
                    ))}
                  </Select>
                  {loadingBackups && <Spinner size={12} />}
                  <Button variant="danger" icon={RotateCcw} onClick={runRestore} disabled={restoring || !selectedBackup || !backupPath}>
                    {restoring ? t.restoring : t.restore}
                  </Button>
                </div>
              </SettingRow>
              </SettingsCard>

              <SettingsCard title={t.snapshot} desc={t.snapshot_desc}>
              <SettingRow label={t.snapshot}>
                <div className="flex items-center gap-2">
                  <Button type="button" icon={Camera} onClick={handleCreateSnapshot} loading={snapshotting} disabled={testMode}>
                    {t.create_snapshot}
                  </Button>
                  <Button variant="danger" icon={RotateCcw} onClick={handleRestoreSnapshot} loading={restoringSnapshot} disabled={!hasSnapshotFile || testMode}>
                    {t.restore_snapshot}
                  </Button>
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
