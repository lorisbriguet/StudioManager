# V1.6.2 — UI Rework + Modular Projects + Named Tables

## Overview

Complete visual overhaul following a Notion-clean design language: minimal borders, whitespace-driven separation, refined typography, and polished interactive components. Every visible surface in the app is touched.

**Visual mockups:** `.superpowers/brainstorm/41737-1774612694/` — run the companion server to view.

## Design Principles

- **No unnecessary borders.** Content separated by whitespace and subtle background shifts, not lines.
- **Rounded-full for all badges and tags.** No squared-off pills anywhere.
- **Bold titles + quiet labels.** Strong hierarchy contrast — page titles grab attention, section labels stay out of the way.
- **Consistent interactive components.** Every button, input, select, toggle, and dropdown follows the same system.
- **Dark theme first.** Default Dark (slate accent) is the primary design target. Light themes follow the same structure with inverted values.

---

## 1. Global Design Tokens

### Borders
- **Table row dividers:** `#f7f7f7` (light) / `#1f1f1f` (dark) — barely visible
- **Table header separator:** `#f0f0f0` (light) / `#2a2a2a` (dark) — slightly stronger
- **Sidebar edge:** faint, via `--color-sidebar-border` CSS var
- **Peek panel:** faint border (`#1f1f1f` dark / `#f0f0f0` light) — not shadow-based
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
- **Muted secondary:** `text-muted` (#555 dark / #999 light)

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
- No visible border change on hover

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
  - paid: `bg-[#052e16] text-[#4ade80]`
  - sent: `bg-[#1c1917] text-[#fbbf24]`
  - overdue: `bg-[#2a1215] text-[#f87171]`
  - draft: `bg-[#1a1a2e] text-[#818cf8]`
  - cancelled: `bg-[#1a1a1a] text-[#666]`
  - active: `bg-accent-light text-accent`
  - completed: `bg-[#052e16] text-[#4ade80]`
  - on_hold: `bg-[#1c1917] text-[#fbbf24]`
  - todo: `bg-[#1a1a2e] text-[#818cf8]`
  - in_progress: `bg-[#0c1a2e] text-[#38bdf8]`
  - done: `bg-[#052e16] text-[#4ade80]`

### Checkbox
- 16px square, `rounded` (4px), `border-[#444]`
- Checked: `bg-accent border-accent` with white checkmark

### Radio
- 16px circle, `border-[#444]`
- Checked: `border-accent` with accent-filled inner dot

### Toggle (new shared component)
- 36x20px track, `rounded-full`
- Off: `bg-[#333]`, On: `bg-accent`
- White knob, animated slide
- Replace checkboxes in Settings where toggle makes sense

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
- Category sidebar: same style as main sidebar nav, with section labels (Preferences / Data / App)
- Setting rows: clean label + control, separated by faint dividers not borders
- Toggles replace checkboxes for on/off settings
- Theme grid and accent swatches in Appearance section

### Command Palette (Cmd+K)
- `rounded-xl` overlay with heavy shadow
- Borderless input, large font (15px), search icon left, esc badge right
- Results grouped by type with section labels
- Selected item: accent-light bg
- Footer: navigation hints with kbd badges
- Search highlighting: matched text in bold

### Side Peek Panel
- Faint border-left (`#1f1f1f` dark / `#f0f0f0` light) — not shadow
- Half of content area width (after sidebar)
- Top bar: edit (pencil) + expand (arrow) + close (x) icons — no footer
- Uses same block card pattern as full project page (single-column stack)
- Same surface bg, rounded-xl blocks, drag handles

### Calendar
- Grid lines: faint divider color (`#1f1f1f` dark)
- Event chips: `rounded-full` pills using 9-color tag palette
- All-day events: `rounded-sm` bars at top of day cell
- Multi-day events: spanning bars across consecutive days, dedicated "all-day" row in week view
- Today indicator: accent-colored text only (day name + number) — no circle
- Other month days: 30% opacity
- Day headers: uppercase, muted, small
- Toolbar: ghost buttons, accent on active view

### Charts (Recharts)
- Card wrapper: borderless surface bg, rounded-xl
- Grid lines: `#1a1a1a` (barely visible), horizontal only
- Axis labels: 10px muted
- Tooltip: surface bg, rounded-lg, shadow, no border, dot + label + value per row
- Bar radius: 4px top corners, stacked bars only top segment gets radius
- Line chart: 2px stroke, dots at data points, gradient area fill
- Donut: 18px stroke width, center text for total, legend with right-aligned values
- Horizontal bars: 8px height, rounded-full track
- Colors: use tag palette for chart series, primary series = blue
- Period selectors: small ghost buttons (6M / 12M / All)

### Forms (Invoice/Quote)
- Form container: borderless card bg
- Line items table: same light divider style
- Global rate label: muted italic text above table
- Discount section: clean layout, no boxes

---

## 5. Modular Project Pages (#4 rework)

Block layout with drag-and-drop repositioning:

- **Full page:** 2-column grid of blocks
- **Peek view:** single-column stack of same blocks
- Block containers: borderless surface bg, `rounded-xl`
- Block headers: title (11-12px semibold) + drag handle (muted) + count + action button
- Add block button: dashed border, ghost style

Block types:
- **Tasks** — checklist with status badges, due dates, expandable subtasks (indented, smaller text)
- **Workload** — planned vs tracked hours mini table
- **Notes** — free text with edit action
- **Named Tables** — configurable columns with colored tags
- **Invoices** — linked invoices with status badge + amount
- **Quotes** — linked quotes with status badge + amount
- **Resources** — linked bookmarks with external link icon

Project header: title, client link, status badge, due date, "Open folder" link, edit button.

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

- "Open in Finder" link in project header metadata line
- Uses Tauri `open` or `revealItemInDir` command with the project folder path
- Small folder icon + "Folder" text, muted color, hover to secondary
- If no folder path set, show a "Set folder" prompt that opens a directory picker
- Folder path stored as new column on projects table

---

## 8. Skeleton Loading States

Shimmer placeholders while data loads, matching content shapes:

- **Table rows:** 4-5 skeleton rows with column-width rectangles + rounded pill for status
- **KPI widgets:** label, value, subtitle rectangles
- **Project cards:** title, client, progress bar rectangles
- **Chart:** title + bar column placeholders
- **Animation:** CSS `@keyframes shimmer` — left-to-right gradient sweep
- **Dark:** base #1a1a1a, shine #242424
- **Light:** base #f0f0f0, shine #e5e5e5
- **Duration:** 1.8s ease-in-out infinite
- **Reusable `<Skeleton />` component** with `width`, `height`, `rounded` props

---

## 9. Transitions

- **Page transitions:** fade-in on route change (existing `useAnimateIn`)
- **Table rows:** stagger fade-in when data loads or filter changes (50ms delay per row, max 10)
- **Cards:** scale-up fade-in on mount
- **Modals:** scale + fade (existing, refine easing)
- **Side peek:** slide-in from right (existing, refine easing)
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
- All page files in `src/pages/` — updated to use new patterns

### Components
- `src/components/NamedTable.tsx` — rework with colored tags
- `src/components/ProjectBlockLayout.tsx` — rework block styling
- `src/components/ProjectDetailContent.tsx` — project header + blocks
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
- `src/components/ui/Toggle.tsx` — toggle switch component
