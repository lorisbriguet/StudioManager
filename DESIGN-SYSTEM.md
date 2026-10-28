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
| Buttons, fields, dropdown triggers (the 26px controls) | `rounded-md` | 6px |
| Badges, tags, pills | `rounded-full` | 99px |

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
| Table cells | `Table` sets them: 16px sides (12px compact), see [Tables](#tables) |
| Card padding | `p-4` (compact: `px-3 py-2.5`) |
| Form field grid | `FormGrid` (12px both ways), see [Forms](#forms) |
| Button row | `FormActions` / Modal `footer`: right-aligned, primary last, destructive on the far left |
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
| Table row action icons | `12` | `IconButton size="xs"` in `Table.Actions` |
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
<Button icon={<Plus size={12} />}>Label</Button>
```
**One size.** Every button is 26px tall, with 12px text and `rounded-md`. That is the same height as Input, Select, DatePicker and FilterChip, so every control in a row lines up. There is no `size` prop. The main action stands out by colour (primary), not by size.

**Variants:**
- `primary`: the main action.
- `secondary`: a grey fill.
- `outline`: bordered and transparent; this was "ghost".
- `danger`: outlined red, for every destructive action.
- `link`: text only.

Deep dive, with the counts behind this choice: [StudioManager Button](https://claude.ai/artifact/1wWC1A5CxpM4qxsXjd6wbw). The IconButton one: [StudioManager IconButton](https://claude.ai/artifact/BMjCuNLsU3XthiC8Vjmewo).

### Button Icon Rules
- **Icon + text**: always use `<Button icon={<Icon size={14} />}>Label</Button>` — never raw `<button>` with icon and text side by side
- **Icon-only**: use `<IconButton icon={Pencil} label={t.edit} />` (see Icon Buttons below). Never use the shared `Button` for icon-only actions, and never a raw `<button>` with only an icon in it.
- Never put a lucide icon inside a `<button>` alongside text without using the shared Button component

### Icon Buttons

`src/components/ui/IconButton.tsx`, for every button that is only an icon.

```tsx
<IconButton icon={Pencil} label={t.edit} onClick={edit} />
<IconButton icon={Trash2} label={t.delete} size="xs" tone="danger" reveal onClick={remove} />   // row action
<IconButton icon={X} label={t.remove} size="xs" reveal="task" />                              // row with group/task
<IconButton icon={MoreHorizontal} label={t.more} {...pop.triggerProps} />
```

| Prop | Values | |
|------|--------|--|
| `icon` | a lucide icon component | `Pencil`, not `<Pencil />` |
| `label` | string (required) | aria-label and hover title, from `useT()` |
| `size` | `sm` (default) · `xs` | `sm`: a 26px square with a 14px icon (toolbars, headers, dialogs, next to fields). `xs`: a 20px square with a 12px icon (inside table rows, lists, tree rows). The box is fixed, so there's no padding to set. |
| `tone` | `default` · `danger` · `accent` | Hover colour and tint: text + hover-row, danger-text + danger-bg, accent + hover-row |
| `reveal` | `true` · `"row"` · `"task"` · `"sub"` · `"item"` · `"col"` | Hidden until its row is hovered (`true` is the nearest `group`; a name targets `group/<name>`) or the button has keyboard focus |
| `active` | boolean | Pressed/open look |
| `color` | `danger` · `accent` | Coloured at rest, not only on hover: a running timer, a confirm check |
| `iconClassName` | string | Classes on the icon, e.g. a rotating expand chevron. The icon size can't be changed. |

At rest an IconButton is `text-muted`. Disabled is `opacity-30`, with clicks turned off.

Always-coloured buttons (a running timer, a confirm check) use `color`. A primary confirm with a label is a `Button`, not an IconButton. The × in a tag is `Tag onRemove`, and in a badge it's an `IconButton size="xs"`.

### Sanctioned Raw-Button Exceptions

These patterns keep raw `<button>` elements — do not convert them to the shared Button:

- **Dropdown / context menu items** — see Dropdown below
- **Banner action chips** — inverse-colored chips on mode banners (`MainLayout` test/presentation banners)
- **Settings status chips** — the amber test-mode chip in `SettingsPage`. (The danger-outline chips are now `Button variant="danger"`.)
- **Dashed dropzones** — full-width dashed add-affordances (`ProjectBlockLayout` add-block)

### Link Button Conventions

- **Icon sizes**: `12` inside a Button. For icon-only controls, IconButton sets the size.
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

<Input value={v} onChange={…} />                                  // sm by default, everywhere
<Input type="number" fullWidth={false} className="w-20 text-right" />
<Input variant="bare" size="sm" />                                // table cells: frame shows on hover/focus
<Input variant="inline" autoFocus onBlur={commit} />              // rename in place: accent underline only
<Textarea rows={4} value={notes} onChange={…} />
```

| | Classes |
|--|--|
| `size="sm"` (default) | `px-2.5 py-1 text-xs rounded-md`, the same height as the Select trigger |
| `size="md"` | `px-3 py-2 text-sm rounded-lg`, opt-in (rare) |
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

### Checkbox

`Checkbox` and `Radio` from `src/components/ui/Checkbox.tsx`. Never use a raw `<input type="checkbox">` or `type="radio"`.

```tsx
<Checkbox checked={done} onChange={(e) => toggle(e.target.checked)} aria-label={t.done} />
<Checkbox checked={all} indeterminate={some} onChange={selectAll} aria-label={t.select_all} />
<Checkbox label={t.show_income} description={t.show_income_desc} checked={…} onChange={…} />
<Radio name="seed" label={t.start_empty} description={…} checked={!seed} onChange={() => setSeed(false)} />
```

- **Look:** a 14px box on `input-bg` with an `input-border`. Checked is an accent fill with a white check. `indeterminate` (select-all with some rows selected) shows a dash.
- **A real input:** there's a native input underneath, so `onChange(e)`, `e.nativeEvent.shiftKey`, `e.target` and `ref` all work as before.
- **`label` and `description`:** they make the text clickable. Without a label, give it an `aria-label`.
- **`className`:** goes on the outer wrapper, for layout only.
- **On/off settings:** use `Toggle`. Checkbox is for selecting items or ticking things off.

### Modal
```tsx
import { Modal, Kbd } from "../components/ui";
<Modal open={open} onClose={close} title="Title" footer={<Button>Save</Button>}>
  Content
</Modal>

// palette-style: top of the window, content laid out edge to edge
<Modal open={open} onClose={close} position="top" size="lg" padding={false} aria-label={t.quick_timer}>
  … <Kbd>Esc</Kbd>
</Modal>
```

- **Size:** `size` is `sm` (the default) · `md` · `lg` · `xl` · `2xl` · `full` (viewers: 80% × 85% of the window).
- **Rendering:** it renders on `<body>`, so a transformed panel (the side peek) can't trap it. Tests should query `document` or `screen`, not the render container.
- **Position:** `position="top"` places the dialog 20% from the top.
- **Padding:** `padding={false}` drops the body padding.
- **No title:** give it an `aria-label`.
- **Built in:** backdrop click and Esc close the dialog, focus is trapped while open, and focus returns to where it was on close.
- **Never build your own overlay** (`fixed inset-0 bg-black/…`).
- **`Kbd`:** draws a key hint.

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

**Pill heights.** Labels (Tag, Badge, status pills, CountBadge) use two heights, and controls use one:

| | Height | Box | Used by |
|--|--|--|--|
| `PILL` | 20px | `px-2 py-0.5 text-xs leading-4 rounded-full font-medium` | Tag, Badge (default), the status pills on invoice, quote and task rows |
| `PILL_XS` | 16px | `px-1.5 text-[10px] leading-4 rounded-full font-medium` | `size="xs"` on Tag and Badge (dense rows, table cells), CountBadge |
| `CONTROL_BOX` | 26px | the control box | FilterChip (it's clickable, so it lines up with Button and Select) |

The × on a removable Tag is a 16px round hit area with a hover tint. Deep dive: [StudioManager Pills](https://claude.ai/artifact/WcEWyoB8NSz8JSJTRS5Si3).

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

## Forms

Forms are built from `FormLayout`, `FormSection`, `FormGrid`, `FormField` and `FormActions` (`src/components/ui/Form.tsx`, `FormField.tsx`).

```tsx
<FormLayout as="form" onSubmit={submit}>          {/* 24px between blocks, capped at 768px */}
  <FormSection title={t.client}>                  {/* SectionLabel, 12px, fields */}
    <FormGrid cols={2}>                           {/* 1–4 columns, 12px gaps */}
      <FormField label={t.client} required error={errors.client}><DropdownSelect … /></FormField>
      <FormField label={t.billing_address} hint={t.billing_hint} span="full"><Input … /></FormField>
    </FormGrid>
    <Checkbox label={t.use_global_rate} … />
  </FormSection>
  <FormActions destructive={<Button variant="danger">{t.delete}</Button>}>
    <Button variant="secondary">{t.cancel}</Button>
    <Button type="submit">{t.create}</Button>
  </FormActions>
</FormLayout>
```

- **Labels:** above the field, 12px muted, plain weight, linked to the field. Only `FormField` draws them; a label over several controls uses `FIELD_LABEL`. No 10px, bold or uppercase field labels, and no placeholder-only forms.
- **Required:** an accent `*`. **Hint:** a muted line under the field. **Error:** the red line that replaces the hint, announced, with the field's border in red.
- **Fields:** one height, 26px. Don't add padding to make one taller.
- **Checkboxes and toggles:** their own `label` / `description`, never wrapped in a hand-written `<label>`.
- **Actions:** right-aligned with the primary last: Cancel (secondary), other actions, primary. A destructive action sits on the far left. In a Modal they go in `footer`, which is the same row.
- **Creating a record** (client, expense, income, project, resource) happens in a `FormModal`: fields in the body, which is a `<form>` so Enter submits; Cancel · Create in the footer. A field that uses Enter itself (suggestions, tag entry) calls `preventDefault`.
- **Spanning:** `FormField span={2 | 3 | 4 | "full"}`; anything else in a grid (a checkbox row, a note) goes in `FormGridItem`.
- **Buttons inside a form** don't submit it unless they are `type="submit"`: `Button` defaults to `type="button"`. `FormModal`'s form is `noValidate`, so the app's own errors show, not the browser's.
- **Errors without a visible label** (a row rename, the line-items check) use `FieldError`.
- **A label over several controls** (a colour and its hex field, a list of checkboxes, an options editor) is a `FormGroup`; its `action` sits at the right of the label row.
- **Small editor cards** (a contact, an address) use `FormLayout dense capped={false}`: 12px between the fields and the buttons.
- **Width:** page forms cap at 768px (`FORM_WIDTH`). Pass `capped={false}` in modals, popovers and side panels.
- **Not this layout:** settings rows (`SettingRow`, label left and control right), filter bars, single-field inline adds and row editing in tables.

---

## Tables

Every data table uses `Table` (`src/components/ui/Table.tsx`). Don't write `<table>`, `<th>` or `<td>` classes by hand.

```tsx
<Table density="default">                     {/* or "compact" */}
  <Table.Head>
    <Table.SelectAll all={…} some={…} onToggle={bulk.toggleAll} />
    <SortHeader label={t.date} sortKey="date" current={sort} onSort={setSort} />
    <Table.Th numeric>{t.amount}</Table.Th>
    <Table.ActionsTh />
  </Table.Head>
  <Table.Body>
    <Table.Group colSpan={4} label="2026" count="3 invoices" total="CHF 18 130.50" open={open} onToggle={toggle} />
    <Table.Row data-list-row onOpen={() => open(row)} focused={i === focusIdx} selected={…} onContextMenu={…}>
      <Table.Select checked={…} onToggle={(shift) => bulk.toggleItem(row.id, shift)} />
      <Table.Td muted>{date}</Table.Td>
      <Table.Td numeric>{amount}</Table.Td>
      <Table.Actions><IconButton size="xs" icon={Settings2} label={t.more_actions} onClick={…} /></Table.Actions>
    </Table.Row>
    {rows.length === 0 && <Table.Empty colSpan={4}><EmptyState … /></Table.Empty>}
  </Table.Body>
  <Table.Foot>…totals…</Table.Foot>
</Table>
```

| Density | Rows | Cell sides | For |
|--|--|--|--|
| `default` | 40px | 16px | Lists: invoices, quotes, expenses, income, clients, resources |
| `compact` | 32px | 12px | Settings lists and editing grids: time entries, categories, named tables, workload, line items |

- **Header:** 32px in both densities, `text-xs font-medium text-muted`, lowercase, header line under it. Sortable or not, it looks the same.
- **Rows:** a minimum height, so a row holding a 26px field or a pill is as tall as a text row. Divider line, hover tint, accent tint when selected.
- **Opening a row:** `onOpen` makes a single click anywhere on the row open it (pointer cursor). Clicks on checkboxes, buttons, links and fields act on themselves. Enter (`useListNavigation`) and the context menu still work. Editing grids have no `onOpen`.
- **Row actions:** always the last column, `IconButton size="xs"` inside `Table.Actions`, shown on row hover, keyboard focus or while a menu from it is open.
- **Numbers:** `numeric` on `Th` and `Td` right-aligns them with tabular digits.
- **Empty:** `Table.Empty` inside the body, so the header stays. **Loading:** `TableSkeleton` with the same `density`.
- **Totals:** `Table.Foot`, inside the table.
- **Groups:** `Table.Group`, a collapsible row with a chevron, `SectionLabel`, a count and a total on the right.
- No container border; the table scrolls sideways when it is too wide.

Not tables: the projects card grid, notifications, dashboard widget lists and the P&L lines are lists with their own layout.

---

## Building blocks

Shared class strings and small parts that the components are built from (`src/components/ui/tokens.ts` and friends). Use them in new components instead of retyping the classes.

| | What it is | Used by |
|--|--|--|
| `CONTROL_BOX` | The 26px control box: `px-2.5 py-1 text-xs leading-4 border` | Button, Input, Select trigger, FilterChip, SegmentedControl (its segments are 22px inside a 2px track, 26px in total) |
| `MUTED_INTERACTIVE` | Muted text that darkens on hover | NavItem, TabItem, SegmentedControl, FilterChip, SortHeader, DragHandle |
| `SURFACE` / `SURFACE_FILL` | A raised surface with / without a border. Add the shadow per use | Popover, Modal / BulkActionBar |
| `PILL` / `PILL_XS` | The 20px and 16px label pills | Tag, Badge, CountBadge, status pills |
| `MENU_TONE` | Menu row tones | Dropdown, ContextMenu |
| `FORM_GAP` / `FORM_STACK` / `FORM_WIDTH` / `FORM_ACTIONS` / `FIELD_LABEL` / `FORM_SPAN` | Form spacing, width, the action row and the field label | FormGrid, FormLayout, FormActions, Modal footer, FormField |
| `TABLE_X` / `TABLE_ROW_H` / `TABLE_TH` / `NUMERIC` | Table geometry per density: cell sides, row height, header text, numbers | Table, SortHeader, TableSkeleton |
| `revealClass(reveal)` | Reveal-on-hover for `true` or a named group (`"task"` → `group/task`) | IconButton, DragHandle |
| `useTagColor(name, color?)` | A tag's colours for the current mode | Tag, FilterChip |
| `<PanelTitle title action? tone? variant?>` | A title on the left and an action on the right | Modal header, SectionLabel with `action`, dashboard widgets, line items |
| `<Spinner tone="accent"\|"current">` | The loading spinner, announced as "Loading" | Button `loading`, PageSpinner |
| `Labelled` | A control with a clickable label and description | Checkbox, Radio, Toggle |

- **`Card`:** it takes `as="section"`, and SettingsCard is built on it.
- **`Toggle`:** it takes `label` and `description`, like Checkbox.
- **`SortHeader`:** each column header is a real button, with `aria-sort` on the `<th>`.

---

## Feedback

From `src/components/ui/Feedback.tsx` and `Tooltip.tsx`:

```tsx
<ProgressBar value={62} label={t.progress} showValue />            // tone accent|success|warning|danger, size sm|md
<Callout tone="warning" action={<Button>…</Button>}>{msg}</Callout>  // warning|info|danger|success
<ConfirmButton label={t.delete} question={t.confirm_delete_client} onConfirm={remove} />
<DragHandle {...attributes} {...listeners} reveal />                // dnd-kit grip; reveal = group hover
<Tooltip content={t.open_full_page}><Link …><Maximize2 size={14} /></Link></Tooltip>
```

- **Hints:** never use the native `title` attribute for a hint on a button or link. Use `Tooltip`, or `IconButton`, which shows its `label` as a tooltip. `title` stays only on truncated plain text, where it reveals the full text.
- **Deleting:** `ConfirmButton` is the in-place confirm. Deletes that need more context still use the system dialog (`ask()`).

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
<Button variant="secondary" {...pop.triggerProps}>{t.columns}</Button>
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

<Dropdown align="end" trigger={<IconButton icon={MoreHorizontal} label={t.more} />}
  items={[
    { label: t.edit, icon: <Pencil size={14} />, onSelect: edit },
    { divider: true },
    { label: t.delete, icon: <Trash2 size={14} />, danger: true, onSelect: remove },
  ]} />
```

**Trigger.** Thin by default everywhere, forms included: `bg-[var(--color-input-bg)]`, no border, `px-2.5 py-1 text-xs rounded-md`, chevron 12 (the same 26px as `Button` secondary). Options:
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
- [ ] Text fields use `Input` / `Textarea`, date fields use `DatePicker`, checkboxes and radios use `Checkbox` / `Radio` (no raw `<input>`/`<textarea>`)
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
- [ ] Dialogs use `Modal` (no hand-built overlay), key hints use `Kbd`
- [ ] Hints use `Tooltip` (no `title` on buttons/links); progress, notices, confirms and drag grips use the Feedback components
- [ ] Forms use `FormLayout` / `FormGrid` / `FormField` / `FormActions` (no hand-written labels or button rows)
- [ ] Data tables use `Table` (no hand-styled `<th>`/`<td>`), row actions in `Table.Actions`
- [ ] 2–4 way choices use `SegmentedControl`
- [ ] Tag pills use `Tag`, filter pills use `FilterChip`, number pills use `CountBadge`
- [ ] No hand-made floating panel (use `Popover`, `Dropdown` or `ContextMenu`)
