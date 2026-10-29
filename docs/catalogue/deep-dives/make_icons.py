from dd import page, var, table, rules, code
import pathlib

CSS = """
.ic { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; }
.ic svg { flex-shrink: 0; }
.cmp { display: grid; grid-template-columns: 150px 1fr 1fr; }
.cmp > div { padding: 10px 16px; border-bottom: 1px solid var(--color-border-divider); display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; min-width: 0; font-size: 12px; }
.cmp .h { font-size: 10px; font-weight: 500; letter-spacing: .1em; text-transform: uppercase; color: var(--color-muted); }
.cmp .c { font-weight: 600; }
.bad { color: var(--color-danger-text); } .good { color: var(--color-success-text); }
.sizes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
.sizes > div { padding: 14px 16px; border-right: 1px solid var(--color-border-divider); border-bottom: 1px solid var(--color-border-divider); display: flex; flex-direction: column; gap: 8px; }
.sizes b { font-size: 12px; } .sizes span { font-size: 11px; color: var(--color-muted); }
@media (max-width: 640px) { .cmp { grid-template-columns: 1fr; } }
"""

def L(name, size=14, label=None, sw=None):
    s = f' stroke-width="{sw}"' if sw else ""
    t = f'<span>{label}</span>' if label else ""
    return f'<span class="ic"><i data-lucide="{name}" width="{size}" height="{size}"{s}></i>{t}</span>'

rows = [
    ("Settings · more", [L("settings","14","Settings · sidebar"), L("settings-2",14,"Settings2 · settings + row menu"), L("sliders-horizontal",14,"Behavior")], [L("settings-2",14,"settings"), L("ellipsis",14,"more (row menu)"), L("sliders-horizontal",14,"behavior")]),
    ("Done", [L("circle-check",14,"CheckCircle · mark paid/done"), L("circle-check-big",14,"CheckCircle2 · success"), L("check",14,"Check · selected, save, read")], [L("circle-check-big",14,"done, paid, success"), L("check",14,"selected, save, read")]),
    ("Open elsewhere", [L("external-link",14,"ExternalLink"), L("arrow-up-right",14,"ArrowUpRight · wiki new tab")], [L("external-link",14,"open in new tab, open URL"), L("arrow-up-right",14,"go to linked item")]),
    ("Project", [L("folder-kanban",14,"sidebar"), L("folder-open",14,"empty states, timeline + Finder"), L("folder",14,"column")], [L("folder-kanban",14,"project"), L("folder-open",14,"open folder in Finder"), L("folder-plus",14,"new project")]),
    ("Invoice · quote", [L("file-text",14,"invoice + quote + wiki"), L("file-plus-2",14,"quote · sidebar"), L("clipboard-list",14,"quote · widget"), L("receipt",14,"invoice · timeline")], [L("file-text",14,"invoice"), L("file-plus-2",14,"quote"), L("receipt",14,"expense"), L("book-open",14,"wiki article")]),
    ("Income", [L("trending-up",14,"sidebar"), L("wallet",14,"empty state")], [L("trending-up",14,"income")]),
    ("Calendar", [L("calendar-days",14,"sidebar"), L("calendar",14,"date fields"), L("calendar-range",14,"range")], [L("calendar-days",14,"calendar"), L("calendar",14,"date field"), L("calendar-range",14,"range")]),
    ("Reorder", [L("arrow-up",14,"Arrow · organisations"), L("chevron-up",14,"Chevron · line items")], [L("chevron-up",14,"move up / down"), L("arrow-up-down",14,"sort")]),
    ("Two meanings", [L("download",14,"PDF + Updates tab"), L("palette",14,"appearance + templates"), L("bookmark",14,"saved filter + resource"), L("copy",14,"duplicate + copy"), L("triangle-alert",14,"warning + reminder")], [L("refresh-cw",14,"updates"), L("layout-template",14,"templates"), L("star",14,"saved filter"), L("copy-plus",14,"duplicate"), L("bell-ring",14,"reminder")]),
]
cmp = '<div class="panel"><div class="cmp"><div class="h">Concept</div><div class="h">Today</div><div class="h">Proposed</div>' + "".join(
    f'<div class="c">{c}</div><div>{"".join(t)}</div><div>{"".join(n)}</div>' for c, t, n in rows) + '</div></div>'

sizes = '<div class="panel"><div class="sizes">' + "".join(
    f'<div>{L(n, s, sw=sw)}<b>{s}px · {k}</b><span>{u}</span></div>' for s, k, u, n, sw in [
        (10, "pill", "Tag ×, badges, tab pin, checks", "x", None),
        (12, "control", "Button, Input, IconButton xs, sort arrows, inline with 12px text", "plus", None),
        (14, "menu", "menus, nav lists, trees, tabs, IconButton sm", "pencil", None),
        (16, "callout", "callouts, toasts, notifications, command palette", "triangle-alert", None),
        (18, "nav", "app sidebar (stroke 1.5)", "house", "1.5"),
        (20, "empty sm", "EmptyState sm", "inbox", None),
        (32, "empty lg", "EmptyState lg, drop zones", "inbox", None),
    ]) + '</div></div>'

p = page(
    file="icons.html", title="StudioManager Icons", eyebrow="StudioManager · lucide icons", h1="Icons",
    intro="Icons are consistent for the basics (delete, edit, add, close, search) but not for the app's own things: project, quote, income and settings each use two to four icons, and nine icons mean two different things. Sizes are typed by hand at about 260 places (seven values plus a stray 13). This page lists them and proposes a canonical map and a size per context.",
    stats=[("~265", "icons drawn, all sized by hand"), ("9", "icons with two meanings"), ("7 + 1", "sizes in use (plus a stray 13px)"), ("~10", "icon-only controls not on IconButton")],
    sections=[
        {"h2": "Same concept, different icons", "sub": "Real lucide glyphs.", "body": cmp},
        {"h2": "Proposal: one size per context", "body": sizes},
        {"h2": "What else differs", "body": table([
            ["<b>Swapped in the client timeline</b>", "Invoices show the expense icon (Receipt) and quotes the invoice icon (FileText)."],
            ["<b>Outliers</b>", "Delete in the client and project page headers is 14px (12 everywhere else); saved-filter and link-picker menu items 12px (14 elsewhere); workload sort arrows 10px (12 elsewhere); one 13px warning in Profile; notification rows 18px."],
            ["<b>Hand-built</b>", "Workload table menus and header buttons, dashboard preset buttons and the sidebar collapse toggle are raw buttons with icons; two Eye/Pencil links in client detail and the organisation arrows are icon-only without IconButton."],
            ["<b>Glyphs</b>", "The \"recently completed\" widget draws ✓ as text, the calendar uses \"!\" as a deadline marker."],
            ["<b>Doc</b>", "DESIGN-SYSTEM.md shows MoreHorizontal for \"more\" (unused) and Settings2 elsewhere; says Button icons are 14 in one place and 12 in two; has stale 16/18px rows for header buttons, modal close and back."],
            ["<b>Accessibility</b>", "Fine for decorative icons: lucide hides them from screen readers by default. The risk is the ~10 icon-only controls above, which do have labels but no tooltip."],
        ])},
        {"h2": "The rules it would enforce", "body": rules("Icons", [
            "<b>One map</b> <code>ui/icons.ts</code>: concept → lucide icon (<code>ICONS.invoice</code>, <code>ICONS.more</code>…), used by the sidebar, command palette, timeline, notifications and empty states.",
            "<b>One icon per concept</b> and one concept per icon (the proposed column above).",
            "<b>Sizes from context</b>: <code>ICON_SIZE</code> pill 10 · control 12 · menu 14 · callout 16 · nav 18 · empty 20 / 32; strokes default 2, nav 1.5, checks 3.",
        ], "Building blocks", [
            "<b>Components take the icon, not a sized element</b>: Button, NavItem, menu items, BulkActionBar, TabItem and Card.Header accept <code>icon={Download}</code> and size it themselves (as IconButton and EmptyState already do). About 170 hand-typed sizes go.",
            "<b>IconButton as a link</b> for the client-detail Eye/Pencil.",
            "<b>Hand-built menus</b> (workload, dashboard presets) move to Dropdown / ContextMenu.",
            "<b>No text glyphs</b> as icons; lint for stray sizes.",
        ]) + code('import { ICONS } from "./ui/icons";\n<Button icon={ICONS.download}>{t.download_pdf}</Button>\n<IconButton icon={ICONS.more} label={t.more_actions} />\n<NavItem icon={ICONS.invoice} …/>   // sized 14 by NavItem')},
    ],
    decisions=[
        ("A central icon map (ui/icons.ts) with the proposed canonical icons?", "The sidebar, palette, timeline, notifications and empty states all read from it; the timeline swap gets fixed."),
        ("\"More\" = Ellipsis (…), settings = Settings2?", "Row menus switch from the gear to the three dots, so a gear always means settings."),
        ("One size per context (10 / 12 / 14 / 16 / 18 / 20 / 32)?", "The outliers move: header delete 12, menu items 14, sort arrows 12, notifications 16, no 13."),
        ("Components size their own icons?", "Button, NavItem, menus, tabs and Card.Header take an icon component; callers stop writing size={…}."),
        ("Replace the nine double meanings?", "Updates → RefreshCw, templates → LayoutTemplate, saved filter → Star, duplicate → CopyPlus, reminder → BellRing."),
    ],
    extra_css=CSS,
)
html = p.read_text()
html = html.replace("</script>\n", '</script>\n<script src="https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js"></script>\n<script>try { lucide.createIcons(); } catch (e) {}</script>\n', 1) if "</script>\n" in html else html + '<script src="https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js"></script><script>try{lucide.createIcons();}catch(e){}</script>'
p.write_text(html)
print(p)
