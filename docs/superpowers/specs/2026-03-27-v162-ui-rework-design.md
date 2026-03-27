# V1.6.2 — UI Rework + Modular Projects + Named Tables

## Overview

Complete visual overhaul following a Notion-clean design language: minimal borders, whitespace-driven separation, refined typography, and polished interactive components. Every visible surface in the app is touched.

## Design Principles

- **No unnecessary borders.** Content separated by whitespace and subtle background shifts, not lines.
- **Rounded-full for all badges and tags.** No squared-off pills anywhere.
- **Bold titles + quiet labels.** Strong hierarchy contrast — page titles grab attention, section labels stay out of the way.
- **Consistent interactive components.** Every button, input, select, toggle, and dropdown follows the same system.
- **Dark theme first.** Default Dark (slate accent) is the primary design target. Light themes follow the same structure with inverted values.

---

## 1. Global Design Tokens

### Borders
- **Table row dividers:** `border-gray-50` (light) / `#1f1f1f` (dark) — barely visible
- **Table header separator:** `border-gray-100` (light) / `#2a2a2a` (dark) — slightly stronger
- **Sidebar edge:** faint, via `--color-sidebar-border` CSS var
- **Everything else:** no borders. Cards, forms, sections — all borderless.

### Backgrounds
- **Page content:** `#ffffff` (light) / `#111111` (dark)
- **Cards / surfaces:** `#ffffff` (light) / `#161616` (dark) — subtle lift from page bg
- **Sidebar:** `#f8f8f8` (light) / `#141414` (dark) — distinct from content
- **Inputs:** `#f5f5f5` (light) / `#1a1a1a` (dark)
- **Hover rows:** `#f8f8f8` (light) / `#1a1a1a` (dark)

### Border Radius
- **Cards, modals, dropdowns:** `rounded-xl` (12px)
- **Inputs, buttons, selects:** `rounded-lg` (8px)
- **Small buttons:** `rounded-md` (6px)
- **Badges, tags:** `rounded-full` (99px)

### Typography
- **Page title:** `text-xl font-semibold tracking-tight` (letter-spacing: -0.03em)
- **Section label:** `text-[10px] font-medium uppercase tracking-widest text-muted`
- **Table column header:** `text-xs text-muted` (lowercase, not uppercase)
- **Body / row text:** `text-sm` (13px)
- **Card title:** `text-sm font-semibold tracking-tight`
- **Muted secondary:** `text-muted` (#666 dark / #999 light)

### Shadows
- **Cards (optional lift):** `shadow-[0_1px_2px_rgba(0,0,0,0.03)]` (light) / `shadow-[0_1px_3px_rgba(0,0,0,0.2)]` (dark)
- **Modals:** `shadow-[0_16px_48px_rgba(0,0,0,0.5)]` (dark) / `shadow-xl` (light)
- **Dropdowns:** `shadow-[0_8px_24px_rgba(0,0,0,0.4)]` (dark)

---

## 2. Component Overhaul

### Card
- Remove `border` class entirely
- Background: subtle surface color (not same as page bg)
- `rounded-xl` (was `rounded-lg`)
- Padding: `p-5` (was `p-4`) — more breathing room
- Optional micro-shadow for forms/modals

### Button
- **Primary:** `bg-accent text-white rounded-lg`
- **Secondary:** `bg-[#222] text-white rounded-lg` (dark) / `bg-gray-100 rounded-lg` (light)
- **Ghost:** `border border-[#2a2a2a] text-secondary rounded-lg`
- **Danger:** `bg-red-900/30 text-red-400 rounded-lg`
- **Success:** `bg-green-900/30 text-green-400 rounded-lg`
- **Link:** no background, accent color, underline on hover
- **Icon-only:** `p-1.5 rounded-md hover:bg-hover`
- Sizes: sm (5px 10px), md (7px 16px), lg (10px 20px)

### Input
- `bg-input border border-input-border rounded-lg`
- Focus: `border-accent shadow-[0_0_0_2px_rgba(accent,0.15)]`
- Error: `border-danger shadow-[0_0_0_2px_rgba(danger,0.15)]`
- No visible border change on hover (clean)

### Select
- Same styling as Input
- Custom SVG chevron via `background-image`
- `appearance: none`

### Textarea
- Same border/bg as Input
- `rounded-lg`, `resize-vertical`

### Badge
- All `rounded-full` with `px-2.5 py-0.5`
- Status colors (dark theme):
  - paid: `bg-green-900/40 text-green-400`
  - sent: `bg-yellow-900/30 text-yellow-400`
  - overdue: `bg-red-900/30 text-red-400`
  - draft: `bg-indigo-900/30 text-indigo-400`
  - cancelled: `bg-gray-800 text-gray-500`
  - active: `bg-accent-light text-accent`
  - completed: `bg-green-900/40 text-green-400`
  - on_hold: `bg-yellow-900/30 text-yellow-400`
  - todo: `bg-indigo-900/30 text-indigo-400`
  - in_progress: `bg-cyan-900/30 text-cyan-400`
  - done: `bg-green-900/40 text-green-400`

### Checkbox
- 16px square, `rounded` (4px), `border-[#444]`
- Checked: `bg-accent border-accent` with white checkmark

### Radio
- 16px circle, `border-[#444]`
- Checked: `border-accent` with accent-filled inner dot

### Toggle
- 36x20px track, `rounded-full`
- Off: `bg-[#333]`, On: `bg-accent`
- White knob, animated slide

### Dropdown / Context Menu
- `bg-surface border border-border rounded-xl`
- Items: `rounded-md` hover bg, 12px font
- Danger items: red text, red hover bg
- Section labels: uppercase, muted
- Dividers: `border-border`

### Modal
- `bg-surface border border-border rounded-xl`
- Heavy shadow
- Title: `text-base font-semibold tracking-tight`
- Description: `text-sm text-secondary`
- Actions: right-aligned, ghost cancel + primary/danger action

### Toast
- `bg-surface border border-border rounded-xl`
- Icon circle (green/red/yellow) + message + dismiss X
- Shadow for lift

### Tooltip
- `bg-[#2a2a2a] rounded-md` with arrow
- 11px text, 5px 10px padding

### SearchBar
- Icon (magnifying glass) inside input, left-aligned
- Same input styling, icon is muted color

---

## 3. Tag Color System

9 colors, auto-assigned via stable hash of tag name. Same tag always gets the same color.

### Dark Theme
| Color  | Background | Text     |
|--------|-----------|----------|
| Blue   | #1a2332   | #60a5fa  |
| Purple | #1e1b2e   | #a78bfa  |
| Green  | #052e16   | #4ade80  |
| Red    | #2a1215   | #f87171  |
| Yellow | #1c1917   | #fbbf24  |
| Cyan   | #0c1a2e   | #38bdf8  |
| Orange | #2a1a0e   | #fb923c  |
| Teal   | #042f2e   | #2dd4bf  |
| Gray   | #1a1a1a   | #a8a8a8  |

### Light Theme
| Color  | Background | Text     |
|--------|-----------|----------|
| Blue   | #dbeafe   | #1d4ed8  |
| Purple | #ede9fe   | #6d28d9  |
| Green  | #dcfce7   | #15803d  |
| Red    | #fee2e2   | #b91c1c  |
| Yellow | #fef3c7   | #92400e  |
| Cyan   | #cffafe   | #0e7490  |
| Orange | #ffedd5   | #c2410c  |
| Teal   | #ccfbf1   | #0f766e  |
| Gray   | #f3f4f6   | #6b7280  |

### Hash Function
```typescript
function tagColorIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 9;
}
```

Applied to: resource tags, named table tags columns.

---

## 4. Page-Level Changes

### All List Pages (Invoices, Quotes, Expenses, Income, Clients, Tasks, Resources)
- Remove table container borders
- Light dividers between rows only
- Table header: lowercase, muted, stronger bottom border
- Year/section groups: uppercase label style
- Hover: subtle bg change, `rounded-md` on the row
- Badges: all `rounded-full`

### Sidebar
- Keep distinct bg from content
- Nav items: `rounded-md`, accent bg on active
- Section labels: uppercase, tracking-wide, muted
- Dividers: very faint
- Overdue badge: rounded-full, red tint

### Tab Bar
- Back/forward arrows (already added in V1.6.1)
- Tab styling: bottom border accent on active, no bg change
- Plus button: muted, rounded

### Dashboard
- KPI widgets: borderless cards with surface bg
- Charts: themed card, softer axis labels, rounded tooltip
- Widget grid: consistent card styling throughout

### Settings Page
- Flat Notion-style layout — remove boxy cards around each section
- Category sidebar: same style as main sidebar nav
- Setting rows: clean label + control, separated by whitespace not borders
- Toggles replace checkboxes where appropriate

### Command Palette (Cmd+K)
- `rounded-xl` overlay
- Softer border, heavier shadow
- Input: borderless, large font
- Results: hover bg, `rounded-md`

### Side Peek Panel
- Remove hard `border-l`
- Use shadow instead: `shadow-[-8px_0_24px_rgba(0,0,0,0.3)]`
- Smooth slide-in animation (already exists)

### Calendar
- Softer grid lines (use `--border-divider` color)
- Event chips: `rounded-full`, use tag color system for project-based coloring
- Day headers: muted, uppercase label style
- Today highlight: accent bg tint

### Charts (Recharts)
- Card wrapper: borderless surface bg
- Axis labels: muted, 11px
- Grid lines: `--border-divider` color (barely visible)
- Tooltip: `rounded-lg`, surface bg, shadow, no border
- Legend: small text, muted

### Forms (Invoice/Quote)
- Form container: borderless card bg
- Line items table: same light divider style
- Global rate label: muted italic text above table
- Discount section: clean layout, no boxes

---

## 5. Modular Project Pages (#4 rework)

Current implementation allows drag-and-drop block layout. The UI rework applies the new design system:

- Block containers: borderless, surface bg, `rounded-xl`
- Block headers: card-title style, drag handle muted
- Add block button: ghost style
- Block types maintain their content styling but inherit the new card/table patterns

---

## 6. Named Tables Rework (#9)

Borrow patterns from resources table:
- Column headers: muted, lowercase
- Rows: light dividers
- Tags column: uses the 9-color auto-hash system
- Column editor popover: `rounded-xl`, shadow, borderless
- Add row button: link style at bottom
- Inline editing: borderless input, accent underline on focus

---

## 7. Project Folder Link (#11)

- Add a "Open in Finder" button/link on project detail pages
- Uses Tauri `open` command with the project folder path
- Small icon button (FolderOpen from lucide) in project header
- If no folder path set, show a "Set folder" prompt that opens a directory picker

---

## 8. Skeleton Loading States

Add shimmer placeholders for:
- Table rows (3-5 skeleton rows while loading)
- KPI widgets (pulsing rectangle)
- Project cards (card-shaped skeleton)
- Chart areas (rectangular placeholder)

Implementation: CSS `@keyframes shimmer` animation on `bg-gradient` elements. Reusable `<Skeleton />` component with `width`, `height`, `rounded` props.

---

## 9. Transitions

- **Page transitions:** fade-in on route change (already exists via `useAnimateIn`)
- **Table rows:** stagger fade-in when data loads or filter changes (50ms delay per row, max 10)
- **Cards:** scale-up fade-in on mount
- **Modals:** scale + fade (already exists)
- **Side peek:** slide-in from right (already exists, refine easing)
- **Dropdowns:** scale-from-top fade-in
- **Respect `prefers-reduced-motion`:** all animations disabled when set

---

## Files Affected

### Core Design System
- `src/index.css` — global tokens, skeleton animation, transitions
- `src/components/ui/Card.tsx` — borderless, rounded-xl
- `src/components/ui/Button.tsx` — all variants refined
- `src/components/ui/Badge.tsx` — rounded-full, color system
- `src/components/ui/Input.tsx` — focus ring, sizing
- `src/components/ui/Select.tsx` — custom chevron, focus ring
- `src/components/ui/Modal.tsx` — rounded-xl, shadow
- `src/components/ui/SearchBar.tsx` — icon positioning
- `src/lib/statusColors.ts` — updated dark/light badge colors
- `src/lib/tagColors.ts` — NEW: 9-color palette + hash function

### Layout
- `src/components/layout/Sidebar.tsx` — refined nav styling
- `src/components/layout/MainLayout.tsx` — bg tokens
- `src/components/layout/TabBar.tsx` — tab styling

### Pages (all)
- `src/pages/InvoicesPage.tsx`
- `src/pages/QuotesPage.tsx`
- `src/pages/ExpensesPage.tsx`
- `src/pages/IncomePage.tsx`
- `src/pages/ClientsPage.tsx`
- `src/pages/ClientDetailPage.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/pages/ProjectDetailPage.tsx`
- `src/pages/TasksPage.tsx`
- `src/pages/ResourcesPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/CalendarPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/ProfilePage.tsx`
- `src/pages/FinancesPage.tsx`
- `src/pages/InvoiceFormPage.tsx`
- `src/pages/QuoteFormPage.tsx`
- `src/pages/TimeTrackingPage.tsx`

### Components
- `src/components/NamedTable.tsx` — rework
- `src/components/ProjectBlockLayout.tsx` — rework
- `src/components/ProjectDetailContent.tsx`
- `src/components/SavedFilterBar.tsx`
- `src/components/BulkActionBar.tsx`
- `src/components/ClientTimeline.tsx`
- `src/components/dashboard/widgets.tsx`
- `src/components/workload/WorkloadTable.tsx`
- `src/components/workload/WorkloadCell.tsx`
- `src/components/shared/LineItemsTable.tsx`

### New Files
- `src/lib/tagColors.ts` — tag color palette + hash
- `src/components/ui/Skeleton.tsx` — loading placeholder component
- `src/components/ui/Toggle.tsx` — toggle switch component (extract from inline)
