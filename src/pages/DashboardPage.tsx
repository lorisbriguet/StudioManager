import { useState, useCallback, useEffect } from "react";
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from "react-grid-layout";
import type { Layout, ResponsiveLayouts } from "react-grid-layout";
import { Plus, X, RotateCcw } from "lucide-react";
import { useDashboardStore, WIDGET_CATALOG, type WidgetType } from "../stores/dashboard-store";
import { renderWidget } from "../components/dashboard/widgets";
import { PageHeader, Button } from "../components/ui";
import { useT } from "../i18n/useT";
import "react-grid-layout/css/styles.css";

const ROW_HEIGHT = 40;

function lockSelection() {
  document.body.classList.add("grid-interacting");
  window.getSelection()?.removeAllRanges();
}
function unlockSelection() {
  document.body.classList.remove("grid-interacting");
}

export function DashboardPage() {
  const { widgets, layout, setLayout, addWidget, removeWidget, resetDashboard } = useDashboardStore();
  const [showWidgetPanel, setShowWidgetPanel] = useState(false);
  const { width, containerRef, mounted } = useContainerWidth();
  const t = useT();

  const handleLayoutChange = useCallback((currentLayout: Layout, _allLayouts: ResponsiveLayouts) => {
    setLayout([...currentLayout]);
  }, [setLayout]);

  // Block selectstart event while grid is being dragged/resized
  useEffect(() => {
    const block = (e: Event) => {
      if (document.body.classList.contains("grid-interacting")) e.preventDefault();
    };
    document.addEventListener("selectstart", block);
    return () => document.removeEventListener("selectstart", block);
  }, []);

  return (
    <div ref={containerRef} className="overflow-x-hidden">
      <PageHeader title={t.dashboard}>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setShowWidgetPanel(!showWidgetPanel)}
          className={showWidgetPanel ? "border-accent text-accent bg-accent-light" : ""}
        >
          {t.add}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<RotateCcw size={14} />}
          onClick={resetDashboard}
          title={t.retry}
        />
      </PageHeader>

      {/* Widget store panel */}
      {showWidgetPanel && (() => {
        const categories = [...new Set(WIDGET_CATALOG.map((e) => e.category))];
        return (
          <div className="mb-4 border border-gray-100 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-medium">{t.add}</h2>
              <button type="button" onClick={() => setShowWidgetPanel(false)} className="text-muted hover:text-gray-900">
                <X size={14} />
              </button>
            </div>
            {categories.map((cat) => (
              <div key={cat} className="mb-3">
                <div className="text-[10px] text-muted uppercase tracking-wide mb-1.5 capitalize">{cat}</div>
                <div className="grid grid-cols-5 gap-2">
                  {WIDGET_CATALOG.filter((e) => e.category === cat).map((entry) => {
                    const label = t[entry.labelKey as keyof typeof t] ?? entry.labelKey;
                    const alreadyUsed = widgets.some((w) => w.type === entry.type);
                    return (
                      <button
                        key={entry.type}
                        type="button"
                        disabled={alreadyUsed}
                        onClick={() => { addWidget(entry.type as WidgetType); setShowWidgetPanel(false); }}
                        className={`text-left px-3 py-2 text-sm border rounded-md transition-colors ${
                          alreadyUsed
                            ? "border-gray-100 text-muted/50 cursor-not-allowed opacity-40"
                            : "border-gray-200 hover:bg-gray-50 dark:hover:bg-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="font-medium text-xs">{label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Grid layout */}
      {mounted && width > 0 && (
        <ResponsiveGridLayout
          width={width}
          layouts={{ lg: layout }}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4 }}
          rowHeight={ROW_HEIGHT}
          onLayoutChange={handleLayoutChange}
          onDragStart={lockSelection}
          onDragStop={unlockSelection}
          onResizeStart={lockSelection}
          onResizeStop={unlockSelection}
          resizeConfig={{ enabled: true, handles: ["s", "w", "e", "n", "sw", "nw", "se", "ne"] }}
          compactor={verticalCompactor}
          margin={[12, 12] as [number, number]}
          autoSize
        >
          {widgets.map((widget) => (
            <div key={widget.id} className="border border-gray-100 rounded-lg bg-white dark:bg-gray-100 overflow-hidden relative group cursor-grab active:cursor-grabbing">
              {/* Remove button */}
              <button
                type="button"
                onClick={() => removeWidget(widget.id)}
                className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-red-600 p-0.5"
              >
                <X size={12} />
              </button>
              {renderWidget(widget.type)}
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
