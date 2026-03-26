import { useMemo } from "react";
import { useAppStore } from "../stores/app-store";

export function useChartTheme() {
  const dark = useAppStore((s) => s.darkMode);

  return useMemo(
    () => ({
      gridStroke: dark ? "#2d2d2d" : "#f0f0f0",
      tickFill: dark ? "#a3a3a3" : undefined,
      tooltipStyle: {
        fontSize: 12,
        borderRadius: 8,
        border: "1px solid",
        borderColor: dark ? "#2d2d2d" : "#e5e5e5",
        backgroundColor: dark ? "#1e1e1e" : "#fff",
        color: dark ? "#e5e5e5" : undefined,
      } as React.CSSProperties,
      cursorFill: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
      pieItemStyle: dark ? { color: "#e5e5e5" } : undefined,
    }),
    [dark]
  );
}
