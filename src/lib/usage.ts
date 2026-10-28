import { invoke } from "@tauri-apps/api/core";
import type { UIKey } from "../i18n/ui";

/** How fast a window is being used up, projected to its reset. */
export interface Pace {
  projectedPercentAtReset: number;
  /** Epoch ms when use reaches 100% before the reset; null when it will not. */
  hitsFullAt: number | null;
}

export interface Meter {
  /** `five_hour`, `seven_day` or `seven_day_<scope>`. */
  window: string;
  /** English fallback; show `usageWindowLabel` instead. */
  label: string;
  percent: number;
  /** Epoch ms. */
  resetsAt: number;
  pace: Pace | null;
}

export interface UsageLimits {
  meters: Meter[];
  /** StudioManager's status line is installed in Claude Code's settings. */
  setUp: boolean;
  /** Epoch ms of the last capture. */
  savedAt: number | null;
}

export function getUsageLimits(): Promise<UsageLimits> {
  return invoke<UsageLimits>("agents_usage_limits");
}

type Labels = Pick<
  Record<UIKey, string>,
  "usage_window_five_hour" | "usage_window_weekly" | "usage_window_weekly_scoped"
>;

/** "Opus" / "Claude Design" from `seven_day_opus` / `seven_day_claude_design`. */
export function scopeName(window: string): string {
  return window
    .replace(/^seven_day_?/, "")
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The meter's name in the app's language. */
export function usageWindowLabel(window: string, t: Labels): string {
  if (window === "five_hour") return t.usage_window_five_hour;
  if (window === "seven_day") return t.usage_window_weekly;
  return t.usage_window_weekly_scoped.replace("{scope}", scopeName(window));
}
