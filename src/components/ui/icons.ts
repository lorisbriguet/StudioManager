import { createElement, isValidElement, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  BarChart3,
  Bell,
  BellRing,
  BookOpen,
  Bookmark,
  Building2,
  Calendar,
  CalendarDays,
  CalendarRange,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheckBig,
  CircleDot,
  CircleX,
  Clock,
  Copy,
  CopyPlus,
  CreditCard,
  Database,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  File,
  FileOutput,
  FilePlus2,
  FileText,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Info,
  LayoutDashboard,
  LayoutTemplate,
  Link,
  Mail,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  Receipt,
  RefreshCw,
  Repeat,
  RotateCcw,
  Zap,
  Save,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Square,
  SquareCheck,
  Star,
  Timer,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Unlink,
  Upload,
  UserCircle,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * The app's icon vocabulary: one lucide icon per concept, so the same thing
 * always looks the same. See DESIGN-SYSTEM.md, "Icon Choices".
 *
 *   <Button icon={ICONS.download}>{t.export}</Button>
 *   <IconButton icon={ICONS.more} label={t.more_actions} />
 *   { label: t.delete, icon: ICONS.delete, danger: true, onSelect }
 *
 * Pass the component, not an element: Button, IconButton, NavItem, menus,
 * TabItem, Card.Header and EmptyState size it for their context (ICON_SIZE).
 * An icon that names no concept (a chevron, a zoom glass) is imported from
 * lucide-react directly and passed the same way.
 */
export const ICONS = {
  // ── Generic actions
  add: Plus,
  edit: Pencil,
  delete: Trash2,
  close: X,
  search: Search,
  save: Check,
  selected: Check,
  copy: Copy,
  duplicate: CopyPlus,
  download: Download,
  export: Download,
  upload: Upload,
  send: Send,
  email: Mail,
  preview: Eye,
  maximize: Maximize2,
  drag: GripVertical,
  more: Ellipsis,
  settings: Settings2,
  behavior: SlidersHorizontal,
  pin: Pin,
  link: Link,
  unlink: Unlink,
  openExternal: ExternalLink,
  newTab: ExternalLink,
  goToLinked: ArrowUpRight,
  saveLayout: Save,

  // ── States and status changes
  done: CircleCheckBig,
  markDone: CircleCheckBig,
  markPaid: CircleCheckBig,
  success: CircleCheckBig,
  markUnpaid: RotateCcw,
  undoDone: RotateCcw,
  markRead: Check,
  markAllRead: CheckCheck,
  markActive: CircleDot,
  onHold: Pause,
  startTimer: Play,
  stopTimer: Square,
  recurring: Repeat,
  updates: RefreshCw,
  generateNow: Zap,

  // ── Feedback
  warning: TriangleAlert,
  error: CircleAlert,
  danger: CircleX,
  info: Info,
  reminder: BellRing,
  notifications: Bell,

  // ── Records
  dashboard: LayoutDashboard,
  client: Users,
  contact: UserRound,
  profile: UserCircle,
  organisation: Building2,
  project: FolderKanban,
  openFolder: FolderOpen,
  newProject: FolderPlus,
  task: SquareCheck,
  invoice: Receipt,
  quote: FilePlus2,
  convertToInvoice: FileOutput,
  expense: CreditCard,
  income: TrendingUp,
  finances: BarChart3,
  wikiArticle: BookOpen,
  file: File,
  document: FileText,
  resource: Bookmark,
  savedFilter: Star,
  demoData: Database,
  invoiceTemplates: LayoutTemplate,
  appearance: Palette,
  time: Clock,
  timer: Timer,

  // ── Dates
  calendar: CalendarDays,
  dateField: Calendar,
  dateRange: CalendarRange,

  // ── Direction
  back: ArrowLeft,
  moveUp: ChevronUp,
  moveDown: ChevronDown,
  moveLeft: ArrowLeft,
  moveRight: ArrowRight,
  sortAsc: ArrowUp,
  sortDesc: ArrowDown,
  sortNone: ArrowUpDown,
  prev: ChevronLeft,
  next: ChevronRight,
  collapseSidebar: PanelLeftClose,
  expandSidebar: PanelLeftOpen,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** Icon sizes, by context. Components pick these; call sites don't. */
export const ICON_SIZE = {
  /** inside a tag or filter pill */
  pill: 10,
  /** Button, IconButton xs, Input, inline row icons */
  control: 12,
  /** menu rows, tabs, NavItem, IconButton sm, Card.Header */
  menu: 14,
  /** Callout, notification rows */
  callout: 16,
  /** app sidebar */
  nav: 18,
  /** EmptyState sm */
  emptySm: 20,
  /** EmptyState lg */
  empty: 32,
} as const;

export const ICON_STROKE = {
  default: 2,
  /** app sidebar */
  nav: 1.5,
  /** the tick in a checkbox */
  check: 3,
} as const;

/** An icon slot: a lucide component (sized by the slot) or an element (kept as is). */
export type IconProp = LucideIcon | ReactNode;

/** True for a component (function, forwardRef or memo object), false for an element or text. */
export function isIconComponent(icon: unknown): icon is LucideIcon {
  return (
    typeof icon === "function" ||
    (typeof icon === "object" && icon !== null && "$$typeof" in icon && !isValidElement(icon))
  );
}

/** Renders an icon slot: a component at `size` (plus `props`), an element as is. */
export function renderIcon(
  icon: IconProp,
  size: number,
  props?: { strokeWidth?: number; className?: string }
): ReactNode {
  if (icon == null || icon === false) return null;
  return isIconComponent(icon) ? createElement(icon, { size, ...props }) : icon;
}
