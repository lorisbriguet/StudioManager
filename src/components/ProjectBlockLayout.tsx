import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, GripVertical, Plus, X, Columns2, Maximize2 } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useUpdateProject } from "../db/hooks/useProjects";
import { useT } from "../i18n/useT";
import type { LayoutConfig, LayoutBlock, BlockType, Project } from "../types/project";
import { STANDARD_LAYOUT } from "../types/project";

interface Props {
  project: Project;
  projectId: number;
  renderBlock: (type: BlockType) => React.ReactNode;
}

const ALL_BLOCKS: BlockType[] = ["tasks", "workload", "resources", "notes", "named_tables", "invoices", "quotes", "wiki"];

const BLOCK_LABELS: Record<BlockType, string> = {
  tasks: "Tasks",
  workload: "Workload",
  resources: "Resources",
  notes: "Notes",
  named_tables: "Custom Tables",
  invoices: "Invoices",
  quotes: "Quotes",
  wiki: "Wiki",
};

interface SortableBlockProps {
  block: LayoutBlock;
  renderBlock: (type: BlockType) => React.ReactNode;
  onToggleCollapse: (type: BlockType) => void;
  onRemove: (type: BlockType) => void;
  onToggleWidth: (type: BlockType) => void;
  t: Record<string, string>;
}

function SortableBlock({ block, renderBlock, onToggleCollapse, onRemove, onToggleWidth, t }: SortableBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.type });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  const isCollapsed = !!block.collapsed;
  const isHalf = block.width === "half";

  return (
    <div ref={setNodeRef} style={style} className="group bg-[var(--color-surface)] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab text-[var(--color-muted)] hover:text-[var(--color-text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </div>
        <button onClick={() => onToggleCollapse(block.type)} className="text-[var(--color-muted)] hover:text-[var(--color-text-secondary)]">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <h3 className="text-xs font-semibold tracking-tight">
          {t[block.type] ?? BLOCK_LABELS[block.type]}
        </h3>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
          <button
            onClick={() => onToggleWidth(block.type)}
            className="text-[var(--color-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            title={t.width}
          >
            {isHalf ? <Maximize2 size={12} /> : <Columns2 size={12} />}
          </button>
          <button
            onClick={() => onRemove(block.type)}
            className="text-[var(--color-muted)] hover:text-red-500 transition-colors"
            title={t.delete}
          >
            <X size={12} />
          </button>
        </div>
      </div>
      {!isCollapsed && renderBlock(block.type)}
    </div>
  );
}

/** Group layout blocks into rows: full-width blocks get their own row, consecutive half-width blocks are paired. */
function groupBlocksIntoRows(layout: LayoutConfig): { blocks: LayoutBlock[]; isGrid: boolean }[] {
  const rows: { blocks: LayoutBlock[]; isGrid: boolean }[] = [];
  let halfBuffer: LayoutBlock[] = [];

  const flushHalf = () => {
    if (halfBuffer.length === 0) return;
    rows.push({ blocks: [...halfBuffer], isGrid: true });
    halfBuffer = [];
  };

  for (const block of layout) {
    if (block.width === "half") {
      halfBuffer.push(block);
      if (halfBuffer.length === 2) {
        flushHalf();
      }
    } else {
      flushHalf();
      rows.push({ blocks: [block], isGrid: false });
    }
  }
  flushHalf();
  return rows;
}

export function ProjectBlockLayout({ project, projectId, renderBlock }: Props) {
  const t = useT();
  const updateProject = useUpdateProject();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const layout: LayoutConfig = useMemo(() => {
    if (project.layout_config) {
      try {
        return JSON.parse(project.layout_config) as LayoutConfig;
      } catch { /* fall through */ }
    }
    return STANDARD_LAYOUT;
  }, [project.layout_config]);

  const [showAddMenu, setShowAddMenu] = useState(false);

  const saveLayout = (newLayout: LayoutConfig) => {
    updateProject.mutate({ id: projectId, data: { layout_config: JSON.stringify(newLayout) } });
  };

  const toggleCollapse = (type: BlockType) => {
    const newLayout = layout.map((b) =>
      b.type === type ? { ...b, collapsed: !b.collapsed } : b
    );
    saveLayout(newLayout);
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

  const toggleWidth = (type: BlockType) => {
    const newLayout = layout.map((b) =>
      b.type === type ? { ...b, width: b.width === "half" ? "full" as const : "half" as const } : b
    );
    saveLayout(newLayout);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = layout.findIndex((b) => b.type === active.id);
    const newIndex = layout.findIndex((b) => b.type === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newLayout = [...layout];
    const [moved] = newLayout.splice(oldIndex, 1);
    newLayout.splice(newIndex, 0, moved);
    saveLayout(newLayout);
  };

  const usedTypes = new Set(layout.map((b) => b.type));
  const availableBlocks = ALL_BLOCKS.filter((bt) => !usedTypes.has(bt));
  const rows = groupBlocksIntoRows(layout);

  return (
    <div className="space-y-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={layout.map((b) => b.type)} strategy={verticalListSortingStrategy}>
          {rows.map((row) => {
            if (row.isGrid) {
              return (
                <div key={row.blocks.map((b) => b.type).join("-")} className="grid grid-cols-2 gap-4">
                  {row.blocks.map((block) => (
                    <SortableBlock
                      key={block.type}
                      block={block}
                      renderBlock={renderBlock}
                      onToggleCollapse={toggleCollapse}
                      onRemove={removeBlock}
                      onToggleWidth={toggleWidth}
                      t={t as unknown as Record<string, string>}
                    />
                  ))}
                </div>
              );
            }
            const block = row.blocks[0];
            return (
              <SortableBlock
                key={block.type}
                block={block}
                renderBlock={renderBlock}
                onToggleCollapse={toggleCollapse}
                onRemove={removeBlock}
                onToggleWidth={toggleWidth}
                t={t as unknown as Record<string, string>}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      {availableBlocks.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-accent transition-colors w-full justify-center py-2 rounded-xl border border-dashed border-[var(--color-input-border)]"
          >
            <Plus size={14} /> {t.add_block}
          </button>
          {showAddMenu && (
            <div className="absolute z-20 mt-1 bg-[var(--color-surface)] border border-[var(--color-border-divider)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[160px]">
              {availableBlocks.map((type) => (
                <button
                  key={type}
                  onClick={() => addBlock(type)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-hover-row)]"
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
