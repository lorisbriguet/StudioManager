import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, GripVertical, Plus, X } from "lucide-react";
import { useUpdateProject } from "../db/hooks/useProjects";
import { useT } from "../i18n/useT";
import type { LayoutConfig, BlockType, Project } from "../types/project";
import { STANDARD_LAYOUT } from "../types/project";

interface Props {
  project: Project;
  projectId: number;
  renderBlock: (type: BlockType) => React.ReactNode;
}

const ALL_BLOCKS: BlockType[] = ["tasks", "workload", "resources", "notes", "named_tables", "invoices", "quotes"];

const BLOCK_LABELS: Record<BlockType, string> = {
  tasks: "Tasks",
  workload: "Workload",
  resources: "Resources",
  notes: "Notes",
  named_tables: "Custom Tables",
  invoices: "Invoices",
  quotes: "Quotes",
};

export function ProjectBlockLayout({ project, projectId, renderBlock }: Props) {
  const t = useT();
  const updateProject = useUpdateProject();

  const layout: LayoutConfig = useMemo(() => {
    if (project.layout_config) {
      try {
        return JSON.parse(project.layout_config) as LayoutConfig;
      } catch { /* fall through */ }
    }
    return STANDARD_LAYOUT;
  }, [project.layout_config]);

  const [showAddMenu, setShowAddMenu] = useState(false);

  const toggleCollapse = (type: BlockType) => {
    const newLayout = layout.map((b) =>
      b.type === type ? { ...b, collapsed: !b.collapsed } : b
    );
    saveLayout(newLayout);
  };

  const saveLayout = (newLayout: LayoutConfig) => {
    updateProject.mutate({ id: projectId, data: { layout_config: JSON.stringify(newLayout) } });
  };

  const removeBlock = (type: BlockType) => {
    const newLayout = layout.filter((b) => b.type !== type);
    saveLayout(newLayout);
  };

  const addBlock = (type: BlockType) => {
    const newLayout = [...layout, { type }];
    saveLayout(newLayout);
    setShowAddMenu(false);
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    const newLayout = [...layout];
    const target = index + direction;
    if (target < 0 || target >= newLayout.length) return;
    [newLayout[index], newLayout[target]] = [newLayout[target], newLayout[index]];
    saveLayout(newLayout);
  };

  const usedTypes = new Set(layout.map((b) => b.type));
  const availableBlocks = ALL_BLOCKS.filter((t) => !usedTypes.has(t));

  return (
    <div className="space-y-4">
      {layout.map((block, i) => {
        const isCollapsed = !!block.collapsed;
        return (
          <div key={block.type} className="group bg-[var(--color-surface)] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => moveBlock(i, -1)}
                  disabled={i === 0}
                  className="text-[var(--color-muted)] hover:text-[var(--color-text-secondary)] disabled:opacity-30 text-xs cursor-grab"
                  title="Move up"
                >
                  <GripVertical size={12} />
                </button>
              </div>
              <button onClick={() => toggleCollapse(block.type)} className="text-[var(--color-muted)] hover:text-[var(--color-text-secondary)]">
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
              <h3 className="text-xs font-semibold tracking-tight">
                {(t as Record<string, string>)[block.type] ?? BLOCK_LABELS[block.type]}
              </h3>
              <button
                onClick={() => removeBlock(block.type)}
                className="opacity-0 group-hover:opacity-100 text-[var(--color-muted)] hover:text-red-500 transition-opacity ml-auto"
                title={t.delete}
              >
                <X size={12} />
              </button>
            </div>
            {!isCollapsed && renderBlock(block.type)}
          </div>
        );
      })}

      {availableBlocks.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-accent transition-colors w-full justify-center py-2 rounded-xl border border-dashed border-[var(--color-input-border)]"
          >
            <Plus size={14} /> {t.add_block}
          </button>
          {showAddMenu && (
            <div className="absolute z-20 mt-1 bg-[var(--color-surface)] border border-[var(--color-border-divider)] rounded-xl shadow-lg py-1 min-w-[160px]">
              {availableBlocks.map((type) => (
                <button
                  key={type}
                  onClick={() => addBlock(type)}
                  className="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-[var(--color-hover-row)]"
                >
                  {BLOCK_LABELS[type]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
