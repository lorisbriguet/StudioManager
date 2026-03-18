import { useState, useRef, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { Moon, Sun, Monitor, FolderOpen, HardDrive, ChevronDown, RotateCcw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { purgeAllCalendarEvents, syncAllExisting, listWritableCalendars } from "../lib/appleCalendar";
import { createBackup, listBackups, restoreFromBackup } from "../lib/backup";
import { useAppStore, ACCENT_PRESETS, type DateFormatOption, type AccentPreset, type ProjectOpenMode } from "../stores/app-store";
import { useT } from "../i18n/useT";
import type { AppLanguage } from "../i18n/ui";
import { UpdateChecker } from "../components/UpdateChecker";

type SettingsCategory = "general" | "appearance" | "behavior" | "calendar" | "updates" | "backup";

export function SettingsPage() {
  const darkMode = useAppStore((s) => s.darkMode);
  const toggleDarkMode = useAppStore((s) => s.toggleDarkMode);
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
  const t = useT();

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

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
        console.error("Sync failed:", e);
        toast.error(t.toast_failed_sync);
      } finally {
        setSyncing(false);
      }
    }
  };

  const browseBackupDir = async (secondary?: boolean) => {
    const dir = await open({ directory: true, title: t.backup_directory });
    if (typeof dir === "string") {
      if (secondary) setBackupPath2(dir);
      else setBackupPath(dir);
    }
  };

  const runBackup = async () => {
    if (!backupPath) {
      toast.error(t.toast_backup_dir_first);
      return;
    }
    setBacking(true);
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
    if (!confirm(t.restore_confirm)) return;
    setRestoring(true);
    try {
      await restoreFromBackup(`${backupPath}/${selectedBackup}`);
      toast.success(t.toast_restore_success);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast.error(`${t.toast_restore_failed}: ${String(e)}`);
    } finally {
      setRestoring(false);
    }
  };

  const categories: { key: SettingsCategory; label: string }[] = [
    { key: "general", label: t.general },
    { key: "appearance", label: t.appearance },
    { key: "behavior", label: t.behavior },
    { key: "calendar", label: t.calendar_sync },
    { key: "updates", label: t.updates },
    { key: "backup", label: t.backup },
  ];

  return (
    <div className="flex gap-0 h-full -m-8">
      {/* Category sidebar */}
      <div className="w-56 shrink-0 border-r border-gray-200 py-6">
        <h1 className="text-xl font-semibold px-6 mb-6">{t.settings}</h1>
        <nav className="space-y-0.5 px-3">
          {categories.map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveCategory(cat.key)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                activeCategory === cat.key
                  ? "bg-accent-light text-accent font-medium"
                  : "text-muted hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </nav>
        {appVersion && (
          <p className="text-[11px] text-muted px-6 mt-8">StudioManager v{appVersion}</p>
        )}
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl space-y-8">
          {activeCategory === "general" && (
            <>
              {/* Language */}
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                  {t.app_language}
                </h2>
                <div className="flex gap-3">
                  {(["EN", "FR"] as AppLanguage[]).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setLanguage(lang)}
                      className={`px-6 py-3 rounded-lg border-2 transition-colors text-sm font-medium ${
                        language === lang
                          ? "border-accent bg-accent-light text-accent"
                          : "border-gray-200 text-muted hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {lang === "EN" ? "English" : "Francais"}
                    </button>
                  ))}
                </div>
              </section>

              {/* Export / PDF Language */}
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                  {t.export_language}
                </h2>
                <div className="flex gap-3">
                  {(["EN", "FR"] as AppLanguage[]).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setExportLanguage(lang)}
                      className={`px-6 py-3 rounded-lg border-2 transition-colors text-sm font-medium ${
                        exportLanguage === lang
                          ? "border-accent bg-accent-light text-accent"
                          : "border-gray-200 text-muted hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {lang === "EN" ? "English" : "Francais"}
                    </button>
                  ))}
                </div>
              </section>

              {/* Date Format */}
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                  {t.date_format}
                </h2>
                <div className="flex gap-3">
                  {(["dd.MM.yyyy", "dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd"] as DateFormatOption[]).map(
                    (fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => setDateFormat(fmt)}
                        className={`px-4 py-3 rounded-lg border-2 transition-colors text-sm font-medium ${
                          dateFormat === fmt
                            ? "border-accent bg-accent-light text-accent"
                            : "border-gray-200 text-muted hover:border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {fmt === "dd.MM.yyyy" && "05.03.2026"}
                        {fmt === "dd/MM/yyyy" && "05/03/2026"}
                        {fmt === "MM/dd/yyyy" && "03/05/2026"}
                        {fmt === "yyyy-MM-dd" && "2026-03-05"}
                        <div className="text-[10px] mt-1 opacity-60">{fmt}</div>
                      </button>
                    )
                  )}
                </div>
              </section>
            </>
          )}

          {activeCategory === "appearance" && (
            <>
              {/* Theme */}
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                  {t.appearance}
                </h2>
                <div className="flex gap-3">
                  <ThemeOption
                    label={t.light}
                    icon={<Sun size={20} />}
                    active={!darkMode}
                    onClick={() => darkMode && toggleDarkMode()}
                  />
                  <ThemeOption
                    label={t.dark}
                    icon={<Moon size={20} />}
                    active={darkMode}
                    onClick={() => !darkMode && toggleDarkMode()}
                  />
                  <ThemeOption
                    label={t.system}
                    icon={<Monitor size={20} />}
                    active={false}
                    onClick={() => {
                      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                      if (systemDark !== darkMode) toggleDarkMode();
                      localStorage.removeItem("darkMode");
                    }}
                  />
                </div>
              </section>

              {/* Accent Color */}
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                  {t.accent_color}
                </h2>
                <AccentColorPicker
                  presets={ACCENT_PRESETS}
                  value={accentColor}
                  onChange={setAccentColor}
                />
              </section>
            </>
          )}

          {activeCategory === "behavior" && (
            <>
              {/* Project Open Mode */}
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                  {t.project_open_mode}
                </h2>
                <div className="flex gap-3">
                  {(["peek", "page"] as ProjectOpenMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setProjectOpenMode(mode)}
                      className={`px-4 py-3 rounded-lg border-2 transition-colors text-sm font-medium ${
                        projectOpenMode === mode
                          ? "border-accent bg-accent-light text-accent"
                          : "border-gray-200 text-muted hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {mode === "peek" ? t.side_peek : t.full_page}
                      <div className="text-[10px] mt-1 opacity-60">
                        {mode === "peek" ? t.peek_desc : t.page_desc}
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              {/* Show Tasks Page */}
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                  {t.show_tasks_page}
                </h2>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div
                    onClick={() => setShowTasksPage(!showTasksPage)}
                    className={`relative w-10 h-6 rounded-full transition-colors ${
                      showTasksPage ? "bg-accent" : "bg-gray-300"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        showTasksPage ? "translate-x-4" : ""
                      }`}
                    />
                  </div>
                  <span className="text-sm">{t.show_tasks_page_desc}</span>
                </label>
              </section>
            </>
          )}

          {activeCategory === "calendar" && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                {t.calendar_sync}
              </h2>
              <div className="space-y-3 max-w-lg">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    {t.target_calendar}
                  </label>
                  <div className="flex items-center gap-2">
                    <select
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
                      className="border border-gray-200 rounded-md px-3 py-2 text-sm"
                    >
                      <option value="">{t.select_calendar}</option>
                      {availableCalendars.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                      {calendarName && !availableCalendars.includes(calendarName) && (
                        <option value={calendarName}>{calendarName}</option>
                      )}
                    </select>
                    {loadingCalendars && <span className="text-xs text-muted">{t.loading}</span>}
                  </div>
                  <p className="text-xs text-muted mt-1">
                    {t.calendar_hint}
                  </p>
                </div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div
                    onClick={() => {
                      if (!calendarName && !calendarSync) {
                        toast.error(t.toast_select_calendar);
                        return;
                      }
                      handleCalendarToggle();
                    }}
                    className={`relative w-10 h-6 rounded-full transition-colors ${
                      calendarSync ? "bg-accent" : "bg-gray-300"
                    } ${syncing ? "opacity-50 pointer-events-none" : ""}`}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        calendarSync ? "translate-x-4" : ""
                      }`}
                    />
                  </div>
                  <span className="text-sm">
                    {syncing ? t.syncing : t.sync_to_apple}
                  </span>
                </label>
              </div>
            </section>
          )}

          {activeCategory === "updates" && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                {t.updates}
              </h2>
              <UpdateChecker />
            </section>
          )}

          {activeCategory === "backup" && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
                {t.backup}
              </h2>
              <p className="text-xs text-muted mb-3">
                {t.backup_desc}
              </p>
              <div className="space-y-3 max-w-lg">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    {t.backup_directory}
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={backupPath}
                      readOnly
                      placeholder={t.not_set}
                      className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-sm bg-gray-50 dark:bg-gray-100"
                    />
                    <button
                      type="button"
                      onClick={() => browseBackupDir()}
                      className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-md text-sm hover:bg-gray-50"
                    >
                      <FolderOpen size={14} /> {t.browse}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    {t.backup_directory_2}
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={backupPath2}
                      readOnly
                      placeholder={t.not_set}
                      className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-sm bg-gray-50 dark:bg-gray-100"
                    />
                    <button
                      type="button"
                      onClick={() => browseBackupDir(true)}
                      className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-md text-sm hover:bg-gray-50"
                    >
                      <FolderOpen size={14} /> {t.browse}
                    </button>
                    {backupPath2 && (
                      <button
                        type="button"
                        onClick={() => setBackupPath2("")}
                        className="px-2 py-2 border border-gray-200 rounded-md text-sm text-muted hover:bg-gray-50"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    {t.keep_last_n}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={maxBackups}
                    onChange={(e) => setMaxBackups(Math.max(1, Number(e.target.value) || 5))}
                    className="w-24 border border-gray-200 rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    {t.auto_backup_interval}
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={autoBackupInterval}
                      onChange={(e) => setAutoBackupInterval(Number(e.target.value))}
                      className="border border-gray-200 rounded-md px-3 py-2 text-sm"
                    >
                      <option value={0}>{t.disabled}</option>
                      <option value={1440}>{t.daily}</option>
                      <option value={10080}>{t.weekly}</option>
                      <option value={20160}>{t.biweekly}</option>
                      <option value={43200}>{t.monthly}</option>
                    </select>
                    {autoBackupInterval > 0 && lastAutoBackup > 0 && (
                      <span className="text-xs text-muted">
                        Last: {new Date(lastAutoBackup).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={runBackup}
                    disabled={backing || !backupPath}
                    className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover disabled:opacity-50"
                  >
                    <HardDrive size={14} />
                    {backing ? t.backing_up : t.backup_now}
                  </button>
                </div>

                {/* Restore from backup */}
                <div className="pt-4 border-t border-gray-200 mt-4">
                  <label className="block text-xs font-medium text-muted mb-2">
                    {t.restore_from_backup}
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedBackup}
                      onChange={(e) => setSelectedBackup(e.target.value)}
                      onFocus={() => {
                        if (availableBackups.length === 0 && !loadingBackups) {
                          loadBackupList();
                        }
                      }}
                      disabled={!backupPath || restoring}
                      className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-sm"
                    >
                      {availableBackups.length === 0 && !loadingBackups && (
                        <option value="">{backupPath ? t.select_backup : t.toast_set_backup_dir}</option>
                      )}
                      {loadingBackups && <option value="">{t.loading}</option>}
                      {availableBackups.map((name) => (
                        <option key={name} value={name}>
                          {name.replace("backup-", "")}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={runRestore}
                      disabled={restoring || !selectedBackup || !backupPath}
                      className="flex items-center gap-1.5 px-4 py-2 border border-red-300 text-red-600 text-sm rounded-md hover:bg-red-50 disabled:opacity-50"
                    >
                      <RotateCcw size={14} />
                      {restoring ? t.restoring : t.restore}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ThemeOption({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-2 px-6 py-4 rounded-lg border-2 transition-colors ${
        active
          ? "border-accent bg-accent-light text-accent"
          : "border-gray-200 text-muted hover:border-gray-300 hover:bg-gray-50"
      }`}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative w-56" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 border border-gray-200 rounded-md text-sm hover:border-gray-300 transition-colors"
      >
        <div
          className="w-4 h-4 rounded-full shrink-0"
          style={{ backgroundColor: value.color }}
        />
        <span className="flex-1 text-left">{value.name}</span>
        <ChevronDown size={14} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto border border-gray-200 rounded-md bg-white dark:bg-gray-100 shadow-lg py-1">
          {presets.map((preset) => (
            <button
              key={preset.color}
              type="button"
              onClick={() => {
                onChange(preset);
                setOpen(false);
              }}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors ${
                value.color === preset.color ? "bg-accent-light text-accent font-medium" : ""
              }`}
            >
              <div
                className="w-4 h-4 rounded-full shrink-0"
                style={{ backgroundColor: preset.color }}
              />
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
