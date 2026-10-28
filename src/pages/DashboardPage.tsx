import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from "react-grid-layout";
import type { Layout, ResponsiveLayouts } from "react-grid-layout";
import { Plus, X, ChevronDown, Lock, Save, Trash2, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useClients } from "../db/hooks/useClients";
import { useDashboardStore, WIDGET_CATALOG, type WidgetType, type DashboardWidget } from "../stores/dashboard-store";
import type { LayoutItem } from "react-grid-layout";
import { renderWidget } from "../components/dashboard/widgets";
import { DashboardYearContext } from "../components/dashboard/DashboardYearContext";
import { PageHeader, Button, EmptyState, Select, Popover, IconButton } from "../components/ui";
import { MENU_ITEM, MENU_DIVIDER } from "../components/ui/Dropdown";
import { useT } from "../i18n/useT";
import { toast } from "sonner";
import { useDashboardPresets, useCreateDashboardPreset, useUpdateDashboardPreset, useDeleteDashboardPreset } from "../db/hooks/useDashboardPresets";
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
  const updatePreset = useUpdateDashboardPreset();
  const deletePreset = useDeleteDashboardPreset();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeMenu = (returnFocus: boolean) => {
    setOpen(false);
    setSaving(false);
    if (returnFocus) dropdownRef.current?.querySelector("button")?.focus({ preventScroll: true });
  };

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

  const handleUpdate = async () => {
    if (activePresetId === null) return;
    const layoutJson = JSON.stringify({ widgets, layout });
    await updatePreset.mutateAsync({ id: activePresetId, data: { layout_json: layoutJson } });
    setOpen(false);
    toast.success(t.layout_updated);
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deletePreset.mutate(id);
    if (activePresetId === id) {
      // Revert to "Custom" since active preset was deleted
      setActivePreset(null, t.custom_layout, widgets, layout);
    }
  };

  const displayName = activePresetId !== null ? activePresetName : t.custom_layout;

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => (open ? closeMenu(false) : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <span className="text-muted text-xs">{t.presets}:</span>
          <span>{displayName}</span>
          <ChevronDown size={12} />
        </span>
      </Button>

      {open && (
        <Popover anchor={dropdownRef} align="end" onClose={closeMenu} padding="none" className="p-1 min-w-[220px]">
          {/* Built-in presets */}
          {builtinPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleLoadPreset(preset)}
              className={`${MENU_ITEM} ${
                activePresetId === preset.id
                  ? "text-accent font-medium bg-accent-tint"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]"
              }`}
            >
              <Lock size={12} className="text-muted shrink-0" />
              <span className="truncate">{preset.name}</span>
            </button>
          ))}

          {/* Divider if user presets exist or for save option */}
          <div className={MENU_DIVIDER} />

          {/* User presets */}
          {userPresets.map((preset) => (
            <div
              key={preset.id}
              className={`flex items-center rounded-md group/item transition-colors ${
                activePresetId === preset.id
                  ? "bg-accent-tint"
                  : "hover:bg-[var(--color-hover-row)]"
              }`}
            >
              <button
                type="button"
                onClick={() => handleLoadPreset(preset)}
                className={`${MENU_ITEM} flex-1 min-w-0 ${
                  activePresetId === preset.id
                    ? "text-accent font-medium"
                    : "text-[var(--color-text-secondary)]"
                }`}
              >
                <span className="truncate">{preset.name}</span>
              </button>
              <IconButton
                icon={Trash2}
                label={t.delete_preset}
                size="xs"
                tone="danger"
                onClick={(e) => handleDelete(e, preset.id)}
                className="mx-1.5 opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
              />
            </div>
          ))}

          {userPresets.length > 0 && (
            <div className={MENU_DIVIDER} />
          )}

          {/* Update active user preset */}
          {activePresetId !== null && presets?.find((p) => p.id === activePresetId && p.is_builtin === 0) && (
            <button
              type="button"
              onClick={handleUpdate}
              className={`${MENU_ITEM} text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]`}
            >
              <Save size={14} className="text-accent" />
              {t.update_preset}
            </button>
          )}

          {/* Save current layout */}
          {saving ? (
            <div className="px-2 py-1 flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  // preventDefault: Esc cancels the name field, not the whole menu
                  if (e.key === "Escape") { e.preventDefault(); setSaving(false); setSaveName(""); }
                }}
                placeholder={t.preset_name}
                className="flex-1 border border-[var(--color-input-border)] rounded-lg px-2 py-1 text-sm bg-[var(--color-input-bg)] outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={!saveName.trim()}
                className="text-accent hover:text-accent/80 transition-colors disabled:opacity-40"
                aria-label={t.save}
              >
                <Save size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSaving(true)}
              className={`${MENU_ITEM} text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]`}
            >
              <Save size={14} className="text-muted" />
              {t.save_layout}
            </button>
          )}
        </Popover>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { widgets, layout, setLayout, addWidget, removeWidget } = useDashboardStore();
  const [showWidgetPanel, setShowWidgetPanel] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const { width, containerRef, mounted } = useContainerWidth();
  const t = useT();
  const navigate = useNavigate();
  const { data: clients } = useClients();
  const isFirstRun = clients !== undefined && clients.length === 0;

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
    <DashboardYearContext.Provider value={year}>
    <div ref={containerRef} className="overflow-x-hidden">
      <PageHeader title={t.dashboard}>
        <Select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label={t.year}
          fullWidth={false}
        >
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </Select>
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
              <IconButton icon={X} label={t.close} onClick={() => setShowWidgetPanel(false)} />
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

      {/* First-run guidance: nothing feeds the widgets without a client */}
      {isFirstRun && (
        <EmptyState
          message={t.first_run_dashboard}
          icon={<Users size={32} />}
          action={
            <Button icon={<Plus size={16} />} onClick={() => navigate("/clients")}>
              {t.add_first_client}
            </Button>
          }
        />
      )}

      {/* Grid layout */}
      {!isFirstRun && mounted && width > 0 && (
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
              <IconButton
                icon={X}
                label={t.remove}
                size="xs"
                tone="danger"
                reveal
                onClick={() => removeWidget(widget.id)}
                className="absolute top-1 right-1 z-10"
              />
              {renderWidget(widget.type)}
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
    </DashboardYearContext.Provider>
  );
}
