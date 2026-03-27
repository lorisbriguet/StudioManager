# StudioManager Design System

Reference guide for all UI patterns, tokens, and conventions. Every new component or page must follow these rules.

---

## Design Language

**Notion-clean**: minimal borders, whitespace-driven separation, bold titles with quiet labels, rounded-full badges, consistent dark/light modes via CSS custom properties.

---

## CSS Tokens

All colors are defined as CSS custom properties in `src/index.css`. **Never use hardcoded Tailwind gray classes** (`bg-gray-100`, `border-gray-200`, `text-gray-500`, etc.). Always use the tokens below.

### Backgrounds
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-bg` | `#ffffff` | `#111111` | Page background |
| `--color-surface` | `#ffffff` | `#161616` | Cards, panels, dropdowns |
| `--color-input-bg` | `#f5f5f5` | `#1a1a1a` | Input fields, progress bar tracks, inactive elements |
| `--color-hover-row` | `#f8f8f8` | `#1a1a1a` | Table row hover, button hover |
| `--color-sidebar` | `#f8f8f8` | `#141414` | Sidebar background |

### Borders
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-border-divider` | `#f7f7f7` | `#1f1f1f` | Table row dividers, section separators, faint lines |
| `--color-border-header` | `#f0f0f0` | `#2a2a2a` | Table header bottom, stronger separators |
| `--color-input-border` | `#e5e5e5` | `#2a2a2a` | Input/select borders, form element borders |
| `--color-sidebar-border` | via theme | via theme | Sidebar right edge |

### Text
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-text` | `#111827` | `#e5e5e5` | Primary text |
| `--color-text-secondary` | `#374151` | `#d4d4d4` | Secondary text, hover states |
| `--color-muted` | via theme | `#888888` | Muted text, labels, placeholders |

### Tailwind Usage
```tsx
// CORRECT
className="bg-[var(--color-surface)]"
className="border-[var(--color-border-divider)]"
className="hover:bg-[var(--color-hover-row)]"
className="text-[var(--color-text-secondary)]"

// WRONG — never do this
className="bg-gray-100"
className="border-gray-200"
className="hover:bg-gray-50 dark:hover:bg-gray-200"
className="text-gray-600"
```

### Dark Mode
Tokens handle dark mode automatically. **Never use `dark:` prefix** for colors that have tokens. The only acceptable `dark:` usage is for semantic colors not covered by tokens (e.g., `dark:text-red-400` in rare cases).

---

## Border Radius

| Element | Class | Pixels |
|---------|-------|--------|
| Cards, modals, dropdowns, panels | `rounded-xl` | 12px |
| Inputs, buttons, selects | `rounded-lg` | 8px |
| Small buttons (size="sm") | `rounded-md` | 6px |
| Badges, tags, pills | `rounded-full` | 99px |
| Table rows on hover | `rounded-md` | 6px |

---

## Typography

| Element | Classes |
|---------|---------|
| Page title | `text-xl font-semibold tracking-tight` |
| Section label (year groups, categories) | `text-[10px] font-medium uppercase tracking-widest text-muted` |
| Card/block title | `text-sm font-semibold tracking-tight` |
| Table column header | `text-xs text-muted` (lowercase, not uppercase) |
| Body/row text | `text-sm` |
| Muted secondary | `text-muted` |

---

## Shadows

| Element | Class |
|---------|-------|
| Modals | `shadow-[0_16px_48px_rgba(0,0,0,0.5)]` |
| Dropdowns, context menus | `shadow-[0_8px_24px_rgba(0,0,0,0.4)]` |
| Cards (optional, for lift) | `shadow-[0_1px_3px_rgba(0,0,0,0.2)]` |

---

## Icon Sizes

All icons use **lucide-react**. Never use unicode characters (no `✕`, `←`, `→`). Sizes are standardized:

| Context | Size | Example |
|---------|------|---------|
| Sidebar navigation | `18` | `<Home size={18} strokeWidth={1.5} />` |
| Page header action buttons | `16` | `<Plus size={16} />` |
| Modal/dialog close button | `16` | `<X size={16} />` |
| Back navigation | `18` | `<ArrowLeft size={18} />` |
| Table row action icons | `14` | `<Trash2 size={14} />` |
| Settings category nav | `14` | `<Palette size={14} />` |
| Small inline icons (clear, tags) | `12` | `<X size={12} />` |
| Tiny indicator icons | `10` | `<X size={10} />` (inside tag pills) |
| Empty state illustrations | `32` | `<FileText size={32} />` |

### Icon Choices (canonical)
| Action | Icon | Notes |
|--------|------|-------|
| Delete | `Trash2` | Never `Trash`, `X`, or `Minus` |
| Close/dismiss | `X` | Never unicode `✕` |
| Edit | `Pencil` | Never `Edit`, `Edit2`, `PenLine` |
| Add/create | `Plus` | |
| Back | `ArrowLeft` | Prev/next in calendars use `ChevronLeft`/`ChevronRight` |
| Search | `Search` | |
| External link | `ExternalLink` | |
| Download | `Download` | |
| Settings | `Settings2` | |
| Drag handle | `GripVertical` | |
| Expand/maximize | `Maximize2` | |
| Folder | `FolderOpen` | |

---

## Indicator Dots

Two standardized dot sizes defined as CSS classes in `index.css`. Never use inline `w-X h-X rounded-full` for dots.

| Class | Size | Usage |
|-------|------|-------|
| `dot-sm` | 6px | Dense list items (dashboard widget rows) |
| `dot` | 8px | Standard indicators (priority, status, unread, chart legends) |

```tsx
// CORRECT
<span className="dot bg-danger" />
<span className="dot-sm bg-success" />

// WRONG — don't inline dot sizes
<span className="inline-block w-2 h-2 rounded-full bg-danger" />
```

**Special cases** (not using dot classes):
- Sidebar notification ping: animated pulse, unique pattern
- Calendar day today marker: 4px absolute-positioned dot inside day cell

### Priority Dots

Priorities use colored `dot` class, never text symbols:

```tsx
<span className={`dot ${
  priority === "high" ? "bg-danger" : priority === "medium" ? "bg-warning" : "bg-success"
}`} />
```

| Priority | Color | Class |
|----------|-------|-------|
| High | Red | `bg-danger` |
| Medium | Yellow | `bg-warning` |
| Low | Green | `bg-success` |

---

## Shared Components

Always use shared components from `src/components/ui/`. Never write raw HTML equivalents with custom classes.

### Card
```tsx
import { Card } from "../components/ui";
<Card>Content</Card>
// Renders: rounded-xl, surface bg, p-5, no border
```

### Button
```tsx
import { Button } from "../components/ui";
<Button variant="primary" size="md" icon={<Plus size={16} />}>Label</Button>
```
Variants: `primary`, `secondary`, `ghost`, `danger`, `success`, `link`
Sizes: `sm`, `md`, `lg`

### Button Icon Rules
- **Icon + text**: always use `<Button icon={<Icon size={14} />}>Label</Button>` — never raw `<button>` with icon and text side by side
- **Icon-only**: use `<button className="text-muted hover:text-[var(--color-text-secondary)] transition-colors"><Icon size={14} /></button>` — never use the shared `Button` component for icon-only actions (it adds borders/padding that are too heavy)
- Never put a lucide icon inside a `<button>` alongside text without using the shared Button component

### Badge
```tsx
import { Badge } from "../components/ui";
<Badge variant="success">paid</Badge>
```
Variants: `success`, `warning`, `danger`, `neutral`, `accent`, `info`, `indigo`
Always `rounded-full`.

### Input / Select
```tsx
import { Input, Select } from "../components/ui";
<Input value={v} onChange={setV} placeholder="..." />
<Select value={v} onChange={setV}><option>...</option></Select>
```
Both use: `rounded-lg`, `bg-[var(--color-input-bg)]`, `border-[var(--color-input-border)]`, `focus-accent`.

**When NOT to use shared Input/Select:** Inline table editing cells (too much padding). Use raw `<input>` with these classes:
```tsx
className="w-full border border-[var(--color-border-divider)] rounded-lg px-2 py-1 text-sm bg-transparent"
```

### Modal
```tsx
import { Modal } from "../components/ui";
<Modal open={open} onClose={close} title="Title" footer={<Button>Save</Button>}>
  Content
</Modal>
```

### Toggle
```tsx
import { Toggle } from "../components/ui/Toggle";
<Toggle checked={value} onChange={setValue} />
```
Use for boolean settings. Don't use checkboxes for settings toggles.

### Skeleton
```tsx
import { Skeleton } from "../components/ui/Skeleton";
<Skeleton width="60%" height={14} rounded="md" />
```
Use while data is loading. Match the shape of what will appear.

### SearchBar
```tsx
import { SearchBar } from "../components/ui";
<SearchBar value={search} onChange={setSearch} placeholder="Search..." />
```

---

## Tag Color System

9 colors, auto-assigned by tag name hash. Same tag always gets the same color.

```tsx
import { getTagColor, getNamedTagColor } from "../lib/tagColors";

// Hash-based (for user tags)
const color = getTagColor("typography", darkMode);
<span style={{ background: color.bg, color: color.text }} className="px-2 py-0.5 text-xs rounded-full font-medium">
  typography
</span>

// Named (for semantic fixed values)
const green = getNamedTagColor("green", darkMode);
```

Colors: blue, purple, green, red, yellow, cyan, orange, teal, gray.

---

## Status Colors

Use `src/lib/statusColors.ts` for all status-to-badge-variant mapping:

```tsx
import { invoiceStatusVariant, quoteStatusVariant, taskStatusVariant, projectStatusVariant } from "../lib/statusColors";
<Badge variant={invoiceStatusVariant(invoice.status)}>{status}</Badge>
```

| Status | Badge Variant |
|--------|---------------|
| paid, completed, done, accepted | `success` |
| sent, on_hold | `warning` |
| overdue, rejected | `danger` |
| cancelled, expired | `neutral` |
| draft, todo | `indigo` |
| in_progress | `info` |
| active | `accent` |

---

## Table Pattern

```tsx
<table className="w-full text-sm">
  <thead>
    <tr className="border-b border-[var(--color-border-header)]">
      <th className="text-left px-4 py-2.5 text-xs text-muted">Column</th>
    </tr>
  </thead>
  <tbody>
    {rows.map((row) => (
      <tr key={row.id} className="border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] rounded-md">
        <td className="px-4 py-2.5">Content</td>
      </tr>
    ))}
  </tbody>
</table>
```

- Row dividers: `border-[var(--color-border-divider)]`
- Header border: `border-[var(--color-border-header)]`
- Row padding: `px-4 py-2.5`
- Hover: `hover:bg-[var(--color-hover-row)]`
- No container borders around tables

### Year/Section Groups
```tsx
<span className="text-[10px] font-medium uppercase tracking-widest text-muted">2026</span>
```

---

## Dropdown / Context Menu Pattern

```tsx
<div className="bg-[var(--color-surface)] border border-[var(--color-border-header)] rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1 min-w-[160px]">
  <button className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)]">
    <Icon size={14} /> Label
  </button>
  <div className="my-1 border-t border-[var(--color-border-divider)]" />
  <button className="... text-red-600 hover:bg-red-50">Danger action</button>
</div>
```

---

## Peek Panel

- Width: half of content area (`w-1/2`)
- Border: `border-l border-[var(--color-border-divider)]`
- No shadow (flat, consistent with borders approach)
- Top bar: label + icon actions (Pencil, Maximize2, X) — no footer
- Content uses same block card pattern as full page

---

## Transitions

All animations respect `prefers-reduced-motion`. Use existing CSS classes:

| Effect | Class | Duration |
|--------|-------|----------|
| Page enter | `page-transition` | 200ms |
| Card fade-in | `animate-in` | 200ms |
| Modal open | `modal-animate` | 200ms |
| Peek slide | `peek-enter` / `peek-exit` | 200ms |
| Status color change | `status-transition` | 150ms |
| Row stagger | `stagger-in` | varies |

Global transition on interactive elements: `transition-colors` with `--duration-fast` (150ms).

---

## i18n

All user-visible text must use the `useT()` hook. No hardcoded English strings.

```tsx
const t = useT();
<span>{t.save}</span>    // CORRECT
<span>Save</span>         // WRONG
```

Keys are defined in `src/i18n/ui.ts` (EN section, then FR section). Always add both.

---

## File Organization

| Directory | Contents |
|-----------|----------|
| `src/components/ui/` | Shared design system components (Card, Button, Badge, etc.) |
| `src/components/layout/` | Layout shell (Sidebar, TabBar, MainLayout) |
| `src/components/shared/` | Shared feature components (LineItemsTable) |
| `src/components/` | Feature components (NamedTable, CommandPalette, etc.) |
| `src/pages/` | One file per route |
| `src/lib/` | Utilities (tagColors, statusColors, lineItems, etc.) |
| `src/stores/` | Zustand stores |
| `src/db/` | Database queries and hooks |
| `src/hooks/` | Custom React hooks |
| `src/i18n/` | Translations |
| `src/types/` | TypeScript type definitions |

---

## Checklist for New Components

Before merging any new UI work, verify:

- [ ] No `bg-gray-*`, `border-gray-*`, `text-gray-*`, `hover:bg-gray-*` classes
- [ ] No `dark:` prefixes for colors covered by tokens
- [ ] All badges use `rounded-full`
- [ ] All cards use `rounded-xl` with `bg-[var(--color-surface)]`
- [ ] All inputs/selects use `rounded-lg` with input tokens
- [ ] Icons use lucide-react with correct canonical icon and standard size
- [ ] No unicode characters as icons
- [ ] All user-visible text uses `useT()` i18n keys
- [ ] Status colors come from `statusColors.ts`
- [ ] Shared components used where available (Button, Badge, Input, Select, Modal, Card, Toggle)
