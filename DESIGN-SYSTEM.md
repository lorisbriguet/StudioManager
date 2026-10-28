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
| Section label (year groups, categories) | `<SectionLabel>` (`text-[10px] font-medium uppercase tracking-widest text-muted`) |
| Card/block title | `text-sm font-semibold tracking-tight` |
| Table column header | `text-xs text-muted` (lowercase, not uppercase) |
| Body/row text | `text-sm` |
| Fine print (timestamps, hints, chart legends) | `text-xs text-muted` |
| Muted secondary | `text-muted` |

**Scale rule:** the only permitted sizes are `text-xl`, `text-sm`, `text-xs`,
and the 10px section label (`text-[10px]`). No other `text-[Npx]` arbitrary
sizes — 9px/11px/13px were folded into this scale (2026-08, audit item 345).

### Section labels

Every small uppercase label uses `src/components/ui/SectionLabel.tsx`. There is one style only: never `text-xs uppercase`, never `tracking-wide`/`tracking-wider`, never `font-semibold` uppercase.

```tsx
<SectionLabel className="mb-2">2026</SectionLabel>
<SectionLabel as="h2" action={<IconButton icon={Plus} label={t.add} size="xs" />}>{t.backlinks}</SectionLabel>
```

- **Heading tag:** use `as="h2"`/`"h3"` when the label names a section.
- **Action:** `action` puts a count or button on the right of the same row.
- **Spacing:** it sets no margin, so the caller adds it.
- **Class string:** for a `<th>` or a third-party heading, use the `SECTION_LABEL` class string. `MENU_GROUP_LABEL` and `SectionHeader` (`ui/Settings`) are built on it.

---

## Spacing

4px base grid — use Tailwind spacing steps (including quarter steps like
`py-1.75`), never `p-[Npx]` arbitrary values.

| Context | Classes |
|---------|---------|
| Table row cell | `px-4 py-2.5` |
| Card padding | `p-4` (compact: `px-3 py-2.5`) |
| Form field grid | `grid gap-3` |
| Button row | `flex gap-2`, primary action rightmost, destructive pushed left with `mr-auto` |
| Sidebar nav item | `px-3.5 py-1.5 mx-2` |
| Page sections | `mb-4` between blocks, `mb-6` after the page header |

---

## Window Bars

Columns of the window sit side by side (app sidebar, wiki explorer, editor, side panel), so a bar pinned to the top or bottom of one column must match the bars of its neighbours, or the lines between them step. Heights include the border (border-box). Use the shared pieces in `src/components/ui/Bars.tsx`, never a bar sized by padding.

| Bar | Height | Use |
|-----|--------|-----|
| Bottom bar (footer, status bar) | `h-11` (44px), `border-t` | `<BottomBar>`, or the `BOTTOM_BAR` classes for a custom one (app sidebar footer) |
| Panel top bar (tab row, panel toolbar) | `h-10` (40px), `border-b` | `PANEL_TOP_BAR` classes |
| App sidebar header | `h-14` (56px), `border-b` | logo row only |

Bottom bar text is `text-xs text-muted`. A column that has no footer simply ends; it never gets a shorter bar of its own. Dialog footers (`Modal`) are not window bars: they keep `px-5 py-3`.

---

## Shadows

| Element | Class |
|---------|-------|
| Modals | `shadow-[0_16px_48px_rgba(0,0,0,0.5)]` |
| Dropdowns, context menus | `shadow-menu` (soft in light, `0 8px 24px rgba(0,0,0,0.4)` in dark) |
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
- **Icon-only**: use `<IconButton icon={Pencil} label={t.edit} />` (see Icon Buttons below). Never use the shared `Button` for icon-only actions, and never a raw `<button>` with only an icon in it.
- Never put a lucide icon inside a `<button>` alongside text without using the shared Button component

### Icon Buttons

`src/components/ui/IconButton.tsx`, for every button that is only an icon.

```tsx
<IconButton icon={Pencil} label={t.edit} onClick={edit} />
<IconButton icon={Trash2} label={t.delete} tone="danger" reveal onClick={remove} />
<IconButton icon={X} label={t.close} size="xs" onClick={onClose} />
<IconButton icon={MoreHorizontal} label={t.more} {...pop.triggerProps} />
```

| Prop | Values | |
|------|--------|--|
| `icon` | a lucide icon component | `Pencil`, not `<Pencil />` |
| `label` | string (required) | aria-label and hover title, from `useT()` |
| `size` | `xs` · `sm` (default) · `md` | `p-0.5` icon 12 · `p-1` icon 14 · `p-1.5` icon 16 |
| `tone` | `default` · `danger` · `accent` | Hover colour and tint: text + hover-row, danger-text + danger-bg, accent + hover-row |
| `reveal` | boolean | Hidden until its `group` row is hovered or the button has keyboard focus |
| `active` | boolean | Pressed/open look |
| `iconSize` / `iconClassName` | number / string | Rare overrides, e.g. a rotating expand chevron |

At rest an IconButton is `text-muted`. Disabled is `opacity-30`, with clicks turned off.

When the row uses a named group (`group/task`), `reveal` can't reach it. Pass `className="opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100"` instead. These stay raw `<button>`: buttons that are always coloured (a running timer, a confirm check), and the × inside a tag or badge chip.

### Sanctioned Raw-Button Exceptions

These patterns keep raw `<button>` elements — do not convert them to the shared Button:

- **Dropdown / context menu items** — see Dropdown below
- **Banner action chips** — inverse-colored chips on mode banners (`MainLayout` test/presentation banners)
- **Settings status chips** — the amber test-mode chip and the danger-outline restore/snapshot chips in `SettingsPage`. If a **third** danger-outline chip appears, promote the pattern to a proper Button variant (e.g. `danger-outline`) instead of adding a fourth exception.
- **Dashed dropzones** — full-width dashed add-affordances (`ProjectBlockLayout` add-block)

### Link Button Conventions

- **Icon sizes**: `12` with `size="sm"`; `14` with `size="md"` and in table-row contexts
- **Sanctioned className modifiers** on `variant="link"` (only these two):
  - `text-muted hover:text-accent` — quiet links (add-condition, save-filter, folder actions)
  - `text-danger-text` — danger links (clear date)

  Both rely on Tailwind emitting these color utilities *after* `text-accent` in the compiled CSS (driven by `@theme` declaration order in `index.css`). Verify compiled order before introducing any other color override.
- **Full-width footer add-row** (named pattern: `WorkloadTable` and `NamedTable` table footers): `variant="link"` + `className="w-full px-* py-*"` — explicit `px/py` reliably restores padding over the variant's `p-0`. To suppress the variant's hover underline (as in `WorkloadTable`), use `hover:no-underline!` — the important modifier is required because plain `hover:no-underline` sorts *before* `hover:underline` in the compiled CSS and loses.

### Badge
```tsx
import { Badge } from "../components/ui";
<Badge variant="success">paid</Badge>
```
Variants: `success`, `warning`, `danger`, `neutral`, `accent`, `info`, `indigo`
Always `rounded-full`.

### Inputs

Text fields use `Input` and `Textarea` from `src/components/ui/Input.tsx`, and pickers use `Select` (see Dropdown). Never use a raw `<input>`/`<textarea>` for text, numbers, dates or search.

```tsx
import { Input, Textarea } from "../components/ui";

<Input value={v} onChange={…} />                                  // forms (md)
<Input size="sm" type="number" fullWidth={false} className="w-20 text-right" />  // toolbars, compact rows
<Input variant="bare" size="sm" />                                // table cells: frame shows on hover/focus
<Input variant="inline" autoFocus onBlur={commit} />              // rename in place: accent underline only
<Textarea rows={4} value={notes} onChange={…} />
```

| | Classes |
|--|--|
| `size="md"` (default) | `px-3 py-2 text-sm rounded-lg` |
| `size="sm"` | `px-2.5 py-1 text-xs rounded-md` |
| `variant="default"` | `bg-[var(--color-input-bg)] border-[var(--color-input-border)]`, `focus-accent` |
| `variant="bare"` | transparent; border and fill appear on hover/focus |
| `variant="inline"` | transparent, `border-b border-accent`, inherits the font size |

- **Number fields:** align them right with `className="text-right"`.
- **Width:** `fullWidth` defaults to `true`.
- **Class string:** for the rare control that can't be one of these, use `fieldClass({ size, variant })`.
- **Not text fields:** checkboxes, radios, colour and file inputs stay native.

### Dates

Every date field uses `DatePicker` from `src/components/ui/DatePicker.tsx`. Never use a native `<input type="date">`.

```tsx
<DatePicker value={due} onChange={setDue} />                        // "yyyy-MM-dd" | null
<DatePicker size="sm" variant="bare" value={d} onChange={…} />      // table cells, inline metadata
<Calendar selected={d} selectedEnd={end} onSelect={pick} month={m} onMonthChange={setM} />
```

- **Typing:**
  - It reads the app's date format (31.10.2026), loose forms (1.2.26) and ISO.
  - `onChange` fires as soon as the text is a complete valid date, so an Enter-to-save handler sees the new value.
  - Emptying the field reports `null`.
- **Invalid input:** a date that doesn't exist (31.02) stays in the field and is flagged with `aria-invalid`. Esc undoes the typing, and a second Esc reaches the dialog.
- **Calendar:**
  - The calendar button (or Alt+↓) opens the calendar with Today/Tomorrow shortcuts.
  - Weeks start on Monday, and the month and weekday names follow the app language.
- **Sizes and looks:** `size` `sm`/`md` and `variant` `default`/`bare`, as for Input. `className` goes on the wrapper (layout). `inputClassName` goes on the field (border highlights).
- **`TaskDatePicker`** (end date, times, reminder) is built on `Calendar`, `DateShortcuts` and `Toggle size="sm"`.

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

## Tags

9 colours: blue, purple, green, red, yellow, cyan, orange, teal, gray. A user tag gets its colour from a hash of its name, so the same tag always has the same colour. Workload options and custom-list items store a colour name instead. All three components below read dark mode themselves.

### Tag

```tsx
import { Tag } from "../components/ui";

<Tag name="typography" />                          // colour from the name
<Tag name={opt.value} color={opt.color} />         // stored colour name (legacy "brown"/"pink" are mapped)
<Tag name={tag} onRemove={() => removeTag(tag)} /> // × button, labelled "Remove tag {name}"
<Tag name={tag} size="xs" />                       // dense rows and table cells
<Tag name="side_income">{t.side_income}</Tag>      // translated label, colour still from the name
```

`sm` (default) is `text-xs px-2 py-0.5`; `xs` is `text-[10px] px-1.5 py-0.5`. Both are `rounded-full font-medium`.

### FilterChip

A toggle pill in a filter row (status filters, saved views, tag filters). It sets `aria-pressed`.

```tsx
<FilterChip active={filter === s} onClick={() => setFilter(s)}>{labels[s]}</FilterChip>
<FilterChip active={id === f.id} count={conditions.length} onClick={…}>{f.name}</FilterChip>
<FilterChip tag={tag} active={tagFilter === tag} activeIcon={<X size={10} />} onClick={…} />
```

- **Off:** `border-[var(--color-input-border)] text-muted`, with a hover-row background on hover.
- **On:** `bg-accent text-white`. With `tag`, it takes the tag's own colour instead.
- **Size:** `px-2.5 py-1 text-xs rounded-full`.

### CountBadge

`<CountBadge value={3} />`: a 16px number pill (`text-[10px]`). `tone` is `neutral` (the default), `danger`, `accent` or `inverse` (inverse sits on an accent fill). Anything above `max` (99) shows as "99+".

### Raw colours

For charts and other cases where no pill is drawn, use `getTagColor(name, dark)`, `getStoredTagColor(colorName, dark)` and `getNamedTagColor("green", dark)` from `lib/tagColors`. Never hand-build a coloured pill from them.
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
<SectionLabel as="span">2026</SectionLabel>
```

---

## Navigation

Rows in a navigation list use `src/components/ui/NavItem.tsx`: the app sidebar, settings and profile categories, the wiki explorer and custom lists.

```tsx
<NavItem active={cat === key} icon={<Palette size={14} />} onClick={() => setCat(key)}>{t.appearance}</NavItem>

// router link, or a row that holds other controls
<NavLink className={({ isActive }) => navItemClass({ active: isActive, size: "md", fill: false })} />
<div className={`${navItemClass({ active })} group`}>…</div>
```

| Size | Classes | Use |
|------|---------|-----|
| `sm` (default) | `gap-2 px-3 py-1.5 text-xs` | Settings, wiki explorer, custom lists |
| `md` | `gap-2.5 px-3.5 py-1.5 text-sm` | App sidebar, profile |

- **Active row:** `bg-accent-light text-accent font-medium` and `aria-current="page"`.
- **Inactive row:** `text-muted`, turning `hover-row` with secondary text on hover.
- **Width:** rows are full width. Pass `fill: false` when the row has side margins.

### Segmented control

`src/components/ui/SegmentedControl.tsx` picks one of 2–4 short options shown side by side, such as the calendar's Month/Week or the invoice logo position.

```tsx
<SegmentedControl
  aria-label={t.logo_position}
  value={logoPosition}
  onChange={setLogoPosition}
  options={[{ value: "left", label: t.logo_left }, { value: "center", label: t.logo_center }]}
/>
```

- **Look:** an `input-bg` track, `p-0.5 rounded-lg`. The selected segment is `surface` with a hairline shadow and `font-medium`. The others are `text-muted`.
- **Options:** `size` is `sm` (the default, `px-3 py-1 text-xs`) or `md`. `fullWidth` stretches it and the segments share the width.
- **Keyboard:** it is a radio group with one tab stop. Arrow keys and Home/End move and select, skipping disabled options.
- **When not to use it:**
  - More options, or options that need a description: use `Select` or radios.
  - Filtering a list: use `FilterChip`.
  - Buttons that act rather than choose (zoom in/out): use a row of `IconButton`.

---

## Settings

Settings pages use `src/components/ui/Settings.tsx`. Never rebuild the card shell or its header by hand.

```tsx
import { SettingsCard, SettingRow } from "../components/ui";

<SettingsCard title={t.calendar_sync} desc={t.calendar_permission_help}>
  <SettingRow label={t.week_start} desc={t.week_start_desc}><Select … /></SettingRow>
  <SettingRow label={t.persona} htmlFor="demo-persona"><Select id="demo-persona" … /></SettingRow>
</SettingsCard>
```

- **`SettingsCard`:**
  - Look: `rounded-xl` surface with a `border-divider` border, `px-4 pt-3 pb-1`.
  - With `title`, it draws a `SectionHeader`: a SectionLabel, an optional description and a divider.
  - Without `title`, the content brings its own header (time entries draws its own `SectionHeader` and toolbar).
- **`SettingRow`:**
  - Layout: label (and an optional `desc`) on the left, control on the right, `py-2.5`, with faint dividers between rows. The last row has no divider.
  - `htmlFor` turns the label into a real `<label>` for the control.
- **`SectionHeader`:** use it on its own for a flat section inside a card.

---

## Popover

Every floating panel uses `src/components/ui/Popover.tsx`, including Dropdown's menus. Never build a floating panel by hand: no `absolute`/`fixed` panel, no `createPortal`, no click-outside listener and no z-index of your own.

```tsx
const pop = usePopover();
<Button variant="secondary" size="sm" {...pop.triggerProps}>{t.columns}</Button>
{pop.open && (
  <Popover anchor={pop.anchorRef} onClose={pop.close} padding="content" align="end">
    …
  </Popover>
)}

// right-click, at the cursor
<Popover at={{ x, y }} onClose={close}>…</Popover>

// autocomplete under an input: typing stays in the input
<Popover anchor={inputRef} autoFocus={false} matchWidth onClose={close}>…</Popover>
```

| Prop | Default | |
|------|---------|--|
| `anchor` / `at` | | Element ref, or a window point |
| `padding` | `"menu"` | `menu` = `p-1 min-w-[160px]`, `content` = `p-3`, `none` |
| `align` / `side` | `start` / `bottom` | Flips when there is no room |
| `matchWidth` | `false` | At least as wide as the anchor |
| `autoFocus` | `true` | Focuses `[data-autofocus]`, else the first focusable element, else the panel |

**What it handles for you:**
- It renders on `<body>`, at `z-[60]`, with the `POPOVER_SURFACE` look: surface, `border-header`, `rounded-xl`, `shadow-menu`. Tables and modals never clip it.
- It follows its anchor when the page scrolls or the window resizes.
- A click outside calls `onClose(false)`. Esc calls `onClose(true)`, and a surrounding Modal stays open.
- Clicks and keys inside it don't reach the anchor's ancestors, such as table rows and forms.

Use `Dropdown` or `ContextMenu` when the content is a plain list of commands. Use `Popover` with the `MENU_*` row classes when rows need extra controls.

---

## Dropdown

Every menu and select in the app uses `src/components/ui/Dropdown.tsx`. Never use a native `<select>`: it opens the system menu, which doesn't match the app. Spec and live preview: [StudioManager Dropdown](https://claude.ai/artifact/ByQ9fZTPqMmURLyBVYN5o2).

| Need | Use |
|------|-----|
| Pick one value, `<option>` children | `<Select value onChange>` (same API as a native select: `e.target.value`) |
| Options with icons, descriptions, groups, search, "Create …" | `<DropdownSelect options={[...]} value onChange>` |
| Pick several values | `<DropdownSelect multiple value={string[]} onChange>` |
| Commands behind a button (edit, duplicate, delete) | `<Dropdown trigger={<Button …/>} items={[...]}>` |
| Commands at the cursor (right-click) | `<ContextMenu>` from `ui/` (same panel and rows, built on Popover) |

```tsx
<Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
  <option value="CHF">CHF</option>
  <option value="EUR">EUR</option>
</Select>

<DropdownSelect value={clientId} onChange={setClientId} placeholder={t.select_client}
  onCreate={(name) => createClient(name)}
  options={clients.map((c) => ({ value: c.id, label: c.name, description: c.city }))} />

<Dropdown align="end" trigger={<Button variant="ghost" size="sm" icon={<MoreHorizontal size={14} />} />}
  items={[
    { label: t.edit, icon: <Pencil size={14} />, onSelect: edit },
    { divider: true },
    { label: t.delete, icon: <Trash2 size={14} />, danger: true, onSelect: remove },
  ]} />
```

**Trigger.** Thin by default everywhere, forms included: `bg-[var(--color-input-bg)]`, no border, `px-2.5 py-1 text-xs rounded-md`, chevron 12 (same as `Button` secondary `size="sm"`). Options:
- `prefix="Status:"`: a muted label inside the trigger, for toolbars and page headers.
- `size="md"`: form height with an input border. Opt-in only.
- `variant="bare"`: no fill, no padding, no colour of its own. For table cells and status pills.
- `fullWidth`: defaults to `true`. Pass `false` inline.

**Panel.** `bg-[var(--color-surface)] border-[var(--color-border-header)] rounded-xl shadow-menu p-1`, min 160px, max 320px wide, 288px tall then scrolls. It renders on `<body>`, 4px under the trigger, so tables, cards and modals never clip it. It flips up when there's no room below.

**Rows.** Inset: `px-2 py-1 rounded-md text-sm`, hover `bg-[var(--color-hover-row)]`. Selected: `text-accent font-medium bg-accent-tint` plus a check 14 on the right. Danger: `text-[var(--color-danger-text)]` on `bg-[var(--color-danger-bg)]`, always last, after a divider. Divider: `my-1 border-t border-[var(--color-border-divider)]`. Group label: the 10px uppercase section label. Use `MENU_PANEL`, `MENU_ITEM`, `MENU_DIVIDER` and `MENU_GROUP_LABEL` from `Dropdown.tsx` for any custom popover.

**Behaviour.**
- Search turns on by itself above 10 options.
- Keyboard: arrows (they skip disabled rows), Home/End, type-ahead, Enter/Space to pick. Esc and Tab close and return focus to the trigger, and Esc doesn't close a surrounding Modal.
- Clicks and keys inside the panel don't reach the trigger's ancestors (table rows, forms).
- `Select` sends no DOM `change` event, so a form that tracks dirty state with `<div onChange>` must call `markDirty()` in each Select's `onChange`.
- Tests: open with `pickOption(trigger, "Label")` from `src/__tests__/fixtures/dropdown.ts`.

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
| `src/components/shared/` | Shared feature components that read or write data (LineItemsTable, SavedFilterBar) |
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
- [ ] Text fields use `Input` / `Textarea`, date fields use `DatePicker` (no raw `<input>`/`<textarea>`)
- [ ] Icons use lucide-react with correct canonical icon and standard size
- [ ] No unicode characters as icons
- [ ] All user-visible text uses `useT()` i18n keys
- [ ] Status colors come from `statusColors.ts`
- [ ] Shared components used where available (Button, Badge, Input, Select / DropdownSelect / Dropdown, Modal, Card, Toggle)
- [ ] No native `<select>`
- [ ] Icon-only buttons use `IconButton`
- [ ] Uppercase labels use `SectionLabel`
- [ ] Settings sections use `SettingsCard` / `SettingRow`
- [ ] Navigation rows use `NavItem` / `navItemClass`
- [ ] 2–4 way choices use `SegmentedControl`
- [ ] Tag pills use `Tag`, filter pills use `FilterChip`, number pills use `CountBadge`
- [ ] No hand-made floating panel (use `Popover`, `Dropdown` or `ContextMenu`)
