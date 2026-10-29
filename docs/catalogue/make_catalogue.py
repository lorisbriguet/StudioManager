"""StudioManager component catalogue: every ui/ building block with a live preview, props, path and deep dive."""
import pathlib, html as H

TMP = pathlib.Path(__file__).resolve().parent / "out"
TMP.mkdir(exist_ok=True)
DD = {
    "dropdown": "ByQ9fZTPqMmURLyBVYN5o2", "button": "1wWC1A5CxpM4qxsXjd6wbw", "iconbutton": "BMjCuNLsU3XthiC8Vjmewo",
    "pills": "WcEWyoB8NSz8JSJTRS5Si3", "tables": "2ouWVX3Px4aJAjD1TmA35F", "forms": "Tc2Xgh2qUzpMoz2qugi3xu",
    "inputs": "7oFApoaS3Kk8s4SueZFBum", "modals": "Bgj1W8pdxUJVNog8TYCspt", "headings": "PW8i7ppaeocJjTmXYfugPE",
    "cards": "6UPEn5uEzA2j7bwRTXrv7g", "toasts": "Syq8ZG6ZUxqK9YEVQgxhfL", "confirms": "9osPvUjkXqF1FvYqFVYtqQ",
    "states": "RU53Wmo2RU1titRqLpJCkk",
    "colours": "K5b9minhUmGVf2Ng11F9KS", "icons": "HodmptMk3P6XyoH1A2wLWh",
}
DD_NAMES = {"dropdown": "Dropdown", "button": "Button", "iconbutton": "IconButton", "pills": "Pills", "tables": "Tables",
            "forms": "Forms", "inputs": "Input · Textarea", "modals": "Modals", "headings": "Headings", "cards": "Cards",
            "toasts": "Toasts", "confirms": "Confirmations", "states": "Empty, loading and error states", "colours": "Colours", "icons": "Icons"}

def ic(d, s=14):
    return f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{d}</svg>'
I = {
    "plus": '<path d="M12 5v14M5 12h14"/>', "x": '<path d="M18 6 6 18M6 6l12 12"/>', "more": '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    "trash": '<path d="M3 6h18M19 6v14H5V6M8 6V4h8v2"/>', "pencil": '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    "chev": '<path d="m6 9 6 6 6-6"/>', "cal": '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', "back": '<path d="m12 19-7-7 7-7M19 12H5"/>',
    "check": '<path d="M20 6 9 17l-5-5"/>', "file": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
    "grip": '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    "home": '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/>', "up": '<path d="m6 15 6-6 6 6"/>',
}
btn = lambda t, v="primary", icon="": f'<span class="btn {v}">{ic(I[icon],12) if icon else ""}{t}</span>'
ib = lambda n, size="sm", extra="": f'<span class="ib {size} {extra}" title="">{ic(I[n], 14 if size=="sm" else 12)}</span>'
fld = lambda v, cls="", lead="", trail="", style="": f'<span class="fld {cls}" style="{style}">{lead}<span class="fv">{v}</span>{trail}</span>'
lab = lambda t: f'<span class="flab">{t}</span>'
pill = lambda t, tone="neutral", xs=False: f'<span class="pill {tone} {"xs" if xs else ""}">{t}</span>'
tag = lambda t, c: f'<span class="pill tag-{c}">{t}</span>'

# Each entry: (category, name, path, props, preview html, deep-dive key or None, keywords)
E = []
def add(cat, name, path, props, prev, dd=None, kw=""):
    E.append(dict(cat=cat, name=name, path=path, props=props, prev=prev, dd=dd, kw=kw))

# Controls
add("Controls", "Button", "ui/Button.tsx", "variant primary · secondary · outline · danger · link; icon; loading; type defaults to \"button\". One size, 26px.",
    f'<div class="row">{btn("New invoice","primary","plus")}{btn("Cancel","secondary")}{btn("Export","outline")}{btn("Delete","danger")}<span class="btn link">View all</span></div>', "button", "cta action submit")
add("Controls", "IconButton", "ui/IconButton.tsx", "icon, label (tooltip + aria-label, required); size sm 26px · xs 20px; tone; color; reveal on row hover; active.",
    f'<div class="row">{ib("more")}{ib("pencil")}{ib("trash","sm","danger")}<span class="sep"></span>{ib("x","xs")}{ib("plus","xs")}</div>', "iconbutton", "icon only")
add("Controls", "Input", "ui/Input.tsx", "variant default · bare · inline; numeric; unit; icon + onClear; width xs 64 · sm 96 · md 144; readOnly; detected.",
    f'<div class="col">{fld("Fondation Artvis")}<div class="row">{fld("980.50","num w-md","",'<span class="unit">CHF</span>')}{fld("10","num w-xs","",'<span class="unit">%</span>')}</div>{fld("Linked to “Statuses”","ro")}</div>', "inputs", "text field number unit")
add("Controls", "Textarea", "ui/Input.tsx", "3 rows, grows with its content to maxRows (12), then scrolls; fill for a widget that owns its height.",
    '<span class="fld ta">Paid by bank transfer.<br>Reminder sent on 12.10.</span>', "inputs", "notes multiline")
add("Controls", "SearchBar", "ui/SearchBar.tsx", "Input with the search icon and a clear button; value, onChange, placeholder.",
    fld("art basel", "full", f'<span class="lead">{ic(I["search"],12)}</span>', f'<span class="trail">{ic(I["x"],12)}</span>'), "inputs", "filter find")
add("Controls", "DatePicker", "ui/DatePicker.tsx", "Type a date (dd.mm.yyyy) or open the calendar; value yyyy-MM-dd | null; variant; detected. Calendar, DateShortcuts.",
    fld("28.10.2026", "num-l w-md", "", f'<span class="trail">{ic(I["cal"],12)}</span>'), None, "date calendar")
add("Controls", "Select · DropdownSelect", "ui/Select.tsx · ui/Dropdown.tsx", "Native-free select: options, value, onChange, searchable, groups; variant bare for status pills.",
    f'<div class="col"><span class="fld trig"><span class="fv">Sent</span>{ic(I["chev"],12)}</span><div class="menu"><span class="mi">Draft</span><span class="mi on">Sent {ic(I["check"],12)}</span><span class="mi">Paid</span></div></div>', "dropdown", "select menu option")
add("Controls", "Dropdown · ContextMenu", "ui/Dropdown.tsx · ui/ContextMenu.tsx", "Action menus: items, icons, dividers, group labels, danger tone; opens on <body>, never clipped.",
    f'<div class="menu"><span class="mi">{ic(I["pencil"],12)} Edit</span><span class="mi">{ic(I["file"],12)} Download PDF</span><span class="mdiv"></span><span class="mi dang">{ic(I["trash"],12)} Delete</span></div>', "dropdown", "menu right click")
add("Controls", "Checkbox · Radio", "ui/Checkbox.tsx", "Real inputs, restyled; label, description; indeterminate for select-all.",
    '<div class="col"><span class="cb on"><i></i>Use one rate for all lines</span><span class="cb mixed"><i></i>Select all</span><span class="cb"><i></i>Include drafts</span></div>', None, "check select")
add("Controls", "Toggle", "ui/Toggle.tsx", "On/off switch with role=switch; size sm · md; label, description.",
    '<div class="col"><span class="tg on"><i></i>Round time entries</span><span class="tg"><i></i>Auto-backup</span></div>', None, "switch")
add("Controls", "SegmentedControl", "ui/SegmentedControl.tsx", "2–4 way choice, one tab stop, arrow keys; size sm · md; fullWidth.",
    '<span class="seg"><span class="on">Month</span><span>Week</span><span>Day</span></span>', None, "tabs switch view")
add("Controls", "FilterChip", "ui/FilterChip.tsx", "Toggle pill with aria-pressed; count; tag colour when filtering by tag. 26px like other controls.",
    '<div class="row"><span class="chip on">Active <b>3</b></span><span class="chip">On hold</span><span class="chip">Done</span></div>', "pills", "filter pill")

# Labels
add("Labels", "Tag", "ui/Tag.tsx", "Coloured by name (or stored colour); size sm 20px · xs 16px; onRemove; clickable.",
    f'<div class="row">{tag("branding","p")}{tag("web","b")}{tag("print","g")}<span class="pill tag-o">editorial <span class="px">{ic(I["x"],10)}</span></span></div>', "pills", "label chip")
add("Labels", "Badge · CountBadge", "ui/Badge.tsx", "Status by meaning: success, warning, danger, neutral, accent; xs 16px. CountBadge caps at 99+.",
    f'<div class="row">{pill("Paid","success")}{pill("Sent","warning")}{pill("Overdue","danger")}{pill("Draft")}<span class="cnt">4</span><span class="cnt neutral">12</span></div>', "pills", "status pill count")
add("Labels", "SectionLabel", "ui/SectionLabel.tsx", "10px uppercase group label; as; count; action on the right. SECTION_LABEL for elements that can't be a component.",
    '<div class="col"><span class="lbl">Projects <span class="lcnt">4</span></span><span class="lbl">Billing addresses</span></div>', "headings", "eyebrow group")
add("Labels", "Kbd · Tooltip", "ui/Kbd.tsx · ui/Tooltip.tsx", "Key hints; styled tooltips replacing native title on interactive elements.",
    '<div class="row"><span class="kbd">⌘</span><span class="kbd">K</span><span class="tip">Delete invoice</span></div>', None, "shortcut hint")

# Type & headings
add("Headings", "PageHeader", "ui/PageHeader.tsx", "Level-1 title; back (with unsaved-changes check); meta line; leading (calendar arrows); actions; compact bar for previews.",
    f'<div class="ph"><div class="row nowrap">{ib("back")}<span class="h1">Key visual 2027</span><span class="grow"></span>{btn("Delete","danger")}</div><span class="phm">Art Basel · due 12.12.2026</span></div>', "headings", "title header back")
add("Headings", "PanelTitle · PeekHeader · SidebarTitle", "ui/PanelTitle.tsx · ui/PeekHeader.tsx · ui/SidebarTitle.tsx", "Level-2 title (14px semibold) with count and action; peek panel bar (close left, open full page right); sidebar level-1 title.",
    f'<div class="col"><div class="row nowrap"><span class="h2">Revenue by client</span><span class="lcnt">12</span><span class="grow"></span><span class="btn link">View all</span></div><div class="peek">{ib("x","xs")}<span class="grow"></span><span class="btn link">Open full page</span></div></div>', "headings", "title heading")
add("Headings", "Type scale", "ui/tokens.ts", "HEADING_1 20px semibold tight · HEADING_2 14px semibold · label 10px uppercase · body 14px · small 12px · STAT_VALUE 20px.",
    '<div class="col"><span class="h1">Invoices</span><span class="h2">Recurring invoices</span><span class="lbl">Year 2026</span><span class="body">Body text, 14px.</span><span class="small">Small text, 12px muted.</span></div>', "headings", "font size typography")

# Surfaces
add("Surfaces", "Card · Card.Header", "ui/Card.tsx", "padding md 16 · sm 12 · none; tone surface · inset · dashed; interactive, selected; Card.Header title, count, subtitle, icon, action, onClose, variant label, divider.",
    f'<div class="card"><div class="row nowrap"><span class="h2">Contacts</span><span class="lcnt">2</span><span class="grow"></span><span class="btn link">Add</span></div><div class="card inset"><b>Marc Spiegler</b><span class="small">Director</span></div><div class="card dashed small">+ Add contact</div></div>', "cards", "panel surface box")
add("Surfaces", "StatTile", "ui/StatTile.tsx", "Label + 20px value + optional caption; tone. Dashboard KPIs.",
    '<div class="card"><span class="lbl">Revenue this month</span><span class="stat">CHF 18 130</span><span class="small">+12% vs September</span></div>', "cards", "kpi metric number")
add("Surfaces", "Modal · FormModal", "ui/Modal.tsx · ui/Form.tsx", "sm 400 · md 560 · full; 85% height, body scrolls; title or aria-label. FormModal: a form body (Enter submits), Cancel · primary, destructive slot.",
    f'<div class="dlg"><div class="dh"><span class="h2">New client</span>{ic(I["x"],12)}</div><div class="db"><div class="g2">{lab("Name *")}{lab("Email")}{fld("Fondation Artvis")}{fld("hello@artvis.ch")}</div></div><div class="df">{btn("Cancel","secondary")}{btn("Create client")}</div></div>', "modals", "dialog popup")
add("Surfaces", "ConfirmDialog · useConfirm · ConfirmButton", "ui/ConfirmDialog.tsx · lib/confirm.ts · ui/Feedback.tsx", "The app's question dialog: title, message, the verb on the button, danger tone, requireText, extra choice; Cancel focused. ConfirmButton asks in place.",
    f'<div class="dlg sm"><div class="db"><span class="h2">Delete 3 expenses?</span><span class="small">You can undo this for 8 seconds.</span></div><div class="df">{btn("Cancel","secondary")}{btn("Delete","danger")}</div></div>', "confirms", "confirm ask delete")
add("Surfaces", "Popover", "ui/Popover.tsx", "Floating panel on <body> with the popover surface; nested popovers stay open; clicks inside don't reach the anchor.",
    f'<div class="col"><span class="btn secondary">{ic(I["cal"],12)} Fri 31 Oct</span><div class="menu pad"><span class="small">Today · Tomorrow · Next week</span></div></div>', "dropdown", "floating panel")
add("Surfaces", "Toaster · notify", "ui/Toaster.tsx · lib/notify.ts", "notify.success / info 4s · warning 8s · error(label, err) 10s with Copy details · undo 8s · progress. Never raw errors.",
    f'<div class="col"><span class="toast"><i class="dot ok"></i>Invoice saved</span><span class="toast"><i class="dot ok"></i>Project deleted<span class="tact">Undo</span></span><span class="toast"><i class="dot err"></i>Couldn\'t save the client<span class="tact">Copy details</span></span></div>', "toasts", "notification snackbar")
add("Surfaces", "Callout · ProgressBar", "ui/Feedback.tsx", "Callout tone info · warning · danger · success with an action slot; ProgressBar tones; DragHandle.",
    '<div class="col"><span class="callout warn">This invoice is a draft.<span class="tact">Mark sent</span></span><span class="bar"><i style="width:64%"></i></span></div>', "states", "alert banner notice")

# Forms
add("Forms", "FormLayout · FormSection · FormGrid", "ui/Form.tsx", "FormLayout 24px stack, 768px cap (dense: 12px); FormSection = label + fields; FormGrid 1–4 columns, 12px gaps; FormGridItem spans.",
    f'<div class="col"><span class="lbl">Client</span><div class="g2">{lab("Client *")}{lab("Project")}{fld("Art Basel","", "", f"<span class=trail>{ic(I["chev"],12)}</span>")}{fld("Key visual 2027")}</div></div>', "forms", "layout grid section")
add("Forms", "FormField · FieldError · FormGroup", "ui/FormField.tsx · ui/Form.tsx", "Label linked to the field, required *, hint, error (replaces the hint), span. FieldError alone; FormGroup labels several controls.",
    f'<div class="col">{lab("PO number")}{fld("PO-","err")}<span class="ferr">Use the client\'s PO format (PO-0000).</span>{lab("Billing address")}{fld("Messeplatz 10, 4058 Basel")}<span class="small">Taken from the client.</span></div>', "forms", "label validation hint")
add("Forms", "FormActions", "ui/Form.tsx", "Right-aligned, primary last; destructive on the far left. Same row as the Modal footer.",
    f'<div class="row nowrap">{btn("Delete","danger")}<span class="grow"></span>{btn("Cancel","secondary")}{btn("Create invoice")}</div>', "forms", "buttons footer")
add("Forms", "Settings · SettingRow", "ui/Settings.tsx", "SettingsCard (inset Card + label header with divider), SettingRow label left, control right, htmlFor.",
    '<div class="card inset"><span class="lbl ruled">Backup</span><div class="srow"><span>Keep last<br><span class="small">Older backups are removed</span></span><span class="fld num w-xs"><span class="fv">10</span></span></div><div class="srow"><span>Auto-backup</span><span class="tg on"><i></i></span></div></div>', None, "preferences")

# Data
add("Data", "Table", "ui/Table.tsx", "density default 40px · compact 32px; Head, Th numeric, Row onOpen, Td numeric/muted/narrow, SelectAll/Select, Actions (on hover), Group, Empty, Foot.",
    f'<table class="tbl"><thead><tr><th class="cbx"><span class="cb mixed"><i></i></span></th><th>Reference</th><th class="n">Amount</th><th></th></tr></thead><tbody><tr class="grp"><td colspan="4"><span class="lbl">2026</span> <span class="small">3 invoices</span></td></tr><tr><td class="cbx"><span class="cb"><i></i></span></td><td>INV-2026-014</td><td class="n">4 800.00</td><td class="act">{ib("more","xs")}</td></tr><tr class="hov"><td class="cbx"><span class="cb on"><i></i></span></td><td>INV-2026-013</td><td class="n">12 350.00</td><td class="act">{ib("more","xs")}</td></tr></tbody></table>', "tables", "list grid rows")
add("Data", "SortHeader · BulkActionBar", "ui/SortHeader.tsx · ui/BulkActionBar.tsx", "Sortable column header (button + aria-sort, density-aware); floating bar for a selection.",
    f'<div class="col"><span class="small"><b>Date</b> {ic(I["up"],10)} · Client · Amount</span><span class="bulk"><b>3 selected</b>{btn("Mark paid","secondary")}{btn("Delete","danger")}{ib("x","xs")}</span></div>', "tables", "sort selection")
add("Data", "QueryState", "ui/QueryState.tsx", "One wrapper per data surface: skeleton → error with Retry → empty → no results with Clear filters → content. QueryError, NoResults.",
    f'<div class="col"><span class="callout dang">Couldn\'t load the quotes<span class="tact">Retry</span></span><div class="empty"><span class="small">No quotes match</span>{btn("Clear filters","secondary")}</div></div>', "states", "loading error retry")
add("Data", "EmptyState", "ui/EmptyState.tsx", "size lg (pages: 32px icon, message, hint, action) · sm (widgets, blocks, popovers); tone danger.",
    f'<div class="empty"><span class="eic">{ic(I["file"],28)}</span><span>No quotes yet</span><span class="small">Create one from a client or a project.</span>{btn("New quote","primary","plus")}</div>', "states", "nothing blank")
add("Data", "Skeletons", "ui/Skeleton.tsx · ui/TableSkeleton.tsx · ui/Spinner.tsx", "Skeleton, TableSkeleton (density), ListSkeleton, CardGridSkeleton, DetailSkeleton. Match the shape that's loading. Spinner, PageSpinner.",
    '<div class="col"><i class="sk" style="width:40%"></i><i class="sk"></i><i class="sk" style="width:80%"></i><i class="sk" style="width:65%"></i></div>', "states", "loading placeholder")

# Navigation
add("Navigation", "NavItem · TabItem", "ui/NavItem.tsx · ui/TabItem.tsx", "Navigation rows sm · md with aria-current; navItemClass for router links; tabs with close button.",
    f'<div class="col"><span class="nav on">{ic(I["home"],14)} Dashboard</span><span class="nav">{ic(I["file"],14)} Invoices</span><span class="row nowrap"><span class="tab on">INV-2026-014 {ic(I["x"],10)}</span><span class="tab">Art Basel {ic(I["x"],10)}</span></span></div>', None, "sidebar menu tab")

# Patterns
add("Patterns", "InlineRename", "ui/InlineRename.tsx", "Rename in place: Enter or blur saves, Esc cancels, validate + error, keeps the row's text size.",
    '<div class="col"><span class="iren">Brand guidelines</span><span class="small">Enter saves · Esc cancels</span></div>', "inputs", "edit name")
add("Patterns", "AddRow", "ui/AddRow.tsx", "Field + “+”; Enter adds (never submits the form), clears after adding; extra controls before the button.",
    f'<div class="row nowrap">{fld("New task…","ph full")}{ib("plus")}</div>', "inputs", "create quick add")
add("Patterns", "TagInput · OptionsEditor", "shared/TagInput.tsx · shared/OptionsEditor.tsx", "Tag entry with suggestions (Enter or comma); options list with colours, add row, import / save as list.",
    f'<div class="col"><span class="fld full">{tag("brand","p")} {tag("2027","b")}<span class="fv ph">add tag…</span></span><div class="row nowrap">{tag("To do","o")}{tag("In progress","b")}{tag("Done","g")}</div></div>', "inputs", "tags options list")
add("Patterns", "Bulk delete · Undo", "hooks/useBulkDelete.ts · hooks/useExitMode.ts · lib/undo.ts", "useBulkDelete: one question, one toast, one Undo for a selection. deleteWithUndo, pushUndoable, batchUndo; useExitMode.",
    f'<span class="toast"><i class="dot ok"></i>3 expenses deleted<span class="tact">Undo</span></span>', "confirms", "undo delete selection")

add("Navigation", "BottomBar · PanelTopBar", "ui/Bars.tsx", "Bars pinned to a column: BottomBar 44px with a top border (footers, status bars), PanelTopBar 40px with a bottom border (tab rows, panel toolbars). BOTTOM_BAR, PANEL_TOP_BAR so side-by-side columns line up.",
    '<div class="col" style="max-width:290px;gap:0;border:1px solid var(--color-border-header);border-radius:8px;overflow:hidden;background:var(--color-surface)"><div class="row nowrap" style="height:30px;padding:0 10px;border-bottom:1px solid var(--color-border-header)"><span class="tab on">Brand guidelines</span><span class="tab">Colours</span></div><div style="height:46px"></div><div class="row nowrap small" style="height:32px;padding:0 10px;border-top:1px solid var(--color-border-header)">12 articles<span class="grow"></span>Saved</div></div>', None, "footer toolbar status bar")

add("Labels", "ICONS · ICON_SIZE", "ui/icons.ts", "One concept → icon map (invoice Receipt, expense CreditCard, quote FilePlus2, more Ellipsis, settings Settings2…). ICON_SIZE pill 10 · control 12 · menu 14 · callout 16 · nav 18 · empty 20/32; ICON_STROKE. Components size their own icons.",
    f'<div class="row">{"".join(f"<span class=ic2>{ic(I[k],14)}</span>" for k in ["file","pencil","trash","plus","search","cal","more"])}</div>', "icons", "icon lucide size")
add("Controls", "MenuItem", "ui/MenuItem.tsx", "One menu row: icon, label, selected, danger; built on MENU_ITEM. For menus that can't use Dropdown or ContextMenu.",
    f'<div class="menu"><span class="mi">{ic(I["pin"] if "pin" in I else I["check"],12)} Pin first column</span><span class="mi on">Sort A–Z {ic(I["check"],12)}</span><span class="mi dang">{ic(I["trash"],12)} Delete column</span></div>', "icons", "menu row")
add("Labels", "Colour tokens", "src/index.css · lib/themeTokens.ts", "Borders by role (divider · surface edge · control edge); accent-tint 5 / strong 10 / handle 25%; focus-ring; on-accent; scrim, overlay-hover, text-faint; shadow control/menu/modal; --color-tag-*; themes derive the full set.",
    '<div class="col"><div class="row"><span class="pill tag-b">blue</span><span class="pill tag-p">purple</span><span class="pill tag-g">green</span><span class="pill tag-o">orange</span></div><div class="row"><span class="fld w-md"><span class="fv">control edge</span></span><span class="card inset" style="width:auto;padding:4px 8px">surface edge</span></div></div>', "colours", "color token theme dark")

CATS = ["Controls", "Labels", "Headings", "Surfaces", "Forms", "Data", "Navigation", "Patterns"]

TOKENS = [
    ("CONTROL_BOX", "26px control box", "Button, Input, Select trigger, FilterChip, SegmentedControl"),
    ("MUTED_INTERACTIVE", "Muted text that darkens on hover", "NavItem, TabItem, SortHeader, FilterChip"),
    ("SURFACE · SURFACE_FILL · POPOVER_SURFACE", "Raised surfaces", "Modal, Popover, BulkActionBar, Toaster"),
    ("PILL · PILL_XS", "20px and 16px label pills", "Tag, Badge, CountBadge, status pills"),
    ("TABLE_X · TABLE_ROW_H · TABLE_TH · NUMERIC", "Table geometry per density, tabular numbers", "Table, SortHeader, TableSkeleton, Input numeric"),
    ("FORM_GAP · FORM_STACK · FORM_WIDTH · FORM_ACTIONS · FIELD_LABEL · FORM_SPAN", "Form spacing, 768px cap, action row, field label", "FormGrid, FormLayout, FormActions, Modal footer, FormField"),
    ("HEADING_1 · HEADING_2 · HEADING_COUNT · STAT_VALUE · SECTION_LABEL", "Type scale", "PageHeader, PanelTitle, Card.Header, StatTile, SectionLabel"),
    ("CARD_GAP · CARD_STACK", "16px between cards", "Dashboard, client detail, project blocks"),
    ("FIELD_WIDTH", "xs 64 · sm 96 · md 144", "Input width"),
    ("MENU_TONE · MENU_ITEM · MENU_GROUP_LABEL", "Menu rows", "Dropdown, ContextMenu, CommandPalette"),
    ("revealClass · useTagColor · cardClass · fieldClass", "Helpers", "IconButton reveal, Tag/FilterChip colours, Card and field class strings"),
]
COLORS = [("bg", "--color-bg"), ("surface", "--color-surface"), ("input-bg", "--color-input-bg"), ("hover-row", "--color-hover-row"),
          ("border-header", "--color-border-header"), ("input-border", "--color-input-border"), ("text", "--color-text"), ("muted", "--color-muted"),
          ("accent", "--color-accent"), ("success", "--color-success-text"), ("warning", "--color-warning-text"), ("danger", "--color-danger-text")]
RULES = [
    ("Sizes", "One 26px control height. IconButton 26 / 20px. Pills 20 / 16px. Table rows 40 / 32px. Modal 400 / 560 / full."),
    ("Type", "Two heading sizes (20px page, 14px card) and the 10px label. No 12, 16 or 18px titles."),
    ("Spacing", "12px inside forms, 24px between form blocks, 16px between cards, 16 / 12px card padding."),
    ("Actions", "Right-aligned, primary last, destructive far left. The verb on the button, never OK or Yes."),
    ("Deletes", "Undo for 8 seconds; only clients, projects and bulk deletes ask first."),
    ("Feedback", "Toasts through notify; never raw errors; no toast for routine background work; validation shows on the field."),
    ("Data surfaces", "QueryState: skeleton, error with Retry, empty, no results with Clear filters."),
    ("Build", "Reuse a component or token before writing classes; a pattern used twice becomes a building block."),
]

def card(e):
    dd = f'<a class="dd" href="https://claude.ai/artifact/{DD[e["dd"]]}" target="_blank" rel="noopener">{DD_NAMES[e["dd"]]} deep dive ↗</a>' if e["dd"] else ""
    search = H.escape(f'{e["name"]} {e["path"]} {e["props"]} {e["kw"]} {e["cat"]}'.lower())
    return (f'<article class="comp" data-cat="{e["cat"]}" data-search="{search}" id="c-{e["name"].split()[0].lower()}">'
            f'<div class="stage">{e["prev"]}</div>'
            f'<div class="meta"><h3>{H.escape(e["name"])}</h3><code class="path">{H.escape(e["path"])}</code>'
            f'<p>{H.escape(e["props"])}</p>{dd}</div></article>')

sections = ""
for c in CATS:
    items = [e for e in E if e["cat"] == c]
    sections += f'<section class="cat" data-cat="{c}" id="{c.lower()}"><div class="cat-head"><h2>{c}</h2><span class="n">{len(items)}</span></div><div class="grid">{"".join(card(e) for e in items)}</div></section>\n'

chips = '<button type="button" class="fchip on" data-f="all" aria-pressed="true">All</button>' + "".join(
    f'<button type="button" class="fchip" data-f="{c}" aria-pressed="false">{c}</button>' for c in CATS)
toc = "".join(f'<a href="#{c.lower()}">{c}</a>' for c in CATS) + '<a href="#tokens">Tokens</a><a href="#rules">Rules</a><a href="#deepdives">Deep dives</a>'
swatches = "".join(f'<div class="sw"><i style="background:var({v})"></i><span>{n}</span><code>{v}</code></div>' for n, v in COLORS)
tokrows = "".join(f'<tr><td><code>{H.escape(a)}</code></td><td>{H.escape(b)}</td><td class="muted">{H.escape(c)}</td></tr>' for a, b, c in TOKENS)
rules = "".join(f'<div class="rule"><b>{a}</b><span>{H.escape(b)}</span></div>' for a, b in RULES)
OPEN = set()
dds = "".join(f'<a class="ddc" href="https://claude.ai/artifact/{u}" target="_blank" rel="noopener"><b>{DD_NAMES[k]}</b><span class="{'open' if k in OPEN else ''}">{"to decide" if k in OPEN else "built"}</span></a>' for k, u in DD.items())

CSS = r"""
/* Layout: sticky filter bar over a category-grouped grid of component cards; each card = live preview stage + props. App tokens from src/index.css. */
:root {
  --color-bg: #ffffff; --color-surface: #ffffff; --color-sidebar: #f8f8f8;
  --color-text: #111827; --color-text-secondary: #374151; --color-muted: #5d6570;
  --color-border-divider: #f7f7f7; --color-border-header: #f0f0f0;
  --color-input-bg: #f5f5f5; --color-input-border: #e5e5e5; --color-hover-row: #f8f8f8;
  --color-accent: #2563eb; --color-accent-light: #dbeafe; --color-accent-tint: color-mix(in srgb, #2563eb 5%, transparent);
  --color-success-bg: #dcfce7; --color-success-text: #15803d;
  --color-warning-bg: #fef9c3; --color-warning-text: #a16207;
  --color-danger-bg: #fee2e2; --color-danger-text: #dc2626;
  --tag-p-bg: #ede9fe; --tag-p: #6d28d9; --tag-b-bg: #dbeafe; --tag-b: #1d4ed8; --tag-g-bg: #dcfce7; --tag-g: #15803d; --tag-o-bg: #ffedd5; --tag-o: #c2410c;
  --stage: #fafafa; --shadow: 0 8px 24px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.06);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --color-bg: #111111; --color-surface: #161616; --color-sidebar: #161616; --color-text: #e5e5e5; --color-text-secondary: #d4d4d4; --color-muted: #b0b0b0;
  --color-border-divider: #1f1f1f; --color-border-header: #2a2a2a; --color-input-bg: #1a1a1a; --color-input-border: #2a2a2a; --color-hover-row: #1a1a1a;
  --color-accent: #2563eb; --color-accent-light: #172554; --color-accent-tint: color-mix(in srgb, #2563eb 10%, transparent);
  --color-success-bg: #052e16; --color-success-text: #4ade80; --color-warning-bg: #1c1917; --color-warning-text: #fbbf24; --color-danger-bg: #2a1215; --color-danger-text: #f87171;
  --tag-p-bg: #1e1b2e; --tag-p: #a78bfa; --tag-b-bg: #1a2332; --tag-b: #60a5fa; --tag-g-bg: #052e16; --tag-g: #4ade80; --tag-o-bg: #2a1a0e; --tag-o: #fb923c;
  --stage: #0c0c0c; --shadow: 0 8px 24px rgba(0,0,0,.5); color-scheme: dark; } }
:root[data-theme="dark"] {
  --color-bg: #111111; --color-surface: #161616; --color-sidebar: #161616; --color-text: #e5e5e5; --color-text-secondary: #d4d4d4; --color-muted: #b0b0b0;
  --color-border-divider: #1f1f1f; --color-border-header: #2a2a2a; --color-input-bg: #1a1a1a; --color-input-border: #2a2a2a; --color-hover-row: #1a1a1a;
  --color-accent: #2563eb; --color-accent-light: #172554; --color-accent-tint: color-mix(in srgb, #2563eb 10%, transparent);
  --color-success-bg: #052e16; --color-success-text: #4ade80; --color-warning-bg: #1c1917; --color-warning-text: #fbbf24; --color-danger-bg: #2a1215; --color-danger-text: #f87171;
  --tag-p-bg: #1e1b2e; --tag-p: #a78bfa; --tag-b-bg: #1a2332; --tag-b: #60a5fa; --tag-g-bg: #052e16; --tag-g: #4ade80; --tag-o-bg: #2a1a0e; --tag-o: #fb923c;
  --stage: #0c0c0c; --shadow: 0 8px 24px rgba(0,0,0,.5); color-scheme: dark; }
* { box-sizing: border-box; }
body { background: var(--color-bg); color: var(--color-text); font: 14px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--color-bg); }
a { color: var(--color-accent); text-decoration: none; } a:hover { text-decoration: underline; }
:focus-visible { outline: none; box-shadow: 0 0 0 1px var(--color-surface), 0 0 0 3px color-mix(in srgb, var(--color-accent) 50%, transparent); border-radius: 6px; }
code { font-family: var(--mono); font-size: 11.5px; }
.wrap { max-width: 1180px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
header.top { padding-block: 36px 18px; display: flex; flex-direction: column; gap: 8px; }
.eyebrow { font-size: 10px; font-weight: 500; letter-spacing: .12em; text-transform: uppercase; color: var(--color-muted); }
h1 { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -.02em; text-wrap: balance; }
.lead-p { margin: 0; max-width: 68ch; color: var(--color-text-secondary); }
.facts { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12px; color: var(--color-muted); font-variant-numeric: tabular-nums; }
.facts b { color: var(--color-text); font-weight: 600; }
.bar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: color-mix(in srgb, var(--color-bg) 92%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--color-border-header); }
.bar .wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-block: 10px; }
.q { flex: 1 1 220px; min-width: 0; height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border-radius: 8px; background: var(--color-input-bg); border: 1px solid var(--color-input-border); color: var(--color-muted); }
.q input { flex: 1; min-width: 0; border: 0; background: transparent; font: inherit; font-size: 13px; color: var(--color-text); outline: none; }
.fchips { display: flex; flex-wrap: wrap; gap: 4px; }
.fchip { font: inherit; font-size: 12px; height: 26px; padding: 0 10px; border-radius: 99px; border: 1px solid var(--color-input-border); background: transparent; color: var(--color-muted); cursor: pointer; }
.fchip:hover { color: var(--color-text); }
.fchip.on { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
.seg-t { display: inline-flex; background: var(--color-input-bg); border-radius: 6px; padding: 2px; gap: 2px; }
.seg-t button { font: inherit; font-size: 12px; border: 0; background: transparent; color: var(--color-muted); padding: 2px 8px; border-radius: 4px; cursor: pointer; }
.seg-t button[aria-pressed="true"] { background: var(--color-surface); color: var(--color-text); box-shadow: 0 1px 2px rgba(0,0,0,.1); }
.layout { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 32px; padding-block: 24px 96px; }
.toc { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 64px); align-self: start; display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.toc a { color: var(--color-muted); padding: 4px 8px; border-radius: 6px; }
.toc a:hover { color: var(--color-text); background: var(--color-hover-row); text-decoration: none; }
main { display: flex; flex-direction: column; gap: 40px; min-width: 0; }
.cat-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
h2 { margin: 0; font-size: 15px; font-weight: 600; }
.cat-head .n { font-size: 12px; color: var(--color-muted); font-variant-numeric: tabular-nums; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.comp { border: 1px solid var(--color-border-header); border-radius: 12px; background: var(--color-surface); overflow: hidden; display: flex; flex-direction: column; min-width: 0; }
.comp:target { outline: 2px solid var(--color-accent); }
.stage { background: var(--stage); border-bottom: 1px solid var(--color-border-header); padding: 18px 16px; min-height: 132px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.stage > * { max-width: 100%; }
.meta { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.meta h3 { margin: 0; font-size: 13px; font-weight: 600; }
.meta .path { color: var(--color-muted); overflow-wrap: anywhere; }
.meta p { margin: 2px 0 0; font-size: 12px; color: var(--color-text-secondary); }
.meta .dd { font-size: 12px; margin-top: 4px; }
.hidden { display: none !important; }
.noresults { color: var(--color-muted); font-size: 13px; padding: 24px 0; }
/* Previews (drawn with the app's own measures) */
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; } .row.nowrap { flex-wrap: nowrap; width: 100%; }
.col { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; width: 100%; max-width: 280px; }
.grow { flex: 1; } .sep { width: 1px; height: 18px; background: var(--color-border-header); margin: 0 4px; }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; font-size: 12px; font-weight: 500; border-radius: 6px; border: 1px solid transparent; white-space: nowrap; }
.btn.primary { background: var(--color-accent); color: #fff; } .btn.secondary { background: var(--color-input-bg); color: var(--color-text-secondary); }
.btn.outline { border-color: var(--color-input-border); color: var(--color-muted); } .btn.danger { border-color: color-mix(in srgb, var(--color-danger-text) 30%, transparent); color: var(--color-danger-text); }
.btn.link { padding: 0; height: auto; color: var(--color-accent); }
.ib { display: inline-grid; place-items: center; border-radius: 6px; color: var(--color-muted); } .ib.sm { width: 26px; height: 26px; } .ib.xs { width: 20px; height: 20px; border-radius: 4px; }
.ib:hover, .ib.sm:first-child { background: var(--color-hover-row); color: var(--color-text); } .ib.danger:hover { color: var(--color-danger-text); }
.fld { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; font-size: 12px; border-radius: 6px; background: var(--color-input-bg); border: 1px solid var(--color-input-border); color: var(--color-text); width: 100%; min-width: 0; overflow: hidden; white-space: nowrap; }
.fld .fv { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; } .fld.ph .fv, .fv.ph { color: var(--color-muted); }
.fld.num .fv { text-align: right; font-variant-numeric: tabular-nums; } .fld.num-l .fv { font-variant-numeric: tabular-nums; }
.fld .unit, .fld .lead, .fld .trail { color: var(--color-muted); display: inline-flex; }
.w-xs { width: 64px; } .w-md { width: 144px; } .fld.full { width: 100%; }
.fld.ro { background: transparent; border-style: dashed; color: var(--color-muted); } .fld.err { border-color: var(--color-danger-text); }
.fld.ta { height: auto; min-height: 64px; align-items: flex-start; padding: 5px 10px; line-height: 1.6; white-space: normal; max-width: 280px; }
.fld.trig { width: 140px; }
.flab { font-size: 12px; color: var(--color-muted); } .ferr { font-size: 12px; color: var(--color-danger-text); margin-top: -4px; }
.menu { width: 190px; background: var(--color-surface); border: 1px solid var(--color-border-header); border-radius: 12px; box-shadow: var(--shadow); padding: 4px; display: flex; flex-direction: column; }
.menu.pad { padding: 10px 12px; width: auto; }
.mi { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; border-radius: 6px; font-size: 13px; color: var(--color-text); }
.mi.on { background: var(--color-accent-tint); justify-content: space-between; } .mi.dang { color: var(--color-danger-text); }
.mdiv { height: 1px; background: var(--color-border-divider); margin: 4px 0; }
.cb, .tg { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
.cb i { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--color-input-border); background: var(--color-input-bg); position: relative; flex-shrink: 0; }
.cb.on i, .cb.mixed i { background: var(--color-accent); border-color: var(--color-accent); }
.cb.on i::after { content: ""; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.cb.mixed i::after { content: ""; position: absolute; left: 3px; right: 3px; top: 6px; height: 2px; background: #fff; }
.tg i { width: 28px; height: 16px; border-radius: 99px; background: var(--color-input-border); position: relative; flex-shrink: 0; }
.tg i::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 99px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.tg.on i { background: var(--color-accent); } .tg.on i::after { left: 14px; }
.seg { display: inline-flex; background: var(--color-input-bg); border-radius: 6px; padding: 2px; gap: 2px; font-size: 12px; }
.seg span { height: 22px; display: inline-flex; align-items: center; padding: 0 10px; border-radius: 4px; color: var(--color-muted); }
.seg .on { background: var(--color-surface); color: var(--color-text); box-shadow: 0 1px 2px rgba(0,0,0,.1); }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 99px; font-size: 12px; border: 1px solid var(--color-input-border); color: var(--color-muted); }
.chip.on { background: var(--color-accent); border-color: var(--color-accent); color: #fff; } .chip b { font-weight: 500; opacity: .85; }
.pill { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px; border-radius: 99px; font-size: 12px; font-weight: 500; background: var(--color-input-bg); color: var(--color-text-secondary); white-space: nowrap; }
.pill.success { background: var(--color-success-bg); color: var(--color-success-text); } .pill.warning { background: var(--color-warning-bg); color: var(--color-warning-text); }
.pill.danger { background: var(--color-danger-bg); color: var(--color-danger-text); }
.tag-p { background: var(--tag-p-bg); color: var(--tag-p); } .tag-b { background: var(--tag-b-bg); color: var(--tag-b); } .tag-g { background: var(--tag-g-bg); color: var(--tag-g); } .tag-o { background: var(--tag-o-bg); color: var(--tag-o); }
.px { display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 99px; opacity: .7; }
.cnt { display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 5px; border-radius: 99px; font-size: 10px; font-weight: 600; background: var(--color-danger-text); color: #fff; font-variant-numeric: tabular-nums; }
.cnt.neutral { background: var(--color-input-bg); color: var(--color-muted); }
.lbl { font-size: 10px; font-weight: 500; letter-spacing: .1em; text-transform: uppercase; color: var(--color-muted); }
.lbl.ruled { display: block; width: 100%; padding-bottom: 8px; border-bottom: 1px solid var(--color-border-divider); margin-bottom: 4px; }
.lcnt { font-size: 12px; color: var(--color-muted); font-variant-numeric: tabular-nums; font-weight: 400; letter-spacing: 0; text-transform: none; margin-left: 4px; }
.kbd { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; font: 11px var(--mono); border-radius: 4px; border: 1px solid var(--color-input-border); border-bottom-width: 2px; color: var(--color-muted); }
.tip { font-size: 12px; padding: 4px 8px; border-radius: 6px; background: var(--color-text); color: var(--color-bg); margin-left: 6px; }
.h1 { font-size: 20px; font-weight: 600; letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.h2 { font-size: 14px; font-weight: 600; } .body { font-size: 14px; } .small { font-size: 12px; color: var(--color-muted); }
.stat { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ph { width: 100%; display: flex; flex-direction: column; gap: 2px; } .phm { padding-left: 34px; font-size: 12px; color: var(--color-muted); }
.peek { display: flex; align-items: center; width: 100%; padding: 6px 8px; border-bottom: 1px solid var(--color-border-header); background: var(--color-surface); }
.card { background: var(--color-surface); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 280px; }
.stage .card { box-shadow: 0 0 0 1px var(--color-border-header); }
.card.inset { padding: 12px; box-shadow: 0 0 0 1px var(--color-border-divider) inset; gap: 2px; font-size: 13px; }
.stage .card.inset { box-shadow: 0 0 0 1px var(--color-border-header); }
.card.dashed { background: transparent; box-shadow: none; border: 1px dashed var(--color-input-border); padding: 10px 12px; text-align: center; }
.dlg { width: 100%; max-width: 300px; background: var(--color-surface); border: 1px solid var(--color-border-header); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; }
.dlg.sm { max-width: 240px; } .dh { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--color-border-divider); color: var(--color-muted); }
.dh .h2 { color: var(--color-text); } .db { padding: 14px; display: flex; flex-direction: column; gap: 4px; }
.df { display: flex; justify-content: flex-end; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--color-border-divider); }
.g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; width: 100%; }
.toast { display: flex; align-items: center; gap: 10px; width: 100%; max-width: 270px; padding: 10px 12px; font-size: 13px; background: var(--color-surface); border: 1px solid var(--color-border-header); border-radius: 12px; box-shadow: var(--shadow); }
.dot { width: 8px; height: 8px; border-radius: 99px; flex-shrink: 0; } .dot.ok { background: var(--color-success-text); } .dot.err { background: var(--color-danger-text); }
.tact { margin-left: auto; color: var(--color-accent); font-weight: 500; font-size: 12px; white-space: nowrap; padding-left: 8px; }
.callout { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border-radius: 8px; font-size: 12px; }
.callout.warn { background: var(--color-warning-bg); color: var(--color-warning-text); } .callout.dang { background: var(--color-danger-bg); color: var(--color-danger-text); }
.bar { } .col .bar { display: block; width: 100%; height: 6px; border-radius: 99px; background: var(--color-input-bg); overflow: hidden; position: static; border: 0; backdrop-filter: none; }
.col .bar i { display: block; height: 100%; background: var(--color-accent); border-radius: 99px; }
.srow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--color-border-divider); font-size: 13px; }
.srow:last-child { border-bottom: 0; }
.tbl { width: 100%; max-width: 290px; border-collapse: collapse; font-size: 13px; background: var(--color-surface); border-radius: 8px; overflow: hidden; }
.tbl th { height: 30px; text-align: left; font-size: 12px; font-weight: 500; color: var(--color-muted); border-bottom: 1px solid var(--color-border-header); padding: 0 10px; }
.tbl td { height: 36px; border-bottom: 1px solid var(--color-border-divider); padding: 0 10px; white-space: nowrap; }
.tbl .n { text-align: right; font-variant-numeric: tabular-nums; } .tbl .cbx { width: 28px; padding: 0 0 0 10px; } .tbl .act { width: 28px; padding: 0 6px; }
.tbl tr:not(.hov) .act .ib { opacity: 0; } .tbl tr.hov td { background: var(--color-hover-row); } .tbl tr.grp td { height: 28px; }
.bulk { display: inline-flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; font-size: 12px; background: var(--color-surface); border-radius: 12px; box-shadow: var(--shadow); }
.empty { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; font-size: 13px; width: 100%; color: var(--color-text); }
.empty .btn { margin-top: 6px; } .eic { color: var(--color-muted); opacity: .45; margin-bottom: 4px; }
.sk { display: block; height: 10px; width: 100%; border-radius: 4px; background: var(--color-border-header); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .5; } } @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
.nav { display: flex; align-items: center; gap: 8px; width: 180px; height: 28px; padding: 0 10px; border-radius: 6px; font-size: 13px; color: var(--color-muted); }
.nav.on { background: var(--color-hover-row); color: var(--color-text); font-weight: 500; }
.tab { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px; font-size: 12px; border-radius: 6px; color: var(--color-muted); white-space: nowrap; }
.tab.on { background: var(--color-surface); color: var(--color-text); box-shadow: 0 0 0 1px var(--color-border-header); }
.ic2 { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 6px; color: var(--color-muted); background: var(--color-surface); box-shadow: 0 0 0 1px var(--color-border-header) inset; }
.iren { font-size: 14px; border-bottom: 1px solid var(--color-accent); padding: 0 2px; }
/* Reference sections */
.ref { border: 1px solid var(--color-border-header); border-radius: 12px; background: var(--color-surface); overflow: hidden; }
.sws { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0; }
.sw { display: grid; grid-template-columns: 28px 1fr; grid-template-rows: auto auto; column-gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--color-border-divider); align-items: center; }
.sw i { grid-row: span 2; width: 28px; height: 28px; border-radius: 8px; box-shadow: 0 0 0 1px var(--color-border-header) inset; }
.sw span { font-size: 12px; font-weight: 500; } .sw code { color: var(--color-muted); font-size: 10.5px; }
.tw { overflow-x: auto; } table.tok { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tok td { padding: 9px 14px; border-bottom: 1px solid var(--color-border-divider); vertical-align: top; } .tok tr:last-child td { border-bottom: 0; }
.tok code { white-space: nowrap; } .muted { color: var(--color-muted); }
.rules { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0; }
.rule { padding: 12px 16px; border-bottom: 1px solid var(--color-border-divider); display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.rule b { font-size: 12px; } .rule span { color: var(--color-text-secondary); }
.ddg { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.ddc { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid var(--color-border-header); border-radius: 10px; background: var(--color-surface); color: var(--color-text); font-size: 13px; }
.ddc:hover { background: var(--color-hover-row); text-decoration: none; } .ddc span { font-size: 11px; color: var(--color-success-text); } .ddc span.open { color: var(--color-warning-text); }
.sub { font-size: 12px; color: var(--color-muted); margin: -4px 0 12px; }
@media (max-width: 820px) { .layout { grid-template-columns: minmax(0, 1fr); } .toc { display: none; } }
@media (max-width: 420px) { .grid { grid-template-columns: minmax(0, 1fr); } }
"""

JS = r"""
(() => {
  const root = document.documentElement;
  const paint = () => {
    const cur = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.querySelectorAll("[data-th]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.th === cur)));
  };
  document.querySelectorAll("[data-th]").forEach(b => b.addEventListener("click", () => { root.setAttribute("data-theme", b.dataset.th); paint(); }));
  paint();
  let cat = "all";
  const q = document.getElementById("q");
  const comps = [...document.querySelectorAll(".comp")];
  const cats = [...document.querySelectorAll("section.cat")];
  const none = document.getElementById("none");
  const count = document.getElementById("shown");
  const apply = () => {
    const t = q.value.trim().toLowerCase();
    let n = 0;
    comps.forEach(c => { const ok = (cat === "all" || c.dataset.cat === cat) && (!t || c.dataset.search.includes(t)); c.classList.toggle("hidden", !ok); if (ok) n++; });
    cats.forEach(s => s.classList.toggle("hidden", !s.querySelector(".comp:not(.hidden)")));
    none.hidden = n !== 0; count.textContent = n;
  };
  document.querySelectorAll(".fchip").forEach(b => b.addEventListener("click", () => {
    cat = b.dataset.f;
    document.querySelectorAll(".fchip").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
    apply();
  }));
  q.addEventListener("input", apply);
  document.addEventListener("keydown", e => { if (e.key === "/" && document.activeElement !== q) { e.preventDefault(); q.focus(); } if (e.key === "Escape" && document.activeElement === q) { q.value = ""; apply(); } });
})();
"""

body = f"""
<header class="top wrap">
  <span class="eyebrow">StudioManager · src/components/ui</span>
  <h1>Component library</h1>
  <p class="lead-p">Every building block in the app, drawn with its real measures and colours. Find one before writing new markup: each card shows the component, where it lives, its main props, and the deep dive that decided it.</p>
  <div class="facts"><span><b>{len(E)}</b> components and patterns</span><span><b>{len(TOKENS)}</b> token groups</span><span><b>{len(DD)}</b> deep dives · <b>{len(OPEN)}</b> to decide</span><span>Draft PR #2</span></div>
</header>
<div class="bar"><div class="wrap">
  <label class="q" for="q">{ic(I["search"],13)}<input id="q" type="search" placeholder="Search components, props or files  ( / )" autocomplete="off"></label>
  <div class="fchips" role="group" aria-label="Category">{chips}</div>
  <span class="small"><b id="shown">{len(E)}</b> shown</span>
  <div class="seg-t" role="group" aria-label="Theme"><button type="button" data-th="light">Light</button><button type="button" data-th="dark">Dark</button></div>
</div></div>
<div class="wrap layout">
  <nav class="toc" aria-label="Sections">{toc}</nav>
  <main>
    {sections}
    <p class="noresults" id="none" hidden>Nothing matches. Try a prop name like "numeric" or a file like "Form.tsx".</p>
    <section id="tokens"><div class="cat-head"><h2>Tokens</h2></div>
      <p class="sub">Colours come from <code>src/index.css</code>; class strings from <code>ui/tokens.ts</code>. Use them instead of retyping classes.</p>
      <div class="ref" style="margin-bottom:12px"><div class="sws">{swatches}</div></div>
      <div class="ref tw"><table class="tok"><tbody>{tokrows}</tbody></table></div>
    </section>
    <section id="rules"><div class="cat-head"><h2>Rules</h2></div>
      <p class="sub">The decisions from the deep dives, in one place. DESIGN-SYSTEM.md has the full text.</p>
      <div class="ref"><div class="rules">{rules}</div></div>
    </section>
    <section id="deepdives"><div class="cat-head"><h2>Deep dives</h2><span class="n">{len(DD)}</span></div>
      <p class="sub">How each part was measured and decided. Start a new one the same way: survey, page, decisions in comments, build.</p>
      <div class="ddg">{dds}</div>
    </section>
  </main>
</div>
<script>{JS}</script>
"""
out = '<title>StudioManager Component Library</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>' + CSS + "</style>\n" + body
(TMP / "library.html").write_text(out)
print(len(E), "entries", len(out), "bytes")
