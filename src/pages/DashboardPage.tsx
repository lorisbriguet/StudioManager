import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from "react-grid-layout";
import type { Layout, ResponsiveLayouts } from "react-grid-layout";
import { ChevronDown, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useClients } from "../db/hooks/useClients";
import { useDashboardStore, WIDGET_CATALOG, type WidgetType, type DashboardWidget } from "../stores/dashboard-store";
import type { LayoutItem } from "react-grid-layout";
import { renderWidget } from "../components/dashboard/widgets";
import { ErrorBoundary } from "react-error-boundary";
import { WidgetErrorFallback } from "../components/ErrorFallback";
import { DashboardYearContext } from "../components/dashboard/DashboardYearContext";
import { ICONS, ICON_SIZE, MenuItem, PageHeader, Button, EmptyState, Select, Popover, IconButton, SectionLabel, AddRow, Card } from "../components/ui";
import { MENU_ITEM, MENU_DIVIDER } from "../components/ui/Dropdown";
import { useT } from "../i18n/useT";
import { deleteWithUndo } from "../lib/undo";
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
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closeMenu = (returnFocus: boolean) => {
    setOpen(false);
    setSaving(false);
    if (returnFocus) dropdownRef.current?.querySelector("button")?.focus({ preventScroll: true });
  };

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

  const handleSave = async (name: string) => {
    const layoutJson = JSON.stringify({ widgets, layout });
    const newId = await createPreset.mutateAsync({ name, layoutJson });
    setActivePreset(newId, name, widgets, layout);
    setSaving(false);
    setOpen(false);
  };

  const handleUpdate = async () => {
    if (activePresetId === null) return;
    const layoutJson = JSON.stringify({ widgets, layout });
    try {
      await updatePreset.mutateAsync({ id: activePresetId, data: { layout_json: layoutJson } });
    } catch {
      return; // reported by the mutation; keep the menu open
    }
    // No toast: saving the layout is routine.
    setOpen(false);
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteWithUndo(deletePreset, id, t.preset_deleted, () => {
      // Only once the delete went through: revert to "Custom" if the deleted preset is (still) the active one.
      const s = useDashboardStore.getState();
      if (s.activePresetId === id) s.setActivePreset(null, t.custom_layout, s.widgets, s.layout);
    });
  };

  const displayName = activePresetId !== null ? activePresetName : t.custom_layout;

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="secondary"
        onClick={() => (open ? closeMenu(false) : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <span className="text-muted text-xs">{t.presets}:</span>
          <span>{displayName}</span>
          <ChevronDown size={ICON_SIZE.control} />
        </span>
      </Button>

      {open && (
        <Popover anchor={dropdownRef} align="end" onClose={closeMenu} padding="none" className="p-1 min-w-[220px]" role="dialog" aria-label={t.presets}>
          {/* Built-in presets */}
          {builtinPresets.map((preset) => (
            <MenuItem
              key={preset.id}
              icon={Lock}
              selected={activePresetId === preset.id}
              onClick={() => handleLoadPreset(preset)}
            >
              {preset.name}
            </MenuItem>
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
                    ? "text-accent-text font-medium"
                    : "text-[var(--color-text-secondary)]"
                }`}
              >
                <span className="truncate">{preset.name}</span>
              </button>
              <IconButton
                icon={ICONS.delete}
                label={t.delete_preset}
                size="xs"
                tone="danger"
                onClick={(e) => handleDelete(e, preset.id)}
                reveal="item" className="mx-1.5"
              />
            </div>
          ))}

          {userPresets.length > 0 && (
            <div className={MENU_DIVIDER} />
          )}

          {/* Update active user preset */}
          {activePresetId !== null && presets?.find((p) => p.id === activePresetId && p.is_builtin === 0) && (
            <MenuItem icon={ICONS.saveLayout} onClick={handleUpdate}>
              {t.update_preset}
            </MenuItem>
          )}

          {/* Save current layout */}
          {saving ? (
            <AddRow
              className="px-2 py-1"
              placeholder={t.preset_name}
              buttonLabel={t.save}
              autoFocus
              onAdd={handleSave}
              onKeyDown={(e) => {
                // preventDefault: Esc cancels the name field, not the whole menu
                if (e.key === "Escape") { e.preventDefault(); setSaving(false); }
              }}
            />
          ) : (
            <MenuItem icon={ICONS.saveLayout} onClick={() => setSaving(true)}>
              {t.save_layout}
            </MenuItem>
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
          icon={ICONS.add}
          onClick={() => setShowWidgetPanel(!showWidgetPanel)}
          className={showWidgetPanel ? "border-accent text-accent-text bg-accent-light" : ""}
        >
          {t.add}
        </Button>
      </PageHeader>

      {/* Widget store panel */}
      {showWidgetPanel && (() => {
        const categories = [...new Set(WIDGET_CATALOG.map((e) => e.category))];
        return (
          <Card className="mb-4 max-h-[60vh] overflow-y-auto">
            <Card.Header title={t.add} onClose={() => setShowWidgetPanel(false)} />
            {categories.map((cat) => (
              <div key={cat} className="mb-3">
                <SectionLabel className="mb-1.5">{cat}</SectionLabel>
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
                            ? "text-[var(--color-text-faint)] cursor-not-allowed opacity-40"
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
          </Card>
        );
      })()}

      {/* First-run guidance: nothing feeds the widgets without a client */}
      {isFirstRun && (
        <EmptyState
          message={t.first_run_dashboard}
          icon={ICONS.client}
          action={
            <Button icon={ICONS.add} onClick={() => navigate("/clients")}>
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
          margin={[16, 16] as [number, number]}
          autoSize
        >
          {sortedWidgets.map((widget, idx) => (
            <Card key={widget.id} padding="none" className="stagger-in overflow-hidden relative group cursor-grab active:cursor-grabbing" style={{ animationDelay: `${idx * 50}ms` }}>
              {/* Remove button */}
              <IconButton
                icon={ICONS.close}
                label={t.remove}
                size="xs"
                tone="danger"
                reveal
                onClick={() => removeWidget(widget.id)}
                className="absolute top-1 right-1 z-10"
              />
              <ErrorBoundary FallbackComponent={WidgetErrorFallback}>{renderWidget(widget.type)}</ErrorBoundary>
            </Card>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
    </DashboardYearContext.Provider>
  );
}
