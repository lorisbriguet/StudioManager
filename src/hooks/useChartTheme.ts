import { useMemo } from "react";
import { useAppStore } from "../stores/app-store";

export function useChartTheme() {
  const dark = useAppStore((s) => s.darkMode);

  return useMemo(
    () => ({
      gridStroke: dark ? "#1a1a1a" : "#f0f0f0",
      tickFill: dark ? "#888" : "#999",
      tooltipStyle: {
        fontSize: 12,
        borderRadius: 8,
        border: "none",
        backgroundColor: dark ? "#161616" : "#ffffff",
        color: dark ? "#e5e5e5" : undefined,
        boxShadow: dark
          ? "0 4px 12px rgba(0,0,0,0.4)"
          : "0 4px 12px rgba(0,0,0,0.08)",
      } as React.CSSProperties,
      cursorFill: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
      pieItemStyle: dark ? { color: "#e5e5e5" } : undefined,
    }),
    [dark]
  );
}
