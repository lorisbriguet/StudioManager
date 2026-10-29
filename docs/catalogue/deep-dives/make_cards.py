from dd import page, var, table, rules, code

CSS = """
.cd { background: var(--color-surface); border-radius: 12px; }
.cd.b { border: 1px solid var(--color-border-divider); }
.cd.dash { background: transparent; border: 1px dashed var(--color-input-border); }
.cd.inp { background: var(--color-input-bg); }
.cd.hov:hover { background: var(--color-hover-row); }
.cd.sel { outline: 1px solid var(--color-accent); }
.p5 { padding: 20px; } .p4 { padding: 16px; } .p3 { padding: 12px; } .p25 { padding: 10px 12px; }
.ct { font-size: 14px; font-weight: 600; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
.ln { height: 8px; border-radius: 4px; background: var(--color-border-header); margin-bottom: 6px; }
.stagebg { background: var(--color-bg); padding: 16px; display: grid; gap: 16px; }
.pad-show { position: relative; }
.pad-show::after { content: attr(data-pad); position: absolute; top: 2px; right: 6px; font: 10px var(--mono); color: var(--color-muted); }
"""
L = lambda w="100%": f'<div class="ln" style="width:{w}"></div>'

today = "".join([
    var("Page section cards", "20 · 16 · 12/4px", '<div class="stagebg" style="padding:10px;gap:10px">'
        f'<div class="cd p5 pad-show" data-pad="p-5 client"><div class="lbl10" style="margin-bottom:12px">Details</div>{L()}{L("70%")}</div>'
        f'<div class="cd p4 pad-show" data-pad="p-4 project block"><div style="font-size:12px;font-weight:600;margin-bottom:8px">Tasks</div>{L()}{L("60%")}</div>'
        f'<div class="cd b pad-show" style="padding:12px 16px 4px" data-pad="settings"><div class="lbl10" style="padding-bottom:8px;border-bottom:1px solid var(--color-border-divider);margin-bottom:12px">Backup</div>{L("80%")}</div></div>'),
    var("Nested cards", "same role, 3 looks", '<div class="cd p5" style="padding:12px">'
        f'<div class="cd b p25" style="margin-bottom:8px"><b style="font-size:12px">Marc Spiegler</b><div class="xs muted">Contact · border, 10/12px</div></div>'
        f'<div class="cd p3" style="background:var(--color-surface);box-shadow:inset 0 0 0 1px transparent"><b style="font-size:12px">Messeplatz 10</b><div class="xs muted">Address · no border, 12px</div></div></div>'),
    var("Card titles", "8 styles", '<div style="font-size:14px;font-weight:500">Revenue by client</div><div class="xs muted" style="margin-bottom:8px">Finances · h2, 16px below</div><div style="font-size:16px;font-weight:500">Recurring invoices</div><div class="xs muted" style="margin-bottom:8px">Invoices · 16px (off scale)</div><div class="lbl10">Projects (4)</div><div class="xs muted">Client detail · label, 12px below</div>'),
    var("Dashboard widgets", "not Card · 16, 12 or 0px", f'<div class="stagebg" style="padding:10px;gap:10px;grid-template-columns:1fr 1fr"><div class="cd p4"><div style="font-size:14px;font-weight:500;margin-bottom:8px">Overdue</div>{L()}</div><div class="cd p3"><div class="xs muted" style="margin-bottom:6px">Time this week</div>{L("80%")}</div></div>'),
    var("Clickable cards", "none use Card", f'<div class="stagebg" style="padding:10px;gap:10px"><div class="cd p4 hov sel"><b style="font-size:13px">Key visual 2027</b><div class="xs muted">Projects grid · outline when selected</div></div><div class="cd b hov" style="padding:10px;border-radius:8px"><b style="font-size:12px">Brand guidelines</b><div class="xs muted">Wiki item · 8px corners</div></div></div>'),
    var("Dashed boxes", "12px·xl vs 10px·lg", '<div class="cd dash p3" style="margin-bottom:8px"><span class="xs muted">New contact draft</span></div><div class="cd dash" style="padding:10px;border-radius:8px"><span class="xs muted">Unlinked mention</span></div>'),
])

proposal = f'''<div class="panel"><div class="stagebg" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
<div><div class="xs muted" style="margin-bottom:6px">padding="md" · 16px · default</div><div class="cd p4"><div class="ct">Revenue by client <span class="xs muted" style="font-weight:400">View all</span></div>{L()}{L("70%")}{L("85%")}</div></div>
<div><div class="xs muted" style="margin-bottom:6px">padding="sm" · 12px · nested, bordered</div><div class="cd p4"><div class="ct">Contacts</div><div class="cd b p3" style="margin-bottom:8px"><b style="font-size:12px">Marc Spiegler</b><div class="xs muted">Director</div></div><div class="cd b p3"><b style="font-size:12px">Messeplatz 10</b><div class="xs muted">4058 Basel</div></div></div></div>
<div><div class="xs muted" style="margin-bottom:6px">interactive · selected</div><div class="cd p4 hov sel"><div class="ct" style="margin-bottom:6px">Key visual 2027</div><div class="xs muted">Art Basel · due 12.12</div></div></div>
<div><div class="xs muted" style="margin-bottom:6px">tone="dashed" · add / draft</div><div class="cd dash p3" style="text-align:center"><span class="xs muted">+ Add contact</span></div></div>
</div></div>'''

p = page(
    file="cards.html", title="StudioManager Cards", eyebrow="StudioManager · surfaces", h1="Cards",
    intro="Card is used 19 times, and 12 of those turn its padding off to set their own. The biggest family, the 40 dashboard widgets, and every clickable card don't use it at all. Padding is 20, 16, 12 or 10px for the same kind of card, titles come in eight styles, and nested cards sometimes have an edge and sometimes don't. This page measures them and proposes one Card with sizes, tones and a header.",
    stats=[("19 · 12", "Card uses · with padding turned off"), ("40", "dashboard widgets not on Card"), ("4", "paddings (20, 16, 12, 10px)"), ("8", "card-title styles")],
    sections=[
        {"h2": "Today", "sub": "Drawn with each card's own padding, border and title.", "body": f'<div class="panel"><div class="var-grid">{today}</div></div>'},
        {"h2": "What else differs", "body": table([
            ["<b>Doc vs code</b>", "The doc says card padding is 16px; Card uses 20px. The documented card shadow is never used."],
            ["<b>Closable panels</b>", "Recurring invoices: 20px, title 16px. Dashboard widget store: 16px, title 16px. Both hand-build the title row and close button."],
            ["<b>Widgets</b>", "23 use WidgetShell (16px + title); 5 time widgets use 12px and a grey text title; 9 stat tiles have no top or bottom padding."],
            ["<b>Nested cards</b>", "Contacts have a border, addresses don't (and vanish on the surface); 8px between contacts, 12px between addresses."],
            ["<b>Repeated pieces</b>", "The project wiki and resources pickers are the same box written twice; the named-table and workload-template header rows are the same row written twice."],
            ["<b>Spacing between cards</b>", "16px stacks almost everywhere; grids are 16 or 24px apart."],
            ["<b>Hand-built surfaces</b>", "The wiki graph settings panel is a popover surface written by hand; the calendar's first-run hint is a box that should be a Callout."],
        ])},
        {"h2": "Proposal: one Card, three paddings, three tones", "body": proposal},
        {"h2": "The rules it would enforce", "body": rules("Card", [
            "<b><code>padding</code></b> <code>\"md\"</code> 16px (default) · <code>\"sm\"</code> 12px (nested, compact) · <code>\"none\"</code> (tables, lists edge to edge). 20px goes.",
            "<b><code>tone</code></b> <code>\"surface\"</code> (default) · <code>\"inset\"</code> (bordered, for cards inside cards) · <code>\"dashed\"</code> (add / draft).",
            "<b><code>interactive</code></b>: hover tint, pointer, focus ring; <code>selected</code> adds the accent outline. Project cards, wiki items, notifications and tiles.",
            "<b><code>Card.Header title action count</code></b>: level-2 title, 12px below. Replaces the eight hand-written title rows; <code>onClose</code> adds the close button.",
        ], "Layout", [
            "<b>Between cards</b>: 16px in stacks and grids (<code>CARD_GAP</code>).",
            "<b>Nested cards</b>: <code>tone=\"inset\" padding=\"sm\"</code>, 8px apart.",
            "<b>Dashboard</b>: each widget is a Card; WidgetShell becomes Card + Card.Header; stat tiles use the same padding (<code>StatTile</code>).",
            "<b>SettingsCard</b> is a Card with a list inside (rows touch the edges).",
            "<b>Popover-like panels</b> use the popover surface, hints use Callout.",
        ]) + code('<Card>\n  <Card.Header title={t.revenue_by_client} action={<Button variant="link">…</Button>} />\n  …\n</Card>\n<Card tone="inset" padding="sm">…</Card>\n<Card interactive selected={peeked} onClick={open}>…</Card>')},
    ],
    decisions=[
        ("Default padding 16px (doc) instead of 20px (code)?", "Page cards get a little tighter; dashboard widgets and project blocks already use 16px."),
        ("Nested cards always bordered?", "Contacts and addresses get the same thin edge, so a card inside a card is always visible."),
        ("Dashboard widgets on Card?", "40 widgets share one frame, header and padding; the 9 stat tiles become StatTile."),
        ("Card.Header for every card title?", "One title row (level-2 title, count, action, optional close) replaces eight styles."),
        ("16px between cards everywhere?", "The 24px grids on client detail and finances come down to 16px."),
    ],
    extra_css=CSS,
)
print(p)
