from dd import page, var, table, rules, code

CSS = """
.t-xl { font-size: 20px; font-weight: 600; }
.t-xlt { font-size: 20px; font-weight: 600; letter-spacing: -.02em; }
.t-base { font-size: 16px; font-weight: 500; }
.t-sm { font-size: 14px; font-weight: 500; }
.t-sms { font-size: 14px; font-weight: 600; letter-spacing: -.01em; }
.t-xs { font-size: 12px; font-weight: 600; letter-spacing: -.01em; }
.t-lg { font-size: 18px; font-weight: 600; }
.hrow { display: flex; align-items: center; gap: 10px; }
.ib2 { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 6px; color: var(--color-muted); }
.ib2.o { border: 1px solid var(--color-input-border); }
.scale { display: grid; grid-template-columns: 120px 1fr 200px; gap: 10px 16px; align-items: baseline; padding: 16px 20px; }
.scale .k { font-family: var(--mono); font-size: 11px; color: var(--color-muted); }
.scale .u { font-size: 12px; color: var(--color-muted); }
"""
ARROW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>'

today = "".join([
    var("Page titles", "4 styles", '<div class="t-xl">Invoices</div><div class="xs muted">PageHeader · no tracking</div><div class="t-xlt" style="margin-top:10px">October 2026</div><div class="xs muted">Calendar · tight</div><div class="lbl10" style="margin-top:12px">Settings</div><div class="xs muted">Settings sidebar · a 10px label as h1</div>'),
    var("Back buttons", "IconButton vs outline Button", f'<div class="hrow"><span class="ib2">{ARROW}</span><span class="t-xl">Art Basel</span></div><div class="xs muted" style="margin:2px 0 10px">Client detail</div><div class="hrow"><span class="b o" style="padding:0 8px">{ARROW}</span><span class="t-xl">New invoice</span></div><div class="xs muted">Invoice and quote forms (18px icon)</div>'),
    var("Card titles", "6 styles", '<div class="t-sm">Revenue by client</div><div class="xs muted" style="margin-bottom:8px">Finances · h2 text-sm</div><div class="t-base">Recurring invoices</div><div class="xs muted" style="margin-bottom:8px">Invoices · text-base (off scale)</div><div class="t-xs">Tasks</div><div class="xs muted" style="margin-bottom:8px">Project blocks · text-xs semibold</div><div class="lbl10">Projects (4)</div><div class="xs muted">Client detail · label, count in the text</div>'),
    var("Dashboard widgets", "2 title systems", '<div class="t-sm" style="margin-bottom:8px">Overdue invoices</div><div class="xs muted" style="margin-bottom:10px">22 widgets · PanelTitle</div><div class="lbl10">Revenue this month</div><div class="t-lg">CHF 18 130</div><div class="xs muted">9 stat widgets · label + text-lg value (off scale)</div>'),
    var("Wiki", "body h1 bigger than the title", '<div class="t-xlt">Brand guidelines</div><div class="xs muted" style="margin-bottom:8px">title: an input, not a heading · 20px</div><div style="font-size:21px;font-weight:600">Colours</div><div class="xs muted">body h1 · 21px</div>'),
    var("Detail pages", "title in the back row, or below it", f'<div class="hrow"><span class="ib2">{ARROW}</span><span class="t-xl">Art Basel</span><span class="b d" style="margin-left:auto">Delete</span></div><div class="xs muted" style="margin:2px 0 10px">Client: one row, h1</div><div class="hrow"><span class="ib2">{ARROW}</span><span class="b d" style="margin-left:auto">Delete</span></div><div class="t-xlt">Key visual 2027</div><div class="xs muted">Project: two rows, h2, no h1</div>'),
])

scale = '<div class="panel"><div class="scale">' + "".join(
    f'<span class="k">{k}</span><span class="{c}">{s}</span><span class="u">{u}</span>' for k, c, s, u in [
        ("1 · page", "t-xlt", "Invoices", "PageHeader, detail pages, sidebar titles, wiki article"),
        ("2 · section / card", "t-sms", "Revenue by client", "cards, widgets, modals, peek panels, project blocks"),
        ("label", "lbl10", "Projects · 4", "groups above content (SectionLabel)"),
    ]) + '</div></div>'

header = f'''<div class="panel" style="padding:16px 20px">
<div class="hrow"><span class="ib2">{ARROW}</span><span class="t-xlt">Key visual 2027</span><span class="pill" style="background:var(--color-warning-bg);color:var(--color-warning-text);font-size:12px;padding:2px 8px;border-radius:99px;font-weight:500">In progress</span><span style="margin-left:auto;display:flex;gap:8px"><span class="b">Duplicate</span><span class="b d">Delete</span></span></div>
<div class="xs muted" style="margin:4px 0 0 36px">Art Basel · due 12.12.2026</div>
<div class="xs muted" style="margin-top:12px">PageHeader with <code>back</code>, a <code>meta</code> line and actions. The same header in a peek panel, at level 2.</div></div>'''


CHL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>'
CHR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>'
def pill(t, c="warning"):
    return f'<span style="background:var(--color-{c}-bg);color:var(--color-{c}-text);font-size:12px;padding:2px 8px;border-radius:99px;font-weight:500">{t}</span>'
def ph(title, back=True, meta="", leading="", actions="", compact=False):
    b = f'<span class="ib2">{ARROW}</span>' if back else ""
    t = f'<span class="{"t-sms" if compact else "t-xlt"}">{title}</span>'
    a = f'<span style="margin-left:auto;display:flex;gap:8px;align-items:center">{actions}</span>' if actions else ""
    ml = 36 if back else 0
    m = f'<div class="xs muted" style="margin:4px 0 0 {ml}px">{meta}</div>' if meta else ""
    box = "padding:10px 16px;border-bottom:1px solid var(--color-border-header);background:var(--color-surface)" if compact else ""
    return f'<div style="{box}"><div class="hrow">{b}{leading}{t}{a}</div>{m}</div>'
def pair(name, before, after, note=""):
    n = f'<div class="xs muted" style="margin-top:8px">{note}</div>' if note else ""
    return (f'<div style="padding:14px 18px;border-bottom:1px solid var(--color-border-header)">'
            f'<div style="font-size:12px;font-weight:600;margin-bottom:8px">{name}</div>'
            f'<div class="g2" style="gap:20px"><div><div class="lbl10" style="margin-bottom:6px">Today</div>{before}</div>'
            f'<div><div class="lbl10" style="margin-bottom:6px">With PageHeader</div>{after}</div></div>{n}</div>')
PH = '<div class="panel">' + "".join([
  pair("Client detail",
       f'<div class="hrow"><span class="ib2">{ARROW}</span><span class="t-xl">Art Basel</span><span style="margin-left:auto;display:flex;gap:8px"><span class="b d">Delete</span></span></div>',
       ph("Art Basel", meta="Basel · 12 projects · CHF 96 400 this year", actions='<span class="b d">Delete</span>'),
       "Same row, plus a meta line; tight title."),
  pair("Project detail",
       f'<div class="hrow"><span class="ib2">{ARROW}</span><span class="b d" style="margin-left:auto">Delete</span></div><div class="hrow" style="margin-top:12px"><span class="t-xlt">Key visual 2027</span><span class="b" style="padding:0 8px">In progress ▾</span></div><div class="xs muted">Art Basel</div>',
       ph("Key visual 2027", meta="Art Basel · due 12.12.2026", actions=pill("In progress ▾") + '<span class="b d">Delete</span>'),
       "Two rows become one; the title becomes the page's h1."),
  pair("Invoice and quote forms",
       f'<div class="hrow"><span class="b o" style="padding:0 8px">{ARROW}</span><span class="t-xl">New invoice</span></div>',
       ph("New invoice", meta="Draft · Art Basel"),
       "The outline back button becomes the same quiet arrow; it still asks before leaving unsaved changes."),
  pair("Calendar",
       f'<div class="hrow"><span class="ib2">{CHL}</span><span class="ib2">{CHR}</span><span class="b">Today</span><span class="t-xlt">October 2026</span><span style="margin-left:auto" class="xs muted">Month · Week · Day</span></div>',
       ph("October 2026", back=False, leading=f'<span class="ib2">{CHL}</span><span class="ib2">{CHR}</span><span class="b">Today</span>', actions='<span class="xs muted">Month · Week · Day</span>'),
       "Same layout; the arrows go in <code>leading</code>, the view switch in the actions."),
  pair("Invoice and quote preview",
       f'<div style="padding:10px 16px;border-bottom:1px solid var(--color-border-header);background:var(--color-surface)"><div class="hrow"><span class="ib2">{ARROW}</span><span style="font-size:14px;font-weight:600">INV-2026-014 — Art Basel</span><span style="margin-left:auto" class="b p">Download PDF</span></div></div>',
       ph("INV-2026-014", compact=True, actions='<span class="xs muted">Art Basel</span><span class="b p">Download PDF</span>'),
       "Compact bar: level-2 title, same back arrow and actions."),
  pair("Profile and Settings sidebars",
       '<div style="display:flex;gap:24px"><div><div class="t-xl">Profile</div><div class="xs muted">20px</div></div><div><div class="lbl10">Settings</div><div class="xs muted">10px label</div></div></div>',
       '<div style="display:flex;gap:24px"><div class="t-xlt">Profile</div><div class="t-xlt">Settings</div></div>',
       "Both get the level-1 title (agreed)."),
]) + '</div>'

p = page(
    file="headings.html", title="StudioManager Headings", eyebrow="StudioManager · type scale", h1="Headings",
    intro="Titles use six sizes (10, 12, 14, 16, 18 and 20px, plus the wiki's own 21, 17.5 and 15.4px), and the same kind of title is styled differently from page to page. Nine of twenty pages build their header by hand, and the heading levels skip around. This page measures them and proposes two heading sizes and a label.",
    stats=[("6 + 3", "title sizes (app + wiki)"), ("9 / 20", "pages without PageHeader"), ("6", "card-title styles"), ("2", "doc rules the components don't follow")],
    sections=[
        {"h2": "Today", "sub": "Each drawn with its own classes.", "body": f'<div class="panel"><div class="var-grid">{today}</div></div>'},
        {"h2": "What else differs", "body": table([
            ["<b>Doc vs components</b>", "The doc says page titles are tight-tracked and card titles semibold; PageHeader isn't tight and PanelTitle (modals, widgets) is medium."],
            ["<b>Pages without PageHeader</b>", "Client and project detail, invoice and quote forms, previews, calendar, profile, settings and wiki: back buttons, toolbars or sidebars that PageHeader can't take."],
            ["<b>Heading levels</b>", "Project detail has no h1; project cards are h3 under no h2; Finances' group labels are divs above h2 cards; modal titles are always h3; the wiki title is an input and its body adds more h1s."],
            ["<b>Counts</b>", "Baked into the text (\"Projects (4)\"), a \"(4)\" span, or a bare number."],
            ["<b>Peek panels</b>", "Projects: close on the left, open-full-page on the right, with a border. Calendar: the other way round, no border."],
            ["<b>Off-scale sizes</b>", "text-base for three titles and the line-item totals, text-lg for nine stat values."],
        ])},
        {"h2": "Proposal: two heading sizes and a label", "body": scale},
        {"h2": "One page header", "body": header},
        {"h2": "Every page on PageHeader: before and after", "body": PH},
        {"h2": "The rules it would enforce", "body": rules("Sizes", [
            "<b>Level 1</b> 20px semibold, tight: one per page, always an h1.",
            "<b>Level 2</b> 14px semibold: cards, widgets, modals, peek panels, project blocks. PanelTitle becomes semibold.",
            "<b>Label</b> 10px uppercase: groups above content. Not used as a page title.",
            "No 12, 16 or 18px titles. Stat values are 20px. Wiki prose headings map to the same scale, below the article title.",
        ], "Structure", [
            "<b>PageHeader</b> takes <code>back</code> (one IconButton, with the unsaved-changes check), <code>meta</code> (client link, status) and <code>leading</code> (calendar arrows). All 20 pages use it; previews use its compact bar.",
            "<b>Counts</b> are a <code>count</code> prop on PanelTitle and SectionLabel, never part of the text.",
            "<b>Peek panels</b> share one header: close on the left, open-full-page on the right.",
            "<b>Levels follow the page</b>: h1 page → h2 sections and cards → h3 inside them.",
            "<b>StatTile</b> (label + value) for the 9 stat widgets.",
        ]) + code('<PageHeader title={project.name} back={() => nav("/projects")} meta={<ClientLink … />}>\n  <Button variant="danger">{t.delete}</Button>\n</PageHeader>\n<PanelTitle title={t.projects} count={4} action={…} />\n<StatTile label={t.revenue_month} value="CHF 18 130" />')},
    ],
    decisions=[
        ("Card and modal titles semibold (as the doc says) or medium (as PanelTitle is)?", "Semibold separates them more clearly from body text at the same 14px."),
        ("PageHeader with back, meta and leading on every page?", "Detail pages, forms, previews and the calendar move onto it; the outline back button goes."),
        ("Stat values at 20px?", "Nine dashboard numbers move from 18px (off scale) to the page-title size."),
        ("Settings and Profile sidebar title: 20px title or 10px label?", "They are twin layouts styled differently today. Proposal: both 20px, like Profile."),
        ("Wiki article title as a real heading?", "The editable title becomes the page's h1 and the body's headings sit below it in size."),
    ],
    extra_css=CSS,
)
print(p)
