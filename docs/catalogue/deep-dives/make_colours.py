from dd import page, var, table, rules, code

CSS = """
.duo { display: grid; grid-template-columns: 1fr 1fr; }
.duo > div { padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.lt { background: #ffffff; color: #111827; } .dk { background: #111111; color: #e5e5e5; }
.lt .cap, .dk .cap { font-size: 10px; font-weight: 500; letter-spacing: .1em; text-transform: uppercase; opacity: .6; }
.mock { border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.mock .r { height: 28px; display: flex; align-items: center; padding: 0 4px; font-size: 12px; }
.mock .fd { height: 26px; border-radius: 6px; display: flex; align-items: center; padding: 0 10px; font-size: 12px; }
.mock .ob { height: 26px; border-radius: 6px; display: inline-flex; align-items: center; padding: 0 10px; font-size: 12px; width: max-content; }
.swr { display: flex; gap: 8px; align-items: center; font-size: 11px; font-family: var(--mono); }
.swr i { width: 40px; height: 22px; border-radius: 6px; flex-shrink: 0; }
.steps { display: flex; gap: 6px; flex-wrap: wrap; }
.steps span { display: inline-flex; align-items: center; justify-content: center; min-width: 64px; height: 34px; border-radius: 8px; font-size: 11px; font-family: var(--mono); padding: 0 6px; }
@media (max-width: 640px) { .duo { grid-template-columns: 1fr; } }
"""

def mock(theme, divider, edge, control, surface, inputbg, muted, label):
    return f'''<div class="{theme}"><span class="cap">{label}</span>
<div class="mock" style="background:{surface};border:1px solid {edge}">
  <div class="r" style="border-bottom:1px solid {edge};color:{muted}">Reference · Amount</div>
  <div class="r" style="border-bottom:1px solid {divider}">INV-2026-014 · 4 800.00</div>
  <div class="r" style="border-bottom:1px solid {divider}">INV-2026-013 · 12 350.00</div>
  <div class="fd" style="background:{inputbg};border:1px solid {control}">Fondation Artvis</div>
  <span class="ob" style="border:1px solid {control};color:{muted}">Export</span>
</div>
<div class="swr"><i style="background:{surface};box-shadow:inset 0 -2px 0 {divider}"></i>divider {divider}</div>
<div class="swr"><i style="background:{surface};border:1px solid {edge}"></i>surface edge {edge}</div>
<div class="swr"><i style="background:{inputbg};border:1px solid {control}"></i>control edge {control}</div>
</div>'''

borders_today = '<div class="panel"><div class="duo">' + mock("lt", "#f7f7f7", "#f0f0f0", "#e5e5e5", "#ffffff", "#f5f5f5", "#5d6570", "Light · today") + mock("dk", "#1f1f1f", "#2a2a2a", "#2a2a2a", "#161616", "#1a1a1a", "#b0b0b0", "Dark · today (edge = control)") + '</div></div>'
borders_new = '<div class="panel"><div class="duo">' + mock("lt", "#f3f3f3", "#e8e8e8", "#d4d4d4", "#ffffff", "#f5f5f5", "#5d6570", "Light · proposed") + mock("dk", "#1e1e1e", "#2a2a2a", "#3a3a3a", "#161616", "#1a1a1a", "#b0b0b0", "Dark · proposed") + '</div></div>'

tints_today = '<div class="panel" style="padding:16px 20px"><div class="steps">' + "".join(
    f'<span style="background:color-mix(in srgb, #2563eb {p}%, var(--color-surface));color:var(--color-text)">{n}</span>' for p, n in
    [(5, "tint 5%"), (8, "grid 8%"), (10, "/10"), (15, "cal 15%"), (20, "/20"), (30, "/30"), (50, "/50")]) + '<span style="background:#dbeafe;color:#1e3a8a">light</span><span style="background:color-mix(in srgb,#dbeafe 30%,var(--color-surface));color:var(--color-text)">light/30</span><span style="background:color-mix(in srgb,#dbeafe 50%,var(--color-surface));color:var(--color-text)">light/50</span></div><p class="xs muted" style="margin-top:10px">Eleven accent tints today, for hover, selection, drop zones, resize handles, calendar events and unread rows.</p></div>'
tints_new = '<div class="panel" style="padding:16px 20px"><div class="steps">' + "".join(
    f'<span style="background:color-mix(in srgb, #2563eb {p}%, var(--color-surface));color:var(--color-text)">{n}</span>' for p, n in
    [(5, "tint · hover, selected row"), (10, "tint-strong · selected item, drop zone"), (25, "handle · resizers, drag")]) + '<span style="background:#dbeafe;color:#1e3a8a">accent-light · chips, unread</span></div></div>'

p = page(
    file="colours.html", title="StudioManager Colours", eyebrow="StudioManager · colour tokens", h1="Colours",
    intro="The app's colours mostly come from tokens now, but the tokens themselves have drifted: three border colours are nearly the same (two are identical in dark mode), there are eleven accent tints, two theme systems disagree, tags and the calendar keep their own palettes in code, and fifteen labels assume white text on the accent. This page measures them and proposes one token set.",
    stats=[("4 → 2", "border tokens · distinct values in dark"), ("11", "accent tints"), ("2", "theme systems that disagree"), ("0", "dark: classes (good)")],
    sections=[
        {"h2": "Borders today", "sub": "A table, a field and an outline button drawn with the current tokens.", "body": borders_today},
        {"h2": "Borders proposed: three roles, clearly apart", "sub": "Divider for rows inside a surface, surface edge for cards, popovers and header lines, control edge for fields and outline buttons so they read as clickable.", "body": borders_new},
        {"h2": "Accent tints", "sub": "Today, then proposed.", "body": tints_today + "<div style='height:12px'></div>" + tints_new},
        {"h2": "What else differs", "body": table([
            ["<b>Two theme systems</b>", "index.css and the theme presets (themes.ts) disagree on muted, sidebar, border and the dark accent; the presets don't set background, text, inputs, hover, dividers or status colours, so those stay on the default theme."],
            ["<b>Focus</b>", "Controls use one focus ring (accent 50% with a 1px gap); keyboard-focused rows use a different one (accent 40%, inset)."],
            ["<b>Text on colour</b>", "15 places write white text on the accent or red fill; a light accent preset (Sand, Dusty Rose) makes them unreadable."],
            ["<b>Overlays</b>", "The tag × hover darkens by 10% black, invisible on dark tags; faded text is muted at 50% or 60%, sometimes faded twice."],
            ["<b>Shadows</b>", "Seven recipes: modal, segmented control, menu, three Tailwind sizes and the chart tooltip."],
            ["<b>Tags and calendar</b>", "The 9 tag colours live in code as hex (light and dark lists); the calendar has its own red/yellow/green events (~28 hex); five of the tag colours equal status colours but yellow and red differ slightly."],
            ["<b>Charts</b>", "Grid and tick colours are hex in a hook; the Finances pie uses tag colours, the dashboard uses chart tokens."],
            ["<b>PDFs</b>", "47 hex values across five PDF files (they can't use CSS variables); the same 7 greys repeated."],
            ["<b>Dead code</b>", "A grey-scale remap for dark mode that nothing uses; the page background is hard-coded instead of using the token."],
        ])},
        {"h2": "The token set it would give", "body": rules("Tokens", [
            "<b>Borders</b>: <code>border-divider</code> · <code>border</code> (surface edge) · <code>input-border</code> (control edge), three distinct values per theme. <code>border-header</code> merges into <code>border</code>.",
            "<b>Accent</b>: <code>accent</code>, <code>accent-hover</code>, <code>accent-light</code>, <code>accent-tint</code> 5%, <code>accent-tint-strong</code> 10%, <code>accent-handle</code> 25%.",
            "<b>Text</b>: <code>text</code>, <code>text-secondary</code>, <code>muted</code>, <code>text-faint</code>, <code>on-accent</code>, <code>on-danger</code> (white or near-black, picked for contrast).",
            "<b>Overlays</b>: <code>scrim</code>, <code>overlay-hover</code> (works on any fill), <code>focus-ring</code> (one ring for controls and rows).",
            "<b>Shadows</b>: <code>shadow-control</code>, <code>shadow-menu</code>, <code>shadow-modal</code>.",
        ], "Sources", [
            "<b>Tags</b> become CSS variables (<code>--color-tag-blue-bg</code>…) in light and dark; success, danger, info and warning reuse them, so a status pill and a tag of the same colour match.",
            "<b>Calendar events</b> use the tag and status variables, not their own hex.",
            "<b>Charts</b> take grid, ticks and cursor from tokens; every chart uses the chart series.",
            "<b>Themes</b> set the whole token set (or derive the rest), and the default values match index.css.",
            "<b>PDFs</b> share one palette constant in code.",
        ]) + code('/* src/index.css */\n--color-border-divider: #f3f3f3;  --color-border: #e8e8e8;  --color-input-border: #d4d4d4;\n.dark { --color-border-divider: #1e1e1e;  --color-border: #2a2a2a;  --color-input-border: #3a3a3a; }\n--color-on-accent: #fff;  --color-focus-ring: color-mix(in srgb, var(--color-accent) 50%, transparent);')},
    ],
    decisions=[
        ("Three border roles with these values?", "Light: divider #f3f3f3, surface edge #e8e8e8, control edge #d4d4d4. Dark: #1e1e1e, #2a2a2a, #3a3a3a. Fields and outline buttons get a little more contrast in both themes; border-header merges into the surface edge."),
        ("Three accent tints (5, 10, 25%) plus accent-light?", "Replaces eleven; resize handles and drop zones use the 25% and 10% steps."),
        ("One focus ring for controls and rows?", "Rows switch from their own inset ring to the shared one."),
        ("Text-on-colour tokens?", "White stays the default; a light accent preset switches it to near-black so labels stay readable."),
        ("Tags and the calendar on CSS variables, status colours shared with tags?", "One palette in CSS for tags, status pills and calendar events, in both themes; the warning yellow and danger red settle on one value each."),
        ("Themes set the full token set?", "The ten theme presets stop falling back to the default for inputs, dividers and status colours, and the default values match index.css."),
    ],
    extra_css=CSS,
)
print(p)
