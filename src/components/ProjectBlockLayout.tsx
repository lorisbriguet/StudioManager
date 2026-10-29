import { useMemo } from "react";
import { ChevronDown, ChevronRight, Columns2 } from "lucide-react";
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
import { Card, CARD_GAP, CARD_STACK, DragHandle, Dropdown, ICONS, ICON_SIZE, IconButton, type PanelTitleProps } from "./ui";
import type { LayoutConfig, LayoutBlock, BlockType, Project } from "../types/project";
import { STANDARD_LAYOUT } from "../types/project";

interface Props {
  project: Project;
  projectId: number;
  renderBlock: (type: BlockType) => React.ReactNode;
  /** The blocks' heading level: h2 on the full page, h3 in a peek panel (under the h2 project title). */
  headingAs?: PanelTitleProps["as"];
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
  headingAs: PanelTitleProps["as"];
}

function SortableBlock({ block, renderBlock, onToggleCollapse, onRemove, onToggleWidth, t, headingAs }: SortableBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.type });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  const isCollapsed = !!block.collapsed;
  const isHalf = block.width === "half";

  return (
    <div ref={setNodeRef} style={style} className="group">
      <Card>
        <Card.Header
          className={isCollapsed ? "" : "mb-3"}
          title={t[block.type] ?? BLOCK_LABELS[block.type]}
          as={headingAs}
          icon={
            <>
              <DragHandle {...attributes} {...listeners} reveal />
              <IconButton icon={isCollapsed ? ChevronRight : ChevronDown} label={isCollapsed ? t.expand : t.collapse} onClick={() => onToggleCollapse(block.type)} />
            </>
          }
          action={
            <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <IconButton icon={isHalf ? ICONS.maximize : Columns2} label={t.width} size="xs" onClick={() => onToggleWidth(block.type)} />
              <IconButton icon={ICONS.close} label={t.delete} size="xs" tone="danger" onClick={() => onRemove(block.type)} />
            </span>
          }
        />
        {!isCollapsed && renderBlock(block.type)}
      </Card>
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

export function ProjectBlockLayout({ project, projectId, renderBlock, headingAs = "h2" }: Props) {
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
    <div className={CARD_STACK}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={layout.map((b) => b.type)} strategy={verticalListSortingStrategy}>
          {rows.map((row) => {
            if (row.isGrid) {
              return (
                <div key={row.blocks.map((b) => b.type).join("-")} className={`grid grid-cols-2 ${CARD_GAP}`}>
                  {row.blocks.map((block) => (
                    <SortableBlock
                      key={block.type}
                      block={block}
                      renderBlock={renderBlock}
                      onToggleCollapse={toggleCollapse}
                      onRemove={removeBlock}
                      onToggleWidth={toggleWidth}
                      t={t as unknown as Record<string, string>}
                headingAs={headingAs}
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
                headingAs={headingAs}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      {availableBlocks.length > 0 && (
        <Dropdown
          className="w-full"
          trigger={
            <Card
              as="button"
              tone="dashed"
              padding="sm"
              className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-accent transition-colors w-full justify-center"
            >
              <ICONS.add size={ICON_SIZE.menu} /> {t.add_block}
            </Card>
          }
          items={availableBlocks.map((type) => ({ label: BLOCK_LABELS[type], onSelect: () => addBlock(type) }))}
        />
      )}
    </div>
  );
}
