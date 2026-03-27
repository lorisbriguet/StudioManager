import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from "react-grid-layout";
import type { Layout, ResponsiveLayouts } from "react-grid-layout";
import { Plus, X, ChevronDown, Lock, Save, Trash2 } from "lucide-react";
import { useDashboardStore, WIDGET_CATALOG, type WidgetType, type DashboardWidget } from "../stores/dashboard-store";
import type { LayoutItem } from "react-grid-layout";
import { renderWidget } from "../components/dashboard/widgets";
import { PageHeader, Button } from "../components/ui";
import { useT } from "../i18n/useT";
import { useDashboardPresets, useCreateDashboardPreset, useDeleteDashboardPreset } from "../db/hooks/useDashboardPresets";
import "react-grid-layout/css/styles.css";

const ROW_HEIGHT = 40;

function lockSelection() {
  document.body.classList.add("grid-interacting");
  window.getSelection()?.removeAllRanges();
}
function unlockSelection() {
  document.body.classList.remove("grid-interacting");
}

function PresetDropdown() {
  const t = useT();
  const { activePresetName, activePresetId, widgets, layout, setActivePreset } = useDashboardStore();
  const { data: presets } = useDashboardPresets();
  const createPreset = useCreateDashboardPreset();
  const deletePreset = useDeleteDashboardPreset();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSaving(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus input when saving
  useEffect(() => {
    if (saving) inputRef.current?.focus();
  }, [saving]);

  const builtinPresets = presets?.filter((p) => p.is_builtin === 1) ?? [];
  const userPresets = presets?.filter((p) => p.is_builtin === 0) ?? [];

  const handleLoadPreset = (preset: { id: number; name: string; layout_json: string }) => {
    try {
      const parsed = JSON.parse(preset.layout_json) as { widgets: DashboardWidget[]; layout: LayoutItem[] };
      setActivePreset(preset.id, preset.name, parsed.widgets, parsed.layout);
    } catch { /* ignore parse errors */ }
    setOpen(false);
    setSaving(false);
  };

  const handleSave = async () => {
    if (!saveName.trim()) return;
    const layoutJson = JSON.stringify({ widgets, layout });
    const newId = await createPreset.mutateAsync({ name: saveName.trim(), layoutJson });
    setActivePreset(newId, saveName.trim(), widgets, layout);
    setSaveName("");
    setSaving(false);
    setOpen(false);
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deletePreset.mutate(id);
    if (activePresetId === id) {
      // Revert to "Custom" since active preset was deleted
      setActivePreset(null, "Custom", widgets, layout);
    }
  };

  const displayName = activePresetId !== null ? activePresetName : t.custom_layout;

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-1.5">
          <span className="text-muted text-xs">{t.presets}:</span>
          <span>{displayName}</span>
          <ChevronDown size={12} />
        </span>
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[220px]">
          {/* Built-in presets */}
          {builtinPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleLoadPreset(preset)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                activePresetId === preset.id
                  ? "text-accent bg-accent/5"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
              }`}
            >
              <Lock size={12} className="text-muted shrink-0" />
              <span className="truncate">{preset.name}</span>
            </button>
          ))}

          {/* Divider if user presets exist or for save option */}
          <div className="my-1 border-t border-[var(--color-border-divider)]" />

          {/* User presets */}
          {userPresets.map((preset) => (
            <div
              key={preset.id}
              className={`flex items-center group/item transition-colors ${
                activePresetId === preset.id
                  ? "bg-accent/5"
                  : "hover:bg-[var(--color-hover-row)]"
              }`}
            >
              <button
                type="button"
                onClick={() => handleLoadPreset(preset)}
                className={`flex-1 flex items-center gap-2 px-3 py-1.5 text-sm text-left ${
                  activePresetId === preset.id
                    ? "text-accent"
                    : "text-[var(--color-text-secondary)]"
                }`}
              >
                <span className="truncate">{preset.name}</span>
              </button>
              <button
                type="button"
                onClick={(e) => handleDelete(e, preset.id)}
                className="opacity-0 group-hover/item:opacity-100 transition-opacity text-muted hover:text-red-600 px-2 py-1.5"
                title={t.delete_preset}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}

          {userPresets.length > 0 && (
            <div className="my-1 border-t border-[var(--color-border-divider)]" />
          )}

          {/* Save current layout */}
          {saving ? (
            <div className="px-3 py-2 flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") { setSaving(false); setSaveName(""); }
                }}
                placeholder={t.preset_name}
                className="flex-1 border border-[var(--color-input-border)] rounded-lg px-2 py-1 text-sm bg-[var(--color-input-bg)] outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={!saveName.trim()}
                className="text-accent hover:text-accent/80 transition-colors disabled:opacity-40"
              >
                <Save size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSaving(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
            >
              <Save size={14} className="text-muted" />
              {t.save_layout}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { widgets, layout, setLayout, addWidget, removeWidget } = useDashboardStore();
  const [showWidgetPanel, setShowWidgetPanel] = useState(false);
  const { width, containerRef, mounted } = useContainerWidth();
  const t = useT();

  // Sort widgets by grid position (top-left to bottom-right) so DOM order
  // matches visual order — important for accessibility, tab order, and animations.
  const sortedWidgets = useMemo(() => {
    const layoutMap = new Map(layout.map((l) => [l.i, l]));
    return [...widgets].sort((a, b) => {
      const la = layoutMap.get(a.id);
      const lb = layoutMap.get(b.id);
      if (!la || !lb) return 0;
      if (la.y !== lb.y) return la.y - lb.y;
      return la.x - lb.x;
    });
  }, [widgets, layout]);

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
        <PresetDropdown />
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setShowWidgetPanel(!showWidgetPanel)}
          className={showWidgetPanel ? "border-accent text-accent bg-accent-light" : ""}
        >
          {t.add}
        </Button>
      </PageHeader>

      {/* Widget store panel */}
      {showWidgetPanel && (() => {
        const categories = [...new Set(WIDGET_CATALOG.map((e) => e.category))];
        return (
          <div className="mb-4 bg-[var(--color-surface)] rounded-xl p-4 max-h-[60vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-medium">{t.add}</h2>
              <button type="button" onClick={() => setShowWidgetPanel(false)} className="text-muted hover:text-[var(--color-text)]">
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
                        className={`text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                          alreadyUsed
                            ? "text-muted/50 cursor-not-allowed opacity-40"
                            : "hover:bg-[var(--color-hover-row)] bg-[var(--color-input-bg)]"
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
          {sortedWidgets.map((widget, idx) => (
            <div key={widget.id} className="stagger-in bg-[var(--color-surface)] rounded-xl overflow-hidden relative group cursor-grab active:cursor-grabbing" style={{ animationDelay: `${idx * 50}ms` }}>
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
