import { create } from "zustand";
import type { AppLanguage } from "../i18n/ui";
import { getThemeById } from "../lib/themes";
import type { ThemeDefinition } from "../types/theme";

function getInitialDarkMode(): boolean {
  const stored = localStorage.getItem("darkMode");
  if (stored !== null) return stored === "true";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyDarkClass(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

export type DateFormatOption = "dd.MM.yyyy" | "dd/MM/yyyy" | "MM/dd/yyyy" | "yyyy-MM-dd";
export type ProjectOpenMode = "peek" | "page";

export interface AccentPreset {
  name: string;
  color: string;
  light: string;
  darkLight: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  // Vibrant
  { name: "Blue",    color: "#2563eb", light: "#dbeafe", darkLight: "#172554" },
  { name: "Indigo",  color: "#4f46e5", light: "#e0e7ff", darkLight: "#1e1b4b" },
  { name: "Violet",  color: "#7c3aed", light: "#ede9fe", darkLight: "#2e1065" },
  { name: "Pink",    color: "#db2777", light: "#fce7f3", darkLight: "#500724" },
  { name: "Rose",    color: "#e11d48", light: "#ffe4e6", darkLight: "#4c0519" },
  { name: "Orange",  color: "#ea580c", light: "#fff7ed", darkLight: "#431407" },
  { name: "Emerald", color: "#059669", light: "#d1fae5", darkLight: "#022c22" },
  { name: "Teal",    color: "#0d9488", light: "#ccfbf1", darkLight: "#042f2e" },
  { name: "Cyan",    color: "#0891b2", light: "#cffafe", darkLight: "#083344" },
  // Earthy / Pastel
  { name: "Terracotta", color: "#b45939", light: "#fbe9e1", darkLight: "#3b1a0e" },
  { name: "Clay",       color: "#a0755a", light: "#f5ebe3", darkLight: "#2e1e12" },
  { name: "Sage",       color: "#6b8f71", light: "#e8f0e9", darkLight: "#1a2e1c" },
  { name: "Olive",      color: "#7c8a3e", light: "#f0f2e0", darkLight: "#262b10" },
  { name: "Sand",       color: "#b59e6c", light: "#f7f2e8", darkLight: "#302612" },
  { name: "Slate",      color: "#64748b", light: "#f1f5f9", darkLight: "#0f172a" },
  { name: "Mauve",      color: "#9d7aa0", light: "#f3ecf4", darkLight: "#2a1a2c" },
  { name: "Dusty Rose", color: "#c08b8b", light: "#faf0f0", darkLight: "#361e1e" },
  { name: "Forest",     color: "#4a7c59", light: "#e5f0e8", darkLight: "#142616" },
  { name: "Stone",      color: "#8a8578", light: "#f2f0ed", darkLight: "#252420" },
];

function applyAccentColor(color: string, light: string, darkLight: string) {
  const el = document.documentElement;
  el.style.setProperty("--color-accent", color);
  el.style.setProperty("--color-accent-light", light);
  el.style.setProperty("--color-accent-dark-light", darkLight);
}

function applyThemeColors(theme: ThemeDefinition) {
  const el = document.documentElement;
  const c = theme.colors;

  // Apply dark/light class
  el.classList.toggle("dark", theme.mode === "dark");

  // Body colors
  document.body.style.background = c.bg;
  document.body.style.color = c.text;

  // CSS custom properties
  el.style.setProperty("--color-sidebar", c.sidebar);
  el.style.setProperty("--color-sidebar-border", c.sidebarBorder);
  el.style.setProperty("--color-accent", c.accent);
  el.style.setProperty("--color-accent-light", c.accentLight);
  el.style.setProperty("--color-accent-hover", c.accentHover);
  el.style.setProperty("--color-accent-dark-light", c.accentLight);
  el.style.setProperty("--color-muted", c.textMuted);
  el.style.setProperty("--color-success", c.success);
  el.style.setProperty("--color-warning", c.warning);
  el.style.setProperty("--color-danger", c.danger);
  el.style.setProperty("--color-surface", c.surface);
  el.style.setProperty("--color-border", c.border);
  el.style.setProperty("--color-chart-1", c.chart1);
  el.style.setProperty("--color-chart-2", c.chart2);
  el.style.setProperty("--color-chart-3", c.chart3);
  el.style.setProperty("--color-chart-4", c.chart4);
  el.style.setProperty("--color-chart-5", c.chart5);
  el.style.setProperty("--color-chart-6", c.chart6);
  el.style.setProperty("--color-chart-7", c.chart7);
  el.style.setProperty("--color-chart-8", c.chart8);

  // Dark mode gray overrides for non-default themes
  if (theme.mode === "dark") {
    el.style.setProperty("--color-gray-50", c.bg);
    el.style.setProperty("--color-gray-100", c.surface);
    el.style.setProperty("--color-gray-200", c.border);
    el.style.setProperty("--color-gray-300", c.sidebarBorder);
  } else {
    // Light theme: remove any dark-mode gray overrides that may linger from a previous dark theme
    el.style.removeProperty("--color-gray-50");
    el.style.removeProperty("--color-gray-100");
    el.style.removeProperty("--color-gray-200");
    el.style.removeProperty("--color-gray-300");
  }
}

function getInitialAccent(): AccentPreset {
  const stored = localStorage.getItem("accentColor");
  if (stored) {
    const found = ACCENT_PRESETS.find((p) => p.color === stored);
    if (found) return found;
  }
  return ACCENT_PRESETS[0];
}

export interface AppState {
  commandPaletteOpen: boolean;
  quickTimerOpen: boolean;
  sidebarCollapsed: boolean;
  darkMode: boolean;
  themeId: string;
  testMode: boolean;
  presentationMode: boolean;

  reduceMotion: boolean;
  nativeNotifications: boolean;
  dateFormat: DateFormatOption;
  accentColor: AccentPreset;
  calendarSync: boolean;
  calendarName: string;
  backupPath: string;
  backupPath2: string;
  maxBackups: number;
  autoBackupInterval: number; // minutes, 0 = disabled
  lastAutoBackup: number; // timestamp
  projectOpenMode: ProjectOpenMode;
  showTasksPage: boolean;
  showIncome: boolean;
  showTimeOverview: boolean;
  language: AppLanguage;
  exportLanguage: AppLanguage;
  clientsSortKey: string;
  clientsSortDir: "asc" | "desc";
  activeTimer: {
    taskId: number;
    projectId: number;
    startedAt: number; // timestamp
    projectName?: string;
  } | null;
  currentContext: {
    clientId?: string;
    projectId?: number;
  };
  startTimer: (taskId: number, projectId: number, projectName?: string) => void;
  stopTimer: () => { taskId: number; projectId: number; durationMinutes: number } | null;
  setClientsSortKey: (key: string) => void;
  setClientsSortDir: (dir: "asc" | "desc") => void;
  setLanguage: (lang: AppLanguage) => void;
  setExportLanguage: (lang: AppLanguage) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;
  toggleQuickTimer: () => void;
  closeQuickTimer: () => void;
  toggleSidebar: () => void;
  toggleDarkMode: () => void;
  setDateFormat: (fmt: DateFormatOption) => void;
  setAccentColor: (preset: AccentPreset) => void;
  setCalendarSync: (enabled: boolean) => void;
  setCalendarName: (name: string) => void;
  setBackupPath: (path: string) => void;
  setBackupPath2: (path: string) => void;
  setMaxBackups: (count: number) => void;
  setAutoBackupInterval: (minutes: number) => void;
  setLastAutoBackup: (ts: number) => void;
  setProjectOpenMode: (mode: ProjectOpenMode) => void;
  setShowTasksPage: (show: boolean) => void;
  setShowIncome: (show: boolean) => void;
  setShowTimeOverview: (show: boolean) => void;
  setContext: (ctx: Partial<AppState["currentContext"]>) => void;
  clearContext: () => void;
  setTheme: (themeId: string) => void;
  setReduceMotion: (enabled: boolean) => void;
  setTestMode: (enabled: boolean) => void;
  setPresentationMode: (enabled: boolean) => void;
  setNativeNotifications: (enabled: boolean) => void;
}

const initialDark = getInitialDarkMode();
applyDarkClass(initialDark);

if (localStorage.getItem("reduceMotion") === "true") {
  document.documentElement.classList.add("reduce-motion");
}

const initialAccent = getInitialAccent();
const initialThemeId = localStorage.getItem("themeId") ?? "default-light";
const initialTheme = getThemeById(initialThemeId);
if (initialTheme && initialThemeId !== "default-light") {
  applyThemeColors(initialTheme);
} else {
  applyAccentColor(initialAccent.color, initialDark ? initialAccent.darkLight : initialAccent.light, initialAccent.darkLight);
}

// Derive the effective accent for the initial theme so the picker stays in sync
function getInitialAccentForTheme(): AccentPreset {
  if (initialTheme && initialThemeId !== "default-light") {
    const matchingPreset = ACCENT_PRESETS.find(
      (p) => p.color.toLowerCase() === initialTheme.colors.accent.toLowerCase()
    );
    return matchingPreset ?? {
      name: "Theme",
      color: initialTheme.colors.accent,
      light: initialTheme.colors.accentLight,
      darkLight: initialTheme.colors.accentLight,
    };
  }
  return initialAccent;
}
const effectiveInitialAccent = getInitialAccentForTheme();

export const useAppStore = create<AppState>((set, get) => ({
  commandPaletteOpen: false,
  quickTimerOpen: false,
  sidebarCollapsed: false,
  darkMode: initialDark,
  themeId: localStorage.getItem("themeId") ?? "default-light",
  testMode: localStorage.getItem("testMode") === "true",
  presentationMode: localStorage.getItem("presentationMode") === "true",

  reduceMotion: localStorage.getItem("reduceMotion") === "true",
  nativeNotifications: localStorage.getItem("nativeNotifications") !== "false",
  dateFormat: (localStorage.getItem("dateFormat") as DateFormatOption) ?? "dd.MM.yyyy",
  accentColor: effectiveInitialAccent,
  calendarSync: localStorage.getItem("calendarSync") === "true",
  calendarName: localStorage.getItem("calendarName") ?? "",
  backupPath: localStorage.getItem("backupPath") ?? "",
  backupPath2: localStorage.getItem("backupPath2") ?? "",
  maxBackups: Number(localStorage.getItem("maxBackups")) || 5,
  autoBackupInterval: Number(localStorage.getItem("autoBackupInterval")) || 0,
  lastAutoBackup: Number(localStorage.getItem("lastAutoBackup")) || 0,
  projectOpenMode: (localStorage.getItem("projectOpenMode") as ProjectOpenMode) ?? "peek",
  showTasksPage: localStorage.getItem("showTasksPage") !== "false",
  showIncome: localStorage.getItem("showIncome") === "true",
  showTimeOverview: localStorage.getItem("showTimeOverview") === "true",
  language: (localStorage.getItem("appLanguage") as AppLanguage) ?? "EN",
  exportLanguage: (localStorage.getItem("exportLanguage") as AppLanguage) ?? "FR",
  clientsSortKey: localStorage.getItem("clientsSortKey") ?? "name",
  clientsSortDir: (localStorage.getItem("clientsSortDir") as "asc" | "desc") ?? "asc",
  activeTimer: null,
  currentContext: {},
  startTimer: (taskId, projectId, projectName) =>
    set((s) => {
      // Stop any existing timer (discard result — caller should handle via stopTimer first)
      if (s.activeTimer) return { activeTimer: { taskId, projectId, startedAt: Date.now(), projectName } };
      return { activeTimer: { taskId, projectId, startedAt: Date.now(), projectName } };
    }),
  stopTimer: () => {
    const { activeTimer } = get();
    if (!activeTimer) return null;
    const elapsed = Date.now() - activeTimer.startedAt;
    const durationMinutes = Math.max(1, Math.round(elapsed / 60000));
    const result = {
      taskId: activeTimer.taskId,
      projectId: activeTimer.projectId,
      durationMinutes,
    };
    set({ activeTimer: null });
    return result;
  },
  setClientsSortKey: (key) => {
    localStorage.setItem("clientsSortKey", key);
    set({ clientsSortKey: key });
  },
  setClientsSortDir: (dir) => {
    localStorage.setItem("clientsSortDir", dir);
    set({ clientsSortDir: dir });
  },
  setLanguage: (lang) => {
    localStorage.setItem("appLanguage", lang);
    set({ language: lang });
  },
  setExportLanguage: (lang) => {
    localStorage.setItem("exportLanguage", lang);
    set({ exportLanguage: lang });
  },
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () =>
    set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  toggleQuickTimer: () => set((s) => ({ quickTimerOpen: !s.quickTimerOpen })),
  closeQuickTimer: () => set({ quickTimerOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleDarkMode: () =>
    set((s) => {
      const next = !s.darkMode;
      localStorage.setItem("darkMode", String(next));
      applyDarkClass(next);
      applyAccentColor(
        s.accentColor.color,
        next ? s.accentColor.darkLight : s.accentColor.light,
        s.accentColor.darkLight
      );
      return { darkMode: next };
    }),
  setDateFormat: (fmt) => {
    localStorage.setItem("dateFormat", fmt);
    set({ dateFormat: fmt });
  },
  setAccentColor: (preset) =>
    set((s) => {
      localStorage.setItem("accentColor", preset.color);
      applyAccentColor(
        preset.color,
        s.darkMode ? preset.darkLight : preset.light,
        preset.darkLight
      );
      return { accentColor: preset };
    }),
  setCalendarSync: (enabled) => {
    localStorage.setItem("calendarSync", String(enabled));
    set({ calendarSync: enabled });
  },
  setCalendarName: (name) => {
    localStorage.setItem("calendarName", name);
    set({ calendarName: name });
  },
  setBackupPath: (path) => {
    localStorage.setItem("backupPath", path);
    set({ backupPath: path });
  },
  setBackupPath2: (path) => {
    localStorage.setItem("backupPath2", path);
    set({ backupPath2: path });
  },
  setMaxBackups: (count) => {
    localStorage.setItem("maxBackups", String(count));
    set({ maxBackups: count });
  },
  setAutoBackupInterval: (minutes) => {
    localStorage.setItem("autoBackupInterval", String(minutes));
    set({ autoBackupInterval: minutes });
  },
  setLastAutoBackup: (ts) => {
    localStorage.setItem("lastAutoBackup", String(ts));
    set({ lastAutoBackup: ts });
  },
  setProjectOpenMode: (mode) => {
    localStorage.setItem("projectOpenMode", mode);
    set({ projectOpenMode: mode });
  },
  setShowTasksPage: (show) => {
    localStorage.setItem("showTasksPage", String(show));
    set({ showTasksPage: show });
  },
  setShowIncome: (show) => {
    localStorage.setItem("showIncome", String(show));
    set({ showIncome: show });
  },
  setShowTimeOverview: (show) => {
    localStorage.setItem("showTimeOverview", String(show));
    set({ showTimeOverview: show });
  },
  setContext: (ctx) =>
    set((s) => ({ currentContext: { ...s.currentContext, ...ctx } })),
  clearContext: () => set({ currentContext: {} }),
  setTheme: (themeId) =>
    set(() => {
      localStorage.setItem("themeId", themeId);
      const theme = getThemeById(themeId);
      if (theme) {
        applyThemeColors(theme);
        // Sync accentColor state to match the theme's accent
        const matchingPreset = ACCENT_PRESETS.find(
          (p) => p.color.toLowerCase() === theme.colors.accent.toLowerCase()
        );
        const newAccent: AccentPreset = matchingPreset ?? {
          name: "Theme",
          color: theme.colors.accent,
          light: theme.colors.accentLight,
          darkLight: theme.colors.accentLight,
        };
        localStorage.setItem("accentColor", newAccent.color);
        return { themeId, darkMode: theme.mode === "dark", accentColor: newAccent };
      }
      return { themeId };
    }),
  setReduceMotion: (enabled) => {
    localStorage.setItem("reduceMotion", String(enabled));
    document.documentElement.classList.toggle("reduce-motion", enabled);
    set({ reduceMotion: enabled });
  },
  setTestMode: (enabled) => {
    localStorage.setItem("testMode", String(enabled));
    if (!enabled) localStorage.removeItem("testMode");
    set({ testMode: enabled });
  },
  setPresentationMode: (enabled) => {
    localStorage.setItem("presentationMode", String(enabled));
    if (!enabled) localStorage.removeItem("presentationMode");
    set({ presentationMode: enabled });
  },
  setNativeNotifications: (enabled) => {
    localStorage.setItem("nativeNotifications", String(enabled));
    set({ nativeNotifications: enabled });
  },
}));
