# StudioManager Design System

Reference guide for all UI patterns, tokens, and conventions. Every new component or page must follow these rules.

---

## Design Language

**Notion-clean**: minimal borders, whitespace-driven separation, bold titles with quiet labels, rounded-full badges, consistent dark/light modes via CSS custom properties.

---

## CSS Tokens

All colours are CSS custom properties in `src/index.css` (`@theme`, then `.dark`). Themes override them inline on `<html>` (see [Themes](#themes)).

**Rules**
- **No literal colours in components.** No hex, `rgb()`, `white`/`black`, Tailwind palette classes (`bg-gray-100`, `text-blue-500`, `text-white`, `bg-black/40`) or opacity-suffixed tokens (`bg-accent/20`, `text-muted/50`). Every colour is a token below. The exceptions: PDFs (they print on white, see [PDF palette](#pdf-palette)) and the Toggle knob (always white, it is a physical knob).
- **Borders by role**, never by look: a row/section divider, a surface edge, or a control edge.
- **Tints and the focus ring come from the accent at runtime**: use the utilities, never retype `color-mix`.
- **Text on a coloured fill** is `text-on-accent` / `text-on-danger` / `text-on-banner`, never `text-white`. The on-colour is whichever of white and near-black `#111827` has more contrast with the fill (`onColorFor` in `lib/themeTokens.ts`), so a mid-tone accent such as Orange gets near-black text.
- **Coloured text uses the `-text` token, never the solid.** Accent text is `text-accent-text` (links, active nav, accent badges, the selected menu row); status text is `text-success-text` / `text-warning-text` / `text-danger-text`. The solids (`accent`, `success`, `warning`, `danger`) are for fills, dots, borders and rings: as text they miss 4.5:1 on white or on dark.
- **Contrast targets**: 4.5:1 for text, 3:1 for a control boundary (the Checkbox edge). `src/__tests__/colourTokens.test.ts` computes them from the real tokens for every theme and preset.

### Backgrounds
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-bg` | `#ffffff` | `#111111` | Page background (also `body`) |
| `--color-surface` | `#ffffff` | `#161616` | Cards, panels, dropdowns |
| `--color-input-bg` | `#f5f5f5` | `#1a1a1a` | Input fields, progress bar tracks, inactive elements |
| `--color-hover-row` | `#f8f8f8` | `#1a1a1a` | Table row hover, button hover |
| `--color-raised` | surface | text 10% over surface | A control raised over its track: the SegmentedControl thumb (`bg-raised`), lighter than the track in dark |
| `--color-sidebar` | `#f8f8f8` | `#161616` | Sidebar background |
| `--color-scrim` | black 40% | black 40% | Behind a modal (`bg-scrim`) |
| `--color-overlay-hover` | black 10% | white 12% | Hover on something already coloured: the × in a Tag, chart cursors (`hover:bg-overlay-hover`) |

### Borders
Three roles, three distinct values, each step stronger:

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--color-border-divider` | `#f3f3f3` | `#1e1e1e` | **Divider**: table rows, section separators, faint lines inside a surface |
| `--color-border` | `#e8e8e8` | `#2a2a2a` | **Surface edge**: cards, menus, dialogs, popovers (`SURFACE`), the table header and footer, panel bars |
| `--color-input-border` | `#d4d4d4` | `#3a3a3a` | **Control edge**: inputs, selects, outline buttons, filter chips, the Toggle's off track. Under 3:1 by choice: a field's own fill already outlines it |
| `--color-checkbox-border` | `#949494` | `#6b6b6b` | **Checkbox edge** (`border-checkbox-border`): 3:1 against bg and surface, since the box is the whole control. Also the checkbox squares in Dropdown multi-select rows |
| `--color-sidebar-border` | `#e5e5e5` | `#333333` | Sidebar right edge |

(`--color-border-header` is gone: it was merged into `--color-border`.)

### Text
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-text` | `#111827` | `#e5e5e5` | Primary text (also `body`) |
| `--color-text-secondary` | `#374151` | `#d4d4d4` | Secondary text, hover states |
| `--color-muted` | `#5d6570` | `#b0b0b0` | Muted text, labels |
| `--color-text-faint` | muted 60% | muted 60% | Disabled glyphs only: under 4.5:1, never for content. Placeholders and timestamps use muted |
| `--color-on-accent` | `#ffffff` | `#ffffff` | Text and glyphs on an accent fill (`text-on-accent`, `bg-on-accent` for the Radio dot). Recomputed from the accent by `onColorFor`: white or near-black `#111827`, whichever contrasts more |
| `--color-on-danger` | `#ffffff` | `#111827` | Text on a danger fill (`bg-danger text-on-danger`, the danger CountBadge). `onColorFor(danger)`: dark mode's `#ef4444` takes near-black |
| `--color-on-banner` | `#ffffff` | `#ffffff` | Text on the test and presentation mode banners (`--color-banner-test` `#b45309`, `--color-banner-presentation` `#4f46e5`) |

### Accent
| Token / utility | Value | Usage |
|-------|-------|-------|
| `--color-accent` | `#2563eb` (preset or theme) | Fills, borders, rings, dots: primary buttons, selection, the active tab underline. Not text |
| `--color-accent-text` | light: accent 60% over text; dark: accent 60% over white | Accent-coloured **text** (`text-accent-text`): links, `Button variant="link"`, active NavItem, accent Badge, the selected Dropdown row, calendar events. 4.5:1 on bg, surface, accent-light and the accent tints for every preset |
| `--color-accent-light` | preset light / dark tint | Selected task chip, unread notification hover |
| `bg-accent-tint` | accent 5% | Selected menu row, editing table row, today in the calendar |
| `bg-accent-tint-strong` | accent 10% | Hovered selected row, drop zones, unread notification, dashboard drop placeholder |
| `bg-accent-handle` | accent 25% | Resize handles: panel resizers, column resize (`hover:bg-accent-handle active:bg-accent`) |
| `--color-accent-border` | accent 30% | A border around an accent-tinted box (`border-accent-border`) |
| `--color-focus-ring` | accent 50% | The one focus ring, see below |

**Focus.** One colour, `--color-focus-ring`, two shapes: `.focus-accent` (and every raw `button`/`[role=button]`) draws a 1px surface gap then a 2px ring on `:focus-visible`; `focus-row` draws a 2px inset ring on the keyboard-focused row of a list (`Table.Row focused`, Sidebar, Projects, Tasks). Never `ring-accent/40`.

### Status and tag colours
The 9 tag colours are variables: `--color-tag-{blue,purple,green,red,yellow,cyan,orange,teal,gray}-{bg,text}`, light in `:root`, dark in `.dark`. `lib/tagColors.ts` returns them as `var(…)` strings (see [Tags](#tags)).

Status colours alias them, so a status pill and a tag of the same colour are the same colour:

| Status token | Alias | Light bg / text | Dark bg / text |
|-------|-------|-------|-------|
| `--color-success-bg` / `-text` | green | `#dcfce7` / `#15803d` | `#052e16` / `#4ade80` |
| `--color-warning-bg` / `-text` | yellow | `#fef3c7` / `#92400e` | `#1c1917` / `#fbbf24` |
| `--color-danger-bg` / `-text` | red | `#fee2e2` / `#b91c1c` | `#2a1215` / `#f87171` |
| `--color-info-bg` / `-text` | blue | `#dbeafe` / `#1d4ed8` | `#1a2332` / `#60a5fa` |
| `--color-indigo-bg` / `-text` | (own) | `#e0e7ff` / `#4338ca` | `#1a1a2e` / `#818cf8` |

`--color-success`, `--color-warning`, `--color-danger` are the solid fills (dots, the now line, the Sidebar timer pulse); dark mode's danger is `#ef4444`. Status-coloured text (a StatTile value, an overdue date, a "paid" note) uses the `-text` token, never the solid. Calendar event kinds (`.fc-priority-high`, `.fc-deadline`, `.fc-invoice-overdue` → danger; `.fc-priority-medium`, `.fc-invoice-sent`, `.fc-quote-expiry` → warning; `.fc-done` → success) use the status tokens, so they follow dark mode and themes.

### Charts
`useChartTheme()` returns CSS variable strings (Recharts passes them to SVG): grid `--color-border-divider`, ticks `--color-muted`, cursor `--color-overlay-hover`, tooltip `--color-surface` / `--color-text` / `--shadow-menu`. Series use `--color-chart-1…8`, or a tag colour (`getTagColor(name).text`) when the series is a category.

### PDF palette
PDFs print on white and never follow the theme: `src/components/pdf/pdfPalette.ts` (`PDF.ink`, `muted`, `faint`, `rule`, `stripe`, status colours) is the one place their colours live. `documentStyles.ts`, `PdfDocumentLayout`, `InvoicesListPDF`, `ExpensesListPDF` and `PLPDF` all read it.

### Tailwind Usage
```tsx
// CORRECT
className="bg-[var(--color-surface)]"
className="border-[var(--color-border-divider)]"
className="hover:bg-[var(--color-hover-row)]"
className="text-[var(--color-text-secondary)]"

className="bg-accent text-on-accent"
className="bg-accent-tint-strong text-accent-text"
className="text-success-text"
style={{ background: getTagColor(tag).bg }}

// WRONG — never do this
className="bg-gray-100"
className="border-gray-200"
className="text-white"
className="bg-accent/20"
className="text-muted/50"
className="text-accent"        // accent as text: use text-accent-text
className="text-success"       // status solid as text: use text-success-text
className="border-[var(--color-input-border)]"   // on a card: that's a surface edge, use --color-border
style={{ color: dark ? "#888" : "#999" }}
```

### Dark Mode
`.dark` on `<html>` redefines the tokens; components never branch on dark mode for a colour. There is no `dark:` variant (the custom variant was removed): if a colour differs between light and dark, it is a token. Tag colours, status colours, chart colours and FullCalendar colours are all variables, so none of them reads `darkMode` from the store.

### Themes
A theme (`src/lib/themes.ts`) gives its base colours: bg, surface, text, muted, border, sidebar, accent, status solids and charts. `applyThemeColors` (`stores/app-store.ts`) sets the full token set inline on `<html>` from `themeTokens()` (`src/lib/themeTokens.ts`), deriving what the theme leaves out with `color-mix`: text-secondary, input-bg (text 8% over surface, so fields show on cards), hover-row (text 4% over bg), border-divider (fainter than border), input-border (stronger than border), checkbox-border (muted 75% over surface), the status bg/text pairs (text: the status colour 55% over text in dark, 50% in light), accent-text, and on-accent / on-danger from `onColorFor`. Dark custom themes also re-derive the tag palette from their surface (tag colour 15% over surface, text 50% over the theme text), so tags don't read as dark holes on a lighter surface. A theme's muted must reach 4.5:1 on its bg and surface (the test checks it). It sets `--color-bg` / `--color-text`, never `body.style`.

The two default themes mirror `src/index.css` value for value (the `colourTokens` test checks it). Choosing one clears the inline overrides so the stylesheet applies and the dark-mode toggle keeps working.

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
| Level 1: page title, one per page, always an `h1` | `HEADING_1` = `text-xl font-semibold tracking-tight` (`PageHeader`, `SidebarTitle`, wiki article title) |
| Level 2: card, widget, modal, peek panel, project block | `HEADING_2` = `text-sm font-semibold` (`PanelTitle`, `Card.Header`, `Modal` title) |
| Label (year groups, categories, stat captions) | `<SectionLabel>` (`text-[10px] font-medium uppercase tracking-widest text-muted`) |
| Stat value | `STAT_VALUE` = `text-xl font-semibold tabular-nums` (`StatTile`) |
| Table column header | `text-xs text-muted` (lowercase, not uppercase) |
| Body/row text | `text-sm` |
| Fine print (timestamps, hints, chart legends) | `text-xs text-muted` |
| Muted secondary | `text-muted` |

**Scale rule:** the only permitted sizes are `text-xl`, `text-sm`, `text-xs`,
and the 10px section label (`text-[10px]`). No other `text-[Npx]` arbitrary
sizes — 9px/11px/13px were folded into this scale (2026-08, audit item 345).

### Headings

- **Two title levels and a label.** No 12px, 16px or 18px titles (`text-xs`/`text-base`/`text-lg` headings). Use the `HEADING_1` / `HEADING_2` tokens (`ui/tokens.ts`) or the components built on them, never retyped classes.
- **Tags follow the page:** the `h1` page title, `h2` for its sections and cards, `h3` inside them. A modal title is an `h2` (the dialog is its own context). A page shown inside another (a peek panel) starts at `h2`.
- **Counts are a prop, never part of the string:** `<PanelTitle title={t.projects} count={n} />`, `<SectionLabel count={n}>`, `<Card.Header count={n}>`. The count is muted, plain weight, after the title (`HEADING_COUNT`). Not `` `${t.projects} (${n})` ``.
- **Stat values** are 20px: `StatTile` (label is a `SectionLabel`, value `STAT_VALUE`).

### PageHeader

Every page's title row is `ui/PageHeader`: the page's one `h1`.

```tsx
<PageHeader title={t.clients}><Button …>{t.new_client}</Button></PageHeader>
<PageHeader title={client.name} back={() => navigate(-1)} actions={…} />
<PageHeader title={t.edit_invoice} back={async () => { if (await confirmIfDirty("/invoices")) navigate("/invoices"); }} />
<PageHeader title={t.notifications} meta={`${n} ${t.unread}`} />
<PageHeader title={calTitle} leading={<>‹ › Today</>} actions={<SegmentedControl …/>} />
<PageHeader compact title={`${ref} — ${client}`} back={…} actions={…} />
```

- `back`: one `IconButton` (ArrowLeft, `t.back`). Put an unsaved-changes check in the callback.
- `meta`: a muted line under the title (client link, unread count). `leading`: before the title (calendar arrows).
- `actions` (or `children`): right-aligned.
- `compact`: preview pages. The `h1` at level 2 in a full-bleed bar with a bottom border on the surface fill.
- `as="h2"`: a page inside another page. `ProjectDetailContent` uses it in peek panels and is the `h1` on the project page.
- **Peek panels** (Projects, Calendar) open with `ui/PeekHeader`: close on the left, open the full page on the right, then the project's `PageHeader as="h2"`.
- **Sidebar pages** (Settings, Profile) put the title at the top of their sidebar with `ui/SidebarTitle` (level 1 `h1`).
- **Wiki:** an open article's title is the page `h1` (an editable field inside an `h1`, level 1). The explorer's "Wiki" label is the `h1` only when nothing with its own title is open. Prose headings are content and sit below the article title: `h1` 15px, `h2` 14px, `h3` 13px, all semibold (`src/index.css`, `.tiptap-editor .ProseMirror`, also used by DocView).

### Section labels

Every small uppercase label uses `src/components/ui/SectionLabel.tsx`. There is one style only: never `text-xs uppercase`, never `tracking-wide`/`tracking-wider`, never `font-semibold` uppercase.

```tsx
<SectionLabel className="mb-2">2026</SectionLabel>
<SectionLabel as="h2" action={<IconButton icon={Plus} label={t.add} size="xs" />}>{t.backlinks}</SectionLabel>
```

- **Heading tag:** use `as="h2"`/`"h3"` when the label names a section.
- **Count:** `count` puts a muted number after the label.
- **Action:** `action` puts a button on the right of the same row.
- **Spacing:** it sets no margin, so the caller adds it.
- **Class string:** for a `<th>` or a third-party heading, use the `SECTION_LABEL` class string. `MENU_GROUP_LABEL` and `SectionHeader` (`ui/Settings`) are built on it.

---

## Spacing

4px base grid — use Tailwind spacing steps (including quarter steps like
`py-1.75`), never `p-[Npx]` arbitrary values.

| Context | Classes |
|---------|---------|
| Table cells | `Table` sets them: 16px sides (12px compact), see [Tables](#tables) |
| Card padding | `Card padding`: `md` 16px (default), `sm` 12px (nested and compact cards), `none` (the content pads itself), see [Card](#card) |
| Between cards | 16px everywhere: `CARD_GAP` (`gap-4`) in a grid or row, `CARD_STACK` (`space-y-4`) in a stack; cards nested in a card sit 8px apart (`space-y-2`) |
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

Four shadows, as variables in `src/index.css` (`:root`, deeper in `.dark`), each with a utility. No Tailwind `shadow-sm/md/lg` and no arbitrary `shadow-[…]`.

| Token / utility | Value (light) | Element |
|---------|-------|-------|
| `shadow-control` (`--shadow-control`) | `0 1px 2px rgba(0,0,0,0.08)` (dark 0.4) | Small lift on a control: SegmentedControl thumb, the selected theme card |
| `shadow-knob` (`--shadow-knob`) | `0 1px 3px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(0,0,0,0.12)` | The Toggle's white knob, so it shows on a light off track |
| `shadow-menu` (`--shadow-menu`) | `0 8px 24px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06)` (dark `0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)`) | Anything floating: dropdowns, context menus, popovers, tooltips, chart tooltips, BulkActionBar, the import bar, dragged items |
| `shadow-modal` (`--shadow-modal`) | `0 16px 48px rgba(0,0,0,0.5)` (dark adds the same 1px white 6% edge) | Modals |

In dark mode a dark shadow alone doesn't show on a dark page, so floating surfaces get a faint light edge.

Cards have no shadow: they separate by their border.

---

## Icon Sizes

All icons use **lucide-react**, picked from `ICONS` and sized by `ICON_SIZE` (both in `src/components/ui/icons.ts`, exported from `ui`). Never use unicode characters (no `✓`, `✕`, `←`, `→`); ESLint flags `✓ ✔ ✕ ✖ ✗` in JSX text and off-scale sizes (`11`, `13`, `15`, `17`).

**Components size their own icons.** Pass the component, not an element, and no size:

```tsx
<Button icon={ICONS.download}>{t.export}</Button>              // 12
<IconButton icon={ICONS.more} label={t.more_actions} />         // 14 (sm) / 12 (xs)
<NavItem icon={ICONS.settings} …>{t.general}</NavItem>           // 14
{ label: t.delete, icon: ICONS.delete, danger: true, onSelect } // menu row: 14
<Card.Header icon={ICONS.file} title={…} />                      // 14
<EmptyState icon={ICONS.project} message={…} />                  // 32 (lg) / 20 (sm)
```

`Button`, `IconButton`, `NavItem`, `TabItem`, `Card.Header`, `ContextMenu` / `Dropdown` / `DropdownSelect` items, `MenuItem`, `BulkActionBar` actions, `ConfirmButton` and `EmptyState` take a lucide component (`IconProp`). An element is kept as is: use one only when the icon needs its own class (a colour), and size it with `ICON_SIZE`. For an icon outside those slots, write `<ICONS.warning size={ICON_SIZE.control} />`; `renderIcon(icon, size)` does the same for a slot of your own.

| `ICON_SIZE` | px | Where |
|-------------|----|-------|
| `pill` | `10` | Inside a tag or filter pill, the checkbox tick, a pinned tab's pin |
| `control` | `12` | `Button`, `IconButton size="xs"` (table rows, lists), `Input` leading icon, `DropdownSelect` trigger, sort arrows, small inline icons |
| `menu` | `14` | `IconButton size="sm"` (toolbars, headers, dialog close, back), menu rows, `NavItem`, `TabItem`, `Card.Header`, `DragHandle` |
| `callout` | `16` | `Callout`, notification rows |
| `nav` | `18` | App sidebar, with `ICON_STROKE.nav` (1.5): `navIcon(icon)` |
| `emptySm` | `20` | `EmptyState size="sm"` |
| `empty` | `32` | `EmptyState` (lg) |

`ICON_STROKE`: `default` 2, `nav` 1.5 (app sidebar), `check` 3 (the checkbox and multi-select tick).

### Icon Choices (canonical)

One icon per concept, so the same thing always looks the same. Use the `ICONS` key, never the lucide name. An icon that names no concept (a chevron, a zoom glass, a column type from `workload/columnIcons.tsx`) is imported from lucide-react and passed the same way.

| Concept | `ICONS.` | Icon | Notes |
|---------|----------|------|-------|
| Add / create | `add` | `Plus` | |
| Edit | `edit` | `Pencil` | Never `Edit`, `Edit2`, `PenLine` |
| Delete | `delete` | `Trash2` | Never `X` or `Minus` |
| Close / dismiss | `close` | `X` | Never `✕` |
| Search | `search` | `Search` | |
| Row "more" menu | `more` | `Ellipsis` | Never `Settings2` (that's settings) |
| Settings | `settings` | `Settings2` | |
| Behaviour settings | `behavior` | `SlidersHorizontal` | |
| Appearance | `appearance` | `Palette` | |
| Save, selected, mark read | `save` · `selected` · `markRead` | `Check` | |
| Mark all read | `markAllRead` | `CheckCheck` | |
| Done, mark done / paid, success | `done` · `markDone` · `markPaid` · `success` | `CircleCheckBig` | |
| Mark unpaid, undo done | `markUnpaid` · `undoDone` | `RotateCcw` | `CircleX` is only for danger |
| Danger / failed | `danger` | `CircleX` | |
| Mark active | `markActive` | `CircleDot` | |
| On hold | `onHold` | `Pause` | |
| Start / stop timer | `startTimer` · `stopTimer` | `Play` · `Square` | |
| Warning | `warning` | `TriangleAlert` | |
| Error | `error` | `CircleAlert` | |
| Info | `info` | `Info` | |
| Reminder | `reminder` | `BellRing` | `Bell` is notifications |
| Notifications | `notifications` | `Bell` | |
| Open externally, new tab | `openExternal` · `newTab` | `ExternalLink` | |
| Go to linked record | `goToLinked` | `ArrowUpRight` | |
| Preview | `preview` | `Eye` | |
| Expand / maximize | `maximize` | `Maximize2` | |
| Drag handle | `drag` | `GripVertical` | |
| Copy | `copy` | `Copy` | |
| Duplicate | `duplicate` | `CopyPlus` | |
| Download, export | `download` · `export` | `Download` | |
| Upload | `upload` | `Upload` | |
| Send · email | `send` · `email` | `Send` · `Mail` | |
| Link · unlink | `link` · `unlink` | `Link` · `Unlink` | |
| Pin | `pin` | `Pin` | |
| Saved filter | `savedFilter` | `Star` | `Bookmark` is a resource |
| Recurring | `recurring` | `Repeat` | |
| Updates | `updates` | `RefreshCw` | |
| Save layout | `saveLayout` | `Save` | |
| Dashboard | `dashboard` | `LayoutDashboard` | |
| Client | `client` | `Users` | |
| Contact | `contact` | `UserRound` | |
| Profile | `profile` | `UserCircle` | |
| Organisation | `organisation` | `Building2` | |
| Project | `project` | `FolderKanban` | |
| Open folder | `openFolder` | `FolderOpen` | |
| New project | `newProject` | `FolderPlus` | |
| Task | `task` | `SquareCheck` | |
| Invoice | `invoice` | `Receipt` | |
| Quote | `quote` | `FilePlus2` | |
| Convert to invoice | `convertToInvoice` | `FileOutput` | |
| Invoice templates | `invoiceTemplates` | `LayoutTemplate` | |
| Expense | `expense` | `CreditCard` | |
| Income | `income` | `TrendingUp` | |
| Finances | `finances` | `BarChart3` | |
| Wiki article | `wikiArticle` | `BookOpen` | |
| File · document | `file` · `document` | `File` · `FileText` | |
| Resource | `resource` | `Bookmark` | |
| Demo data | `demoData` | `Database` | |
| Time · timer | `time` · `timer` | `Clock` · `Timer` | |
| Calendar | `calendar` | `CalendarDays` | |
| Date field · date range | `dateField` · `dateRange` | `Calendar` · `CalendarRange` | |
| Back | `back` | `ArrowLeft` | |
| Previous / next | `prev` · `next` | `ChevronLeft` · `ChevronRight` | Calendars, carousels |
| Reorder | `moveUp` · `moveDown` | `ChevronUp` · `ChevronDown` | |
| Move a column | `moveLeft` · `moveRight` | `ArrowLeft` · `ArrowRight` | |
| Sort | `sortAsc` · `sortDesc` · `sortNone` | `ArrowUp` · `ArrowDown` · `ArrowUpDown` | |
| Collapse / expand sidebar | `collapseSidebar` · `expandSidebar` | `PanelLeftClose` · `PanelLeftOpen` | |

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

<Card>Content</Card>                                  // rounded-xl, surface fill, 16px, no border
<Card tone="inset" padding="sm">…</Card>              // a card inside a card
<Card tone="dashed" padding="sm">…</Card>             // an add / draft box
<Card interactive selected={open} onClick={…}>…</Card> // a clickable card

<Card>
  <Card.Header title={t.contacts} count={contacts.length} variant="label" action={<Button variant="link" …>{t.add}</Button>} />
  …
</Card>
```

- **`padding`:** `md` 16px (default), `sm` 12px (nested and compact cards), `none` (rows that touch the edges bring their own padding: SettingsCard, NamedTable, the dashboard widget frame). There is no 20px card.
- **`tone`:**
  - `surface` (default): the surface fill, no border.
  - `inset`: surface plus a 1px `border-divider` border. A card inside a card is **always** bordered (ClientDetail contacts and addresses, NamedTable in a project block, wiki backlink cards, the link pickers of project blocks).
  - `dashed`: transparent with a dashed `input-border` border, for add and draft boxes (contact and address drafts, "Add block", an unlinked wiki mention).
- **`interactive`:** hover tint (`hover-row`), pointer and the accent focus ring. On a div with `onClick` it adds `role="button"`, `tabIndex=0`, and Enter / Space click it (the key stops there, so a page-level list shortcut doesn't act twice). Use `as="button"` when the whole card is one action (wiki backlinks).
- **`interactive="link"`:** for a clickable card that holds its own controls (the projects grid with its bulk checkbox, notifications with their icon buttons): a `role="button"` can't contain other buttons. The card gets the hover tint and pointer only; its title is a real `<button>` (or `<Link>`) with `className={CARD_LINK}`, whose `::after` stretches over the card, so a click anywhere opens it and Enter / Space work natively on the title. The ring shows on the whole card. Inner controls take `CARD_CONTROL` (`relative z-10`) to sit above the overlay.
- **`selected`:** the accent outline on a `hover-row` fill (the open or bulk-selected project, the expanded workload template).
- **`as`:** `div` (default), `section` / `article` for a landmark, `li`, `button`. Other props (`onContextMenu`, `style`, `ref`, `aria-*`, `data-*`) pass through.
- **`cardClass({ padding, tone, interactive, selected })`:** the class string, for an element that can't be a Card.
- **`Card.Header`:** the card's title row. `title` is the level-2 title (14px, PanelTitle underneath, so title weight lives in one place), 12px below it (`className` replaces that margin, e.g. `px-3 py-2` for a header row in a `padding="none"` card).
  - `count`: a muted number after the title. Never write "(3)" into the title.
  - `action`: right-aligned slot, several controls are fine. `onClose` adds the close IconButton after it.
  - `icon`: leading content: a lucide component (drawn at 14px), or an element (a drag handle, a collapse chevron).
  - `variant="label"`: the 10px uppercase SectionLabel instead of the title.
  - `divider`: a rule under the header (SettingsCard, SectionHeader). `subtitle`: one muted line under the title.
  - There is no 16px card title.
- **Built on Card:** SettingsCard (`tone="inset" padding="none"` + `Card.Header variant="label" divider`), the dashboard widget frame (`padding="none"` + the drag classes; WidgetShell is the 16px content and WidgetTitle is a `Card.Header`), project blocks, the Finances and Client pages, the recurring-invoices and widget-store panels.
- **`StatTile`** (`ui/StatTile.tsx`): a SectionLabel, the value (`STAT_VALUE`: 20px semibold, tabular) and an optional muted `caption`, with a `tone` for the value. The dashboard KPI widgets use it with `h-full justify-center p-4`.

### Button
```tsx
import { Button } from "../components/ui";
<Button icon={ICONS.add}>Label</Button>
```
**One size.** Every button is 26px tall, with 12px text and `rounded-md`. That is the same height as Input, Select, DatePicker and FilterChip, so every control in a row lines up. There is no `size` prop. The main action stands out by colour (primary), not by size.

**Variants:**
- `primary`: the main action.
- `secondary`: a grey fill.
- `outline`: bordered and transparent; this was "ghost".
- `danger`: outlined red, for every destructive action.
- `link`: text only.

**`loading`:** a spinner replaces the icon, and the button stays focusable: it is `aria-disabled` and `aria-busy`, and clicks (also a form's Enter submit) are ignored. It is not `disabled`, which would drop the keyboard focus to `<body>`. `disabled` still disables.

Deep dive, with the counts behind this choice: [StudioManager Button](https://claude.ai/artifact/1wWC1A5CxpM4qxsXjd6wbw). The IconButton one: [StudioManager IconButton](https://claude.ai/artifact/BMjCuNLsU3XthiC8Vjmewo).

### Button Icon Rules
- **Icon + text**: always use `<Button icon={ICONS.add}>Label</Button>` (Button draws it at 12px, see [Icon Sizes](#icon-sizes)) — never raw `<button>` with icon and text side by side
- **Icon-only**: use `<IconButton icon={Pencil} label={t.edit} />` (see Icon Buttons below). Never use the shared `Button` for icon-only actions, and never a raw `<button>` with only an icon in it.
- Never put a lucide icon inside a `<button>` alongside text without using the shared Button component

### Icon Buttons

`src/components/ui/IconButton.tsx`, for every button that is only an icon.

```tsx
<IconButton icon={Pencil} label={t.edit} onClick={edit} />
<IconButton icon={Trash2} label={t.delete} size="xs" tone="danger" reveal onClick={remove} />   // row action
<IconButton icon={X} label={t.remove} size="xs" reveal="task" />                              // row with group/task
<IconButton icon={ICONS.more} label={t.more} {...pop.triggerProps} />
<IconButton to={`/invoices/${id}`} icon={ICONS.preview} label={t.preview} reveal />        // a router Link
<IconButton href={url} target="_blank" icon={ICONS.openExternal} label={t.open} />          // an <a>
```

| Prop | Values | |
|------|--------|--|
| `icon` | a lucide icon component | `ICONS.edit`, not `<Pencil />` |
| `to` · `href` | a route · a URL | Renders a router `Link` or an `<a>` with the same look, for an icon that navigates (open a record). Other anchor props (`target`, `rel`) pass through. |
| `label` | string (required) | aria-label and hover title, from `useT()` |
| `size` | `sm` (default) · `xs` | `sm`: a 26px square with a 14px icon (toolbars, headers, dialogs, next to fields). `xs`: a 20px square with a 12px icon (inside table rows, lists, tree rows). The box is fixed, so there's no padding to set. |
| `tone` | `default` · `danger` · `accent` | Hover colour and tint: text + hover-row, danger-text + danger-bg, accent + hover-row |
| `reveal` | `true` · `"row"` · `"task"` · `"sub"` · `"item"` · `"col"` | Hidden until its row is hovered (`true` is the nearest `group`; a name targets `group/<name>`) or the button has keyboard focus |
| `active` | boolean | Open look, visual only (an open menu's trigger) |
| `pressed` | boolean | A toggle: `aria-pressed` and the active look when true. Keep the `label` the same in both states |
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

- **Icon sizes**: Button draws its `icon` at `12`; IconButton at `14` (sm) or `12` (xs). Pass the component, never a size.
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
import { Input, Textarea, InlineRename, AddRow } from "../components/ui";

<Input value={v} onChange={…} />                                  // 26px, like every control
<Input numeric step="0.01" unit={currency} width="md" />         // amounts
<Input numeric unit="h" width="xs" aria-label={t.hours} />       // short numbers
<Input icon={Search} onClear={() => setQ("")} />                  // SearchBar is this
<Input variant="bare" aria-label={col.name} />                    // table cells: frame shows on hover/focus
<Input readOnly value={linked} />                                 // shown, not editable here
<Input detected={isDetected("amount")} />                         // filled from a receipt scan
<Textarea value={notes} onChange={…} />                           // 3 rows, grows to 12, then scrolls
<Textarea fill value={note} onChange={…} />                       // fills its parent (dashboard note)
<InlineRename value={name} label={t.rename} onSave={save} onCancel={close} />
<AddRow placeholder={t.new_task} onAdd={createTask} />
```

One size: `CONTROL_BOX` (`px-2.5 py-1 text-xs leading-4 border`) and `rounded-md`, the height of Button and the Select trigger. There is no `size` prop.

| | Look |
|--|--|
| `variant="default"` | `bg-[var(--color-input-bg)] border-[var(--color-input-border)]`, `focus-accent` |
| `variant="bare"` | transparent; border and fill appear on hover/focus (table cells) |
| `variant="inline"` | transparent, `border-b border-accent`, `focus-accent`, inherits the font (use `InlineRename`) |
| `readOnly` | no fill, dashed border, muted text |
| `detected` | accent border. An error border (`aria-invalid`) still wins |
| `aria-invalid` | red border. FormField sets it from `error` |

- **Numbers:** `numeric` aligns right with tabular digits (`NUMERIC`), hides the spinner arrows and defaults `type` to `"number"`. Money fields take `step="0.01"`.
- **Units:** `unit` is a muted suffix inside the box (`CHF`, `%`, `h`, `m`), read out with the field. Never a span next to the field. An amount shows its record's currency (the invoice's or quote's, CHF elsewhere).
- **Icon and clear:** `icon` is a leading 12px icon. `onClear` adds a trailing `xs` clear `IconButton` while there is a value (`clearLabel` names it). `trailing` takes your own control (DatePicker's calendar button).
- **Width:** full width by default. Short fields take `width`: `xs` 64px (hours, minutes), `sm` 96px (rates, %), `md` 144px (amounts with a unit). Never `w-16`/`w-24`/… on a field.
- **Wrapper:** with `icon`, `unit`, `onClear` or `trailing`, the field sits in a wrapper: `className` goes on the wrapper (layout) and `inputClassName` on the field.
- **Textarea:** `rows` (3) is the starting height. It grows with its content up to `maxRows` (12), then scrolls: CSS `field-sizing: content`, with a height that follows the content where the engine lacks it. Notes use the default 3 rows. `fill` fills the parent's height, without growing or a resize handle.
- **Names:** every field has one: a `FormField` label, or `aria-label` (table cells: the column name).
- **Dark mode:** the native-field defaults in `src/index.css` sit in `@layer base`, so these classes win over them.
- **Class string:** for the rare control that can't be one of these, use `fieldClass({ variant, width, readOnly, detected, numeric })`.
- **Not text fields:** checkboxes, radios, colour and file inputs stay native.

#### InlineRename

`src/components/ui/InlineRename.tsx`, for a row's name edited in place (table, list, task, filter, organisation). It opens focused with the text selected and inherits the row's font (pass the text size in `className`, with `flex-1` to fill the row).

- Enter and blur call `onSave(name)` with the trimmed name; the caller saves and closes the field. Enter doesn't submit a surrounding form.
- Esc, or an empty or unchanged name, calls `onCancel`. Esc doesn't reach the dialog.
- `validate(name)` returns an error to show under the field (`FieldError`), and the field stays open. `error` shows one from outside (a failed save).
- `label` is the field's accessible name.

#### AddRow

`src/components/ui/AddRow.tsx`, the field and "+" under a list that add an item (tasks, subtasks, list items, options, presets).

- Enter or "+" calls `onAdd(text)` with the trimmed text, never empty. Enter doesn't submit a surrounding form.
- The field clears after the add, or once a returned promise resolves. Return `false` to keep the text (a duplicate).
- `placeholder` names the field and the button. `size` is the button's: `sm` beside form fields, `xs` in dense lists. Extra controls (a colour select) go in `children`, before the "+". `onKeyDown` runs after Enter (Esc to close).

#### TagInput

`src/components/shared/TagInput.tsx`, tag entry on wiki articles and resources: the tags as `Tag` pills with a remove button, then a field.

- Enter or comma adds the trimmed text (never empty, never a duplicate) and doesn't submit a surrounding form.
- `suggestions` (minus the tags already set) show as the field's autocomplete. `lowercase` stores tags in lower case (wiki).
- `readOnly` shows the pills only. `variant="bare"` and `width` as for Input. Inside a `FormField` the field gets the label.

#### SearchBar

`SearchBar` is `Input` with `icon={Search}` and `onClear`, 256px wide by default (`className` sets the width). See [SearchBar](#searchbar).

### Dates

Every date field uses `DatePicker` from `src/components/ui/DatePicker.tsx`. Never use a native `<input type="date">`.

```tsx
<DatePicker value={due} onChange={setDue} />                        // "yyyy-MM-dd" | null
<DatePicker variant="bare" value={d} onChange={…} />                // table cells, inline metadata
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
  - The grid is one tab stop (the selected day, else today, else the 1st). Arrows move by day and week, Home / End to the week's Monday / Sunday, PageUp / PageDown by month; moving past the month turns the page.
- **Looks:** `variant` `default`/`bare` and `detected`, as for Input. The calendar button is the Input's `trailing`. `className` goes on the wrapper (layout). `inputClassName` goes on the field.
- **`TaskDatePicker`** (end date, times, reminder) is built on `Calendar`, `DateShortcuts` and `Toggle size="sm"`.

### Checkbox

`Checkbox` and `Radio` from `src/components/ui/Checkbox.tsx`. Never use a raw `<input type="checkbox">` or `type="radio"`.

```tsx
<Checkbox checked={done} onChange={(e) => toggle(e.target.checked)} aria-label={t.done} />
<Checkbox checked={all} indeterminate={some} onChange={selectAll} aria-label={t.select_all} />
<Checkbox label={t.show_income} description={t.show_income_desc} checked={…} onChange={…} />
<Radio name="seed" label={t.start_empty} description={…} checked={!seed} onChange={() => setSeed(false)} />
```

- **Look:** a 14px box on `input-bg` with a `checkbox-border` (3:1, stronger than field borders). Checked is an accent fill with a white check. `indeterminate` (select-all with some rows selected) shows a dash.
- **A real input:** there's a native input underneath, so `onChange(e)`, `e.nativeEvent.shiftKey`, `e.target` and `ref` all work as before.
- **`label` and `description`:** they make the text clickable. Without a label, give it an `aria-label`.
- **`className`:** goes on the outer wrapper, for layout only.
- **On/off settings:** use `Toggle`. Checkbox is for selecting items or ticking things off.

### Modal
```tsx
import { Modal, Kbd } from "../components/ui";
<Modal open={open} onClose={close} title="Title" footer={<Button>Close</Button>}>
  Content
</Modal>

// palette-style: top of the window, content laid out edge to edge
<Modal open={open} onClose={close} position="top" size="md" padding={false} aria-label={t.quick_timer}>
  … <Kbd>Esc</Kbd>
</Modal>
```

- **Three widths:**

  | `size` | Width | For |
  |--|--|--|
  | `sm` (Modal's default) | 400px | Confirmations, prompts, forms of one to three fields (rename, paid date, make recurring, new organisation, save as template) |
  | `md` (FormModal's default) | 560px | Record forms (client, expense, income, project, resource), the column editor, the quote-to-project wizard, the command palette, the quick timer |
  | `full` | 80% × 85% of the window | Viewers (receipts, PDFs): the content fills it |

- **Height:** every size stops at 85% of the window. The header and the footer stay put; only the body scrolls.
- **Padding:** the body has 20px on every side, with or without a title. `padding={false}` drops it for content that lays itself out edge to edge (palettes, viewers).
- **Fields mean FormModal:** a dialog with fields is a `FormModal` (see [Forms](#forms)), never a Modal with a hand-wired Enter key. Give the first field `autoFocus`.
- **Questions mean ConfirmDialog:** see [Confirmations](#confirmations).
- **A name for every dialog:** a `title`, or an `aria-label` when there is none (palettes).
- **Rendering:** it renders on `<body>`, so a transformed panel (the side peek) can't trap it. Tests should query `document` or `screen`, not the render container.
- **Position:** `position="top"` places the dialog 20% from the top.
- **Built in:** backdrop click and Esc close the dialog (only the topmost one, when a confirmation is open over a form), focus is trapped while open (Tab skips `tabindex="-1"` elements such as calendar days, and hidden ones), and focus returns to where it was on close.
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
Use while data is loading. Match the shape of what will appear: `ListSkeleton`, `CardGridSkeleton`, `DetailSkeleton` and `TableSkeleton` are ready-made; see [Empty, loading and error states](#empty-loading-and-error-states).

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
<FilterChip tag={tag} active={tagFilter === tag} activeIcon={<ICONS.close size={ICON_SIZE.pill} />} onClick={…} />
```

- **Off:** `border-[var(--color-input-border)] text-muted`, with a hover-row background on hover.
- **On:** `bg-accent text-on-accent`. With `tag`, it takes the tag's own colour instead.
- **Size:** `px-2.5 py-1 text-xs rounded-full`.

### CountBadge

`<CountBadge value={3} />`: a 16px number pill (`text-[10px]`). `tone` is `neutral` (the default), `danger`, `accent` or `inverse` (inverse sits on an accent fill). Anything above `max` (99) shows as "99+".

### Raw colours

For charts and other cases where no pill is drawn, use `getTagColor(name)`, `getStoredTagColor(colorName)` and `getNamedTagColor("green")` from `lib/tagColors`. They return `var(--color-tag-…)` strings that follow dark mode by themselves, and work anywhere a CSS colour goes (inline styles, SVG fill, FullCalendar event colours). To tint one, mix it: `` `color-mix(in srgb, ${c.text} 25%, transparent)` ``, never append a hex alpha. Never hand-build a coloured pill from them.
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

The variants' colours are the status tokens, which alias the tag palette (green, yellow, red, blue; indigo has its own pair). See [Status and tag colours](#status-and-tag-colours). Danger text is one value (`#b91c1c` light, `#f87171` dark), warning one pair (`#fef3c7` / `#92400e` light). Dots use the solids: `invoiceStatusDotClass` and `priorityDotClass` return `bg-success` / `bg-warning` / `bg-danger`.

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
- **Required:** an accent `*`. **Hint:** a muted line under the field. **Error:** the red line that takes the hint's place on screen, announced, with the field's border in red. The hint stays linked (`sr-only` while there is an error): the field's `aria-describedby` is its own ids, then the hint, then the error, merged, never replaced.
- **Fields:** one height, 26px. Don't add padding to make one taller.
- **Checkboxes and toggles:** their own `label` / `description`, never wrapped in a hand-written `<label>`.
- **Actions:** right-aligned with the primary last: Cancel (secondary), other actions, primary. A destructive action sits on the far left. In a Modal they go in `footer`, which is the same row.
- **Every dialog with fields is a `FormModal`:** creating a record (client, expense, income, project, resource, `md`) and the small prompts (new organisation, paid date, make recurring, save as template, `sm`). The body is a `<form>`, so Enter submits; Cancel · other actions · primary in the footer, a Delete in `destructive` on the far left (the column editor). The first field has `autoFocus`. While it saves, pass `submitting` (spinner on the primary, no second submit), not `submitDisabled`, which is for a form that isn't ready. A field that uses Enter itself (suggestions, tag entry) calls `preventDefault`. Tests press Enter with `pressEnter` (`src/__tests__/fixtures/form.ts`): happy-dom doesn't submit a form from a keydown.
- **Spanning:** `FormField span={2 | 3 | 4 | "full"}`; anything else in a grid (a checkbox row, a note) goes in `FormGridItem`.
- **Buttons inside a form** don't submit it unless they are `type="submit"`: `Button` defaults to `type="button"`. `FormModal`'s form is `noValidate`, so the app's own errors show, not the browser's.
- **Errors without a visible label** (a row rename, the line-items check) use `FieldError`.
- **A label over several controls** (a colour and its hex field, a list of checkboxes, an options editor) is a `FormGroup`; its `action` sits at the right of the label row.
- **Options editor:** the options of a select column and the items of a custom list use `OptionsEditor` (`src/components/shared/OptionsEditor.tsx`), never a hand-built list. One row per option (its `Tag` and colour `Select`, or with `colors={false}` its name in an `Input`, renamed in place), a remove `IconButton`, and an add row (`Input`, colour, "+") where Enter adds and doesn't submit the form; empty and duplicate names are ignored. With `label` it is a `FormGroup`. `onLink` / `onUnlink` put "Import from list" (a `Dropdown`) or the linked list and "Unlink" in the label row; while linked the options are read-only. `onSaveAsList(name)` adds "Save as list". It holds no data: the caller owns the options and the custom-list calls.
- **Small editor cards** (a contact, an address) use `FormLayout dense capped={false}`: 12px between the fields and the buttons.
- **Width:** page forms cap at 768px (`FORM_WIDTH`). Pass `capped={false}` in modals, popovers and side panels.
- **Not this layout:** settings rows (`SettingRow`, label left and control right), filter bars, single-field inline adds and row editing in tables.

---

## Tables

Every data table uses `Table` (`src/components/ui/Table.tsx`). Don't write `<table>`, `<th>` or `<td>` classes by hand.

```tsx
<Table density="default">                     {/* or "compact" */}
  <Table.Head>
    <Table.SelectAll all={…} some={…} onToggle={bulk.toggleAll} label={t.select_all} />
    <SortHeader label={t.date} sortKey="date" current={sort} onSort={setSort} />
    <Table.Th numeric>{t.amount}</Table.Th>
    <Table.ActionsTh />
  </Table.Head>
  <Table.Body>
    <Table.Group colSpan={4} label="2026" count="3 invoices" total="CHF 18 130.50" open={open} onToggle={toggle} />
    <Table.Row data-list-row onOpen={() => open(row)} focused={i === focusIdx} selected={…} onContextMenu={…}>
      <Table.Select checked={…} onToggle={(shift) => bulk.toggleItem(row.id, shift)} label={t.select_row.replace("{name}", row.reference)} />
      <Table.Td muted>{date}</Table.Td>
      <Table.Td numeric>{amount}</Table.Td>
      <Table.Actions><IconButton size="xs" icon={ICONS.more} label={t.more_actions} onClick={…} /></Table.Actions>
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

- **Header:** 32px in both densities, `text-xs font-medium text-muted`, lowercase, header line under it. Sortable or not, it looks the same. `Th`, `SortHeader`, `SelectAll` and `ActionsTh` are `scope="col"`.
- **Selection:** `label` is required on `Table.SelectAll` (`t.select_all`) and `Table.Select` (`t.select_row` with the row's name), so every checkbox is named.
- **Keyboard:** `useListNavigation` moves DOM focus onto the row (`tabindex="-1"`, the `focus-row` ring), so a screen reader reads it. It leaves keys alone on controls (buttons, links, comboboxes, radios, tabs, switches) and keys another handler already took.
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
<ProgressBar value={p.pct} aria-label={`${t.progress}: ${p.name}`} /> // no text label: a string aria-label is required
<Callout tone="warning" action={<Button>…</Button>}>{msg}</Callout>  // warning|info|danger|success
<ConfirmButton label={t.delete} question={t.confirm_delete_named.replace("{name}", ref)} onConfirm={remove} />
<DragHandle {...attributes} {...listeners} reveal />                // dnd-kit grip; reveal = group hover
<IconButton to={path} icon={ICONS.maximize} label={t.open_full_page} />   // an icon link: IconButton `to`, not Tooltip + Link
```

- **Hints:** never use the native `title` attribute for a hint on a button or link. Use `Tooltip`, or `IconButton`, which shows its `label` as a tooltip. A tooltip that only repeats the element's `aria-label` is not linked as its description (it would be read twice); one that adds something (a shortcut) is. `title` stays only on truncated plain text, where it reveals the full text.
- **Asking before an action:** see [Confirmations](#confirmations).
- **Telling the user what happened:** see [Toasts](#toasts).
- **Nothing to show, still loading, failed to load:** see [Empty, loading and error states](#empty-loading-and-error-states).

---

## Empty, loading and error states

Every surface that reads data goes through the same five states, in this order. From `QueryState.tsx`, `EmptyState.tsx`, `Skeleton.tsx`, `TableSkeleton.tsx` and `components/ErrorFallback.tsx`.

| State | Shows | Never |
|---|---|---|
| Loading (no data yet) | A skeleton the shape of the content | The empty text, "Loading..." text, a page spinner |
| Failed (no data to show) | Danger `Callout`: "Couldn't load {thing}" (`t.load_error_*`) + **Retry** (`refetch`) | "No X yet" + a create button; the raw `error.message` |
| Empty | `EmptyState`: specific wording + the "New …" action | "No data" |
| No results (search / filters match nothing) | `NoResults`: "No results" + **Clear filters** | A create button |
| Not found (bad id) | `EmptyState` with a hint and a "Back to …" button | The list's empty text |

```tsx
<QueryState
  query={projectsQuery}                     // a TanStack Query result
  skeleton={<CardGridSkeleton />}
  errorMessage={t.load_error_projects}
  empty={<EmptyState icon={FolderOpen} message={t.no_projects} action={newButton} />}
  noResults={filtered.length === 0 ? { message: t.no_matching_projects, onClear: clearFilters } : undefined}
>
  {(projects) => <Grid rows={filtered} />}
</QueryState>
```

- **`isEmpty`** defaults to "an empty array"; pass your own for other shapes. A refetch that fails while data is cached keeps the data on screen.
- **Tables:** wrap the `Table` in `QueryState` with only `skeleton` and `errorMessage`. Empty and no-results go in `Table.Empty`, so the header stays: `all.length === 0 ? <EmptyState …/> : <NoResults onClear={clearFilters} />`.
- **Surfaces without a whole query** (a detail page, a block reading two queries): `QueryError` and the skeletons work alone. Test `data === undefined` for "loading", not `isLoading`: a disabled query (bad id) is not loading, it is not found.
- **Clear filters** resets the page's search, its status chip / tag filter and the saved-filter conditions (and the active saved filter). Palettes, pickers and dropdowns say "No results" with no Clear button.

### EmptyState

```tsx
<EmptyState icon={ICONS.task} message={t.no_tasks_yet} hint={t.no_tasks_yet_hint} action={<Button …>{t.new_task}</Button>} />
<EmptyState size="sm" icon={ICONS.done} message={t.nothing_overdue} />
<EmptyState tone="danger" icon={ICONS.warning} message={t.page_error_title} action={retry} />
```

| Size | Where | Icon | Text | Padding |
|---|---|---|---|---|
| `lg` (default) | Pages, a page's table | 32px | `text-sm` message, `text-xs` hint | `py-12` |
| `sm` | Dashboard widgets, project and client blocks, side panels, popovers | 20px | `text-xs` | `py-4` |

- `icon` takes the Lucide component (`icon={FolderOpen}`) so the size follows `size`; an element is kept as is.
- **Wording:** say what is empty: "Nothing overdue", "No unpaid invoices", "No projects for this client yet". Short labels take no trailing period ("No results").
- Every entity list's empty state offers its "New …" action.

### Skeletons

| Component | For |
|---|---|
| `TableSkeleton columns density` | Tables. Pass the table's `density` (compact tables) so nothing jumps. |
| `ListSkeleton rows size` | Grouped lists (Tasks), Notifications, timelines; `size="sm"` in widgets, blocks and side panels |
| `CardGridSkeleton cards` | Card grids (Projects) |
| `DetailSkeleton blocks` | A record's page or peek panel (client, project, invoice / quote preview, profile, finances) |

`Spinner` stays for work in progress that isn't a load (analysing a receipt, a busy button: `Button loading`). A button never swaps its label for "Loading...".

### Error boundaries

- **Per page:** `MainLayout` wraps the route `<Outlet />` in an `ErrorBoundary` keyed on the path. A crash keeps the sidebar and tabs, and navigating away resets it.
- **Per dashboard widget:** each widget has its own boundary with `WidgetErrorFallback`; one broken widget doesn't take the dashboard down.
- The fallbacks (`ErrorFallback`, `WidgetErrorFallback`) are a danger `EmptyState` with **Retry** (resets the boundary). The error goes to the log (`logError`), never on screen.

---

## Toasts

Every toast goes through `notify` (`src/lib/notify.ts`). It works from React and from plain modules. Nothing else imports `sonner`: ESLint `no-restricted-imports` blocks it everywhere except `src/lib/notify.ts` and `src/components/ui/Toaster.tsx`.

```ts
import { notify } from "../lib/notify";

notify.success(t.invoice_updated);                         // 4 s
notify.info(t.recurring_none_due);                         // 4 s
notify.warning(t.restore_warnings, { description: list }); // 8 s
notify.error(t.failed_open_folder, err);                   // 10 s, "Copy details"
notify.undo(t.toast_expense_deleted, () => restore());     // 8 s, Undo
await notify.progress(t.generating_pdf, work(), {          // spinner, then the outcome in place
  success: t.pdf_downloaded,                               // or null (just close), or { warning }
  error: t.failed_to_generate_pdf,
});
```

| Kind | Stays | Dot | For |
|--|--|--|--|
| `success` | 4 s (`TOAST_DURATION.success`) | green | Something the user did worked |
| `info` | 4 s | accent | Neutral news ("No recurring invoices due") |
| `warning` | 8 s | amber | It worked, but something needs a look ("2 receipts couldn't be copied") |
| `error` | 10 s | red | It failed |
| `undo` | 8 s | — | A reversible change, with Undo (see [Confirmations](#confirmations)) |
| `progress` | while it runs | spinner | A task of more than a moment (a PDF, an export) |

- **Errors show the label, never the raw error.** `notify.error(label, err)` shows the translated label, writes the raw error to the log and puts a "Copy details" action on the toast that copies it. The same label shows at most once in 30 s (it is still logged each time). Never pass `String(e)` or `e.message` as the message.
- **A failed save is reported once, by the query client.** Each mutation in `src/db/hooks` names its label with `meta: { errorLabel: "error_save_invoice" }` (a `ui.ts` key, checked by TypeScript); the `MutationCache` in `src/lib/queryClient.ts` calls `notify.error` with it (`operation_failed` when there is none). Hooks and call sites don't add an `onError` toast for the same failure: a `try/catch` around `mutateAsync` only stops the flow (`// reported by the mutation`). A hook-level `onError` opts out of the backstop.
- **`notify.progress`** replaces hand-made loading toasts (`toast.loading` + ids). `work` can take `update(label)` to change the running text ("Exporting 3 of 10…"). It resolves to the result, or `undefined` when it failed (already reported).
- **Undo:** the undo store helpers (`deleteWithUndo`, `undoableFromStore`, `pushUndoable`, `undoable` in `src/lib/undo.ts`) all show `notify.undo`. Clicking Undo runs the rollback and then says "Action undone"; Cmd+Z says "Undone: {label}".
- **Validation is not a toast.** A missing name or a bad folder shows under its field with `FormField error` or `FieldError` (see [Forms](#forms)).

### Words

- **Success:** the thing, then a past verb: "Invoice saved", "Client deleted", "PDF downloaded", "CSV exported". No "successfully", no full stop.
- **Error:** "Couldn't {verb} the {thing}": "Couldn't save the invoice", "Couldn't open the folder". A reason may follow a dash: "Couldn't delete the category — expenses use it".
- **Never a button label as a message** (`t.save`, `t.download_pdf`): add a key for what happened.
- **No glued strings:** a template with placeholders (`"Undone: {label}"`, `"Switched to {name}"`), counts with `plural()` from `src/i18n/plural.ts`; extra lines go in `description`.
- French with its accents: "Projet supprimé", "Reçu attaché".

### When not to toast

- Routine background work: an automatic backup that worked (the notification centre records it), saving the dashboard layout, starting or stopping a timer (the timer bar is the feedback). Their failures still show.
- Copying to the clipboard next to its button: show "Copied" in place when the component already has that state (AgentAccessCard); otherwise `notify.success(t.copied)` and `notify.error(t.error_copy, err)` when it fails.
- Anything already visible on screen as the result.

### Toaster

`<Toaster/>` (`src/components/ui/Toaster.tsx`), mounted once in `App`, bottom right: a `SURFACE` card (surface fill, header border, `rounded-xl`) with `shadow-menu`, 14px text, a `dot` in the kind's colour (a `Spinner` while loading), the description muted, the action (Undo, Copy details) as an accent link. It follows the app's light/dark setting.

---

## Confirmations

The app asks with its own dialog, never the system one: no `ask()` from `@tauri-apps/plugin-dialog` (its `open` and `save` file pickers stay).

```tsx
import { useConfirm, confirmDelete } from "../lib/confirm";

const confirm = useConfirm();
const ok = await confirm({
  title: t.restore_backup_title.replace("{name}", file), // the question, with its object
  message: t.restore_confirm,                            // what happens
  confirmLabel: t.restore,                               // the verb on the button
  tone: "danger",                                        // red verb button
});

await confirmDelete(client.name, t.delete_client_cascade);                 // "Delete Atelier?" + what goes with it
await confirm({ …, requireText: org.name });                              // verb disabled until the name is typed
const choice = await confirm({ …, extra: { label: t.export_as_draft, value: "draft" } }); // true | false | "draft"
```

- **`ConfirmDialog`** (`src/components/ui/ConfirmDialog.tsx`): a `Modal` of size `sm` with the title, the message, then Cancel · the extra choice · the verb. Cancel has the focus (with `requireText`, the field does), so a stray Enter never runs the action; Esc and the backdrop cancel.
- **`confirm()` / `useConfirm()`** (`src/lib/confirm.ts`) return a promise: true for the verb, false for Cancel, or the extra choice's `value`. They work from non-React code too (the unsaved-changes guard, the bulk PDF export, switching organisation): a small store (`src/stores/confirm-store.ts`, like the undo store) holds the questions and the one `<ConfirmHost/>` in `App` shows them, one at a time. A test that triggers a question renders `<ConfirmHost/>` and clicks the button, or mocks `confirm` from `lib/confirm` in a lib test.
- **Words:** a translated title that asks with its object ("Delete {name}?", "Exit test mode?"), a message that says what happens, the verb on the button ("Delete", "Restore", "Leave"), never OK / Yes. No sentence glued from pieces (`t.delete + "?"`) and no English fallback (`t.x ?? "…"`).
- **The draft warning** before exporting a draft invoice or quote is one dialog everywhere (preview pages, download and email from the lists): `confirmDraftExport()` / `settleDraftBeforeExport()` in `src/lib/confirmDraftExport.ts`, Cancel · Export as draft · Mark as sent & export.

### Which deletes ask

| Delete | Asks first | Then |
|--|--|--|
| A single record that takes nothing with it (expense, income, invoice from the list, quote, task, subtask, resource, wiki article, list, time entry, template, table, row, column, filter, preset, notification…) | No | The toast with Undo |
| A cascading delete: a client (its projects, tasks, documents), a project (its tasks) | Yes, with what goes with it | The toast with Undo |
| Every bulk delete | Yes: "Delete 3 expenses?" | One toast, one Undo for all |
| No undo possible: a whole organisation, restoring a backup or snapshot, demo data, resetting the guide, leaving test or presentation mode | Yes (an organisation: type its name) | — |

- **Where it asks:** in place with `ConfirmButton` for a single delete behind its own visible button (a client or project page, the invoice form: "Delete {reference}?"); a `ConfirmDialog` for bulk deletes, a context-menu delete, a whole organisation or the database.
- **Undo:** a delete mutation pushes its own undo entry (`src/db/hooks`); the page then shows the toast with `deleteWithUndo(mutation, id, t.x_deleted)` (or `undoableFromStore` after a `mutateAsync`). A delete with no hook of its own pushes one with `pushUndoable`. Rows with no restore query are copied before the delete and put back as they were, same ids, with `snapshotRows` / `pushRestore` (`src/db/undoRestore.ts`). The toast is `notify.undo` and stays 8 seconds (`TOAST_DURATION.undo`, see [Toasts](#toasts)).
- **Bulk:** `useBulkDelete(entity, id => mutation.mutateAsync(id), { message })` (`src/hooks/useBulkDelete.ts`): one question with the count, the deletes in turn (a failed one is reported by its mutation, the rest go on), then one toast; `batchUndo` folds their undo entries into one, so Undo or Cmd+Z brings the whole selection back.
- **Test and presentation mode:** leave through `useExitMode()` (`src/hooks/useExitMode.ts`), from the banner and from Settings.

---

## Navigation

Rows in a navigation list use `src/components/ui/NavItem.tsx`: the app sidebar, settings and profile categories, the wiki explorer and custom lists.

```tsx
<NavItem active={cat === key} icon={ICONS.appearance} onClick={() => setCat(key)}>{t.appearance}</NavItem>

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
- **Keyboard:** it is a radio group with one tab stop (the selected segment; the first enabled one when the value matches none). Arrow keys and Home/End move and select, skipping disabled options.
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
  - The label is a real `<label>` for the control: like `FormField`, a single control child (Select, Input, Toggle, a native field) gets an id (its own, or a generated one) and the label points at it, so the control is named and clicking the label focuses or toggles it.
  - When the child is a wrapper (a div with a select and a hint), pass `htmlFor` with the control's id, or give the control its own `aria-label`. A Button child is never labelled by the row (it keeps its own text).
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
| `role` | `"dialog"` with `padding="content"`, else none | A menu panel takes its role from the menu inside; pass `role` for other panels (a menu of `MenuItem`s: `dialog`; an autocomplete under an input: `group`) |
| `aria-label` / `aria-labelledby` | | Required on a dialog popover (a dev warning says so): `t.pick_date`, `t.edit_column`… |

**What it handles for you:**
- It renders on `<body>`, at `z-[60]`, with the `POPOVER_SURFACE` look: surface, `--color-border`, `rounded-xl`, `shadow-menu`. Tables and modals never clip it.
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

<Dropdown align="end" trigger={<IconButton icon={ICONS.more} label={t.more} />}
  items={[
    { label: t.edit, icon: ICONS.edit, onSelect: edit },
    { divider: true },
    { label: t.delete, icon: ICONS.delete, danger: true, onSelect: remove },
  ]} />
```

**Names.** Every `Select` / `DropdownSelect` needs a name: inside `FormField` or `SettingRow` it gets one from the label; elsewhere (a toolbar, a table cell) pass `aria-label` (`t.status`, or `${t.status}: ${row.reference}` in a row). In development a select with no `aria-label`, `aria-labelledby` or `id` logs a warning. The open list and a `Dropdown`'s menu are labelled by their trigger (`aria-labelledby`); `Dropdown` and `ContextMenu` take an `aria-label` for a name of their own (ContextMenu defaults to `t.actions`).

Item icons are components, drawn at 14px. A popover that holds more than commands (a preset list with delete buttons and a name field, a column header menu) builds its rows from `MenuItem` (`ui/MenuItem.tsx`: the same `MENU_ITEM` row, with `icon`, `selected` and `danger`), never raw `MENU_ITEM` buttons.

**Trigger.** One size, thin everywhere, forms included: `bg-[var(--color-input-bg)]`, no border, `px-2.5 py-1 text-xs rounded-md`, chevron 12 (the same 26px as `Button` secondary). Options:
- `prefix="Status:"`: a muted label inside the trigger, for toolbars and page headers.
- `variant="bare"`: no fill, no padding, no colour of its own. For table cells and status pills.
- `fullWidth`: defaults to `true`. Pass `false` inline.

**Panel.** `bg-[var(--color-surface)] border-[var(--color-border)] rounded-xl shadow-menu p-1`, min 160px, max 320px wide, 288px tall then scrolls. It renders on `<body>`, 4px under the trigger, so tables, cards and modals never clip it. It flips up when there's no room below.

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
- Header: `ui/PeekHeader` — a bar with only two `IconButton`s, close (X) on the left and open the full page (Maximize2) on the right, a header-border rule under it. No title or label in the bar, no footer.
  ```tsx
  <PeekHeader onClose={closePeek} onOpenFull={() => navigate(`/projects/${id}`)} />
  ```
- Title: in the content, below the bar — the peeked page's `PageHeader as="h2"` (the host page owns the `h1`). `ProjectDetailContent compact` does this.
- Content uses the same block card pattern as the full page, one heading level down: project blocks are `h3` in a peek (`ProjectBlockLayout headingAs="h3"`), `h2` on the full page.

---

## Transitions

All animations respect `prefers-reduced-motion` and the app's own **Reduce motion** setting (the `reduce-motion` class on `<html>`). Under either, `index.css` cuts motion globally: animations end at once, transitions are instant and scrolling jumps; only spinners (`.animate-spin`) keep turning. Motion started from script follows the same rule through `src/lib/motion.ts` (`prefersReducedMotion()`, `scrollBehavior()` for `scrollIntoView`). Use existing CSS classes:

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
| `src/components/shared/` | Shared feature components used by several features (LineItemsTable, SavedFilterBar, OptionsEditor) |
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
- [ ] Icons come from `ICONS` (or lucide-react for a non-concept icon), passed as components so the component sizes them; any other size is an `ICON_SIZE` constant
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
