from dd import page, var, table, rules, code

CSS = """
.fx { position: relative; display: flex; align-items: center; height: 26px; border-radius: 6px; background: var(--color-input-bg); border: 1px solid var(--color-input-border); font-size: 12px; overflow: hidden; }
.fx .v { flex: 1; padding: 0 10px; white-space: nowrap; }
.fx .v.r { text-align: right; font-variant-numeric: tabular-nums; }
.fx .v.l { text-align: left; }
.fx .u { padding: 0 10px 0 0; color: var(--color-muted); }
.fx .ic { padding-left: 9px; color: var(--color-muted); display: flex; }
.fx .spin { display: flex; flex-direction: column; font-size: 7px; line-height: 8px; padding-right: 4px; color: var(--color-muted); }
.sib { display: flex; align-items: center; gap: 4px; }
.ta { border-radius: 6px; background: var(--color-input-bg); border: 1px solid var(--color-input-border); font-size: 12px; padding: 4px 10px; line-height: 1.6; color: var(--color-text); }
.uline { border: 0; border-bottom: 1px solid var(--color-accent); padding: 0 2px; font-size: 13px; }
.row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.w14 { width: 56px; } .w16 { width: 64px; } .w24 { width: 96px; } .w28 { width: 112px; } .w36 { width: 144px; }
.cap { font-size: 11px; color: var(--color-muted); width: 92px; flex-shrink: 0; }
"""

S = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'

today = "".join([
    var("Number fields", "8 right · 7 left · 1 centred", '<div class="row"><span class="cap">Line item rate</span><div class="fx w28"><span class="v r">120.00</span></div></div><div class="row"><span class="cap">Expense amount</span><div class="fx w28"><span class="v l">980.5</span><span class="spin">▲<br>▼</span></div></div><div class="row"><span class="cap">Client discount</span><div class="sib"><div class="fx w16"><span class="v" style="text-align:center">10</span></div><span class="muted" style="font-size:13px">%</span></div></div><div class="row"><span class="cap">Time entry</span><div class="sib"><div class="fx w14"><span class="v l">1</span></div><span class="muted">h</span><div class="fx w14"><span class="v l">30</span></div><span class="muted">m</span></div></div>'),
    var("Search", "SearchBar vs Resources", f'<div class="row"><span class="cap">SearchBar</span><div class="fx" style="flex:1"><span class="ic">{S}</span><span class="v ph muted" style="padding-left:6px">Search quotes</span><span class="u">✕</span></div></div><div class="row"><span class="cap">Resources</span><div class="fx" style="flex:1"><span class="ic" style="padding-left:10px">{S.replace("12","14")}</span><span class="v muted" style="padding-left:10px">Search</span></div></div>'),
    var("Renames", "3 styles", '<div class="row"><span class="cap">Tasks (inline)</span><span class="uline">Brand guidelines</span></div><div class="row"><span class="cap">Organisations</span><div class="fx" style="flex:1"><span class="v">Studio</span></div></div><div class="row"><span class="cap">Column (FormField)</span><div style="flex:1"><span class="fl">Name</span><div class="fx"><span class="v">Status</span></div></div></div>'),
    var("Textareas", "rows 2 or 3, one auto-grows", '<div class="ta" style="height:44px">Notes on the invoice…</div><div class="xs muted" style="margin:6px 0 10px">Invoice, quote, wizard: 2 rows</div><div class="ta" style="height:62px">Client notes…</div><div class="xs muted" style="margin-top:6px">Client: 3 rows · Project: 3 rows, grows · Dashboard: fills, no resize</div>'),
    var("Tag entry", "3 ways", '<div class="row"><span class="cap">Wiki (raw)</span><span class="muted" style="font-size:12px">add tag…</span></div><div class="row"><span class="cap">Resources row</span><div class="fx w16" style="background:transparent;border-color:transparent"><span class="v muted">tag</span></div></div><div class="row"><span class="cap">Resources form</span><div class="fx" style="flex:1"><span class="v muted">Tags ▾ (datalist)</span></div></div>'),
    var("Add rows", "~10 · gaps 4, 6 or 8px", '<div class="row"><div class="fx" style="flex:1"><span class="v muted">New task…</span></div><span class="b" style="padding:0 7px">+</span></div><div class="row" style="gap:4px"><div class="fx" style="flex:1"><span class="v muted">New item…</span></div><span class="b" style="padding:0 7px">+</span></div>'),
])

def fld(cap, inner, w=""):
    return f'<div class="row"><span class="cap">{cap}</span>{inner}</div>'

proposal = '<div class="panel" style="padding:16px 20px"><div class="g2" style="gap:24px">' + "<div>" + "".join([
    fld("numeric", '<div class="fx w28"><span class="v r">4 800.00</span></div>'),
    fld('unit="CHF"', '<div class="fx w28"><span class="v r">980.50</span><span class="u">CHF</span></div>'),
    fld('unit="%"', '<div class="fx w16"><span class="v r">10</span><span class="u">%</span></div>'),
    fld('unit="h" · "m"', '<div class="sib" style="gap:8px"><div class="fx w16"><span class="v r">1</span><span class="u">h</span></div><div class="fx w16"><span class="v r">30</span><span class="u">m</span></div></div>'),
    fld('icon + onClear', f'<div class="fx" style="flex:1"><span class="ic">{S}</span><span class="v" style="padding-left:6px">art basel</span><span class="u">✕</span></div>'),
]) + "</div><div>" + "".join([
    fld('width="xs"', '<div class="fx w16"><span class="v">64px</span></div>'),
    fld('width="sm"', '<div class="fx w24"><span class="v">96px</span></div>'),
    fld('width="md"', '<div class="fx w36"><span class="v">144px</span></div>'),
    fld('readOnly', '<div class="fx" style="flex:1;background:transparent;border-style:dashed"><span class="v muted">Linked to “Statuses”</span></div>'),
    fld('Textarea', '<div style="flex:1"><div class="ta" style="height:44px">2 rows, grows to fit, then scrolls</div></div>'),
]) + '</div></div></div>'


NOTE = "Paid by bank transfer. Reminder sent on 12.10."
LONG = "<br>".join(["Kick-off on 03.10 with the Art Basel team.", "Key visual: three directions, pick by 15.10.", "Print: posters A0, A1, tram ads.", "Digital: social set, web banners, newsletter header.", "Budget split 60 / 40 print vs digital.", "Next review 22.10."])
VLONG = LONG + "<br>" + LONG
def ta(rows, text, scroll=False, fill=False, resize=True):
    h = f"height:{rows*19+10}px;" if not fill else "height:100%;min-height:96px;"
    ov = "overflow-y:auto;" if scroll else "overflow:hidden;"
    grip = '<span style="position:absolute;right:3px;bottom:1px;font-size:9px;color:var(--color-muted)">◢</span>' if resize else ""
    return f'<div style="position:relative"><div class="ta" style="{h}{ov}">{text}</div>{grip}</div>'
def col(cap, sub, body):
    return f'<div><div style="font-size:12px;font-weight:600">{cap}</div><div class="xs muted" style="margin-bottom:6px">{sub}</div>{body}</div>'
ta_today = '<div class="g2" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">' + "".join([
    col("Invoice · quote · wizard", "2 rows, drag to resize", ta(2, NOTE)),
    col("Client notes", "3 rows, drag to resize", ta(3, NOTE)),
    col("Project notes", "3 rows, grows to fit", ta(6, LONG)),
    col("Dashboard note", "fills the widget, no resize", ta(0, NOTE, fill=True, resize=False)),
]) + "</div>"
ta_new = '<div class="g2" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">' + "".join([
    col("Empty", "3 rows", ta(3, '<span class="muted">Notes</span>', resize=False)),
    col("Short note", "stays 3 rows", ta(3, NOTE, resize=False)),
    col("Longer note", "grows to fit", ta(6, LONG, resize=False)),
    col("Very long note", "stops at 12 rows, then scrolls", ta(12, VLONG + "<br>" + LONG, scroll=True, resize=False)),
    col("Dashboard note", "fill: takes the widget", ta(0, NOTE, fill=True, resize=False)),
]) + "</div>"
TA_SECTION = {"h2": "Textareas: today and proposed", "sub": "Same notes, drawn at their real heights (19px per line).", "body": f'<div class="panel" style="padding:16px 20px"><div class="lbl10" style="margin-bottom:10px">Today</div>{ta_today}<div class="lbl10" style="margin:22px 0 10px">Proposed: 3 rows, grows, then scrolls</div>{ta_new}</div>'}

p = page(
    file="inputs.html", title="StudioManager Inputs", eyebrow="StudioManager · text fields", h1="Input · Textarea",
    intro="Every text field is now the same 26px box, but what goes in and around it is still hand-made: numbers align three ways, units and currencies are loose spans or missing, search is built twice, renames come in three styles, and 13 fixed widths use 5 values. This page measures the 100 fields and proposes the props that would cover them.",
    stats=[("94 · 6", "Inputs · Textareas"), ("16", "number fields, 0 with even digits"), ("~45", "fields with no label at all"), ("30", "times size=\"sm\" is written (it's the default)")],
    sections=[
        {"h2": "Today", "sub": "Drawn with each field's own classes.", "body": f'<div class="panel"><div class="var-grid">{today}</div></div>'},
        {"h2": "What else differs", "body": table([
            ["<b>Numbers</b>", "No number field uses tabular digits. Spinner arrows show everywhere except the workload cells. Money uses step 0.01 in expenses, income and invoices, but not in line items."],
            ["<b>Units</b>", "<code>%</code> and <code>h</code>/<code>m</code> are spans next to the field, at different sizes. No amount field shows its currency."],
            ["<b>Labels</b>", "About 45 fields have neither a FormField nor an aria-label: table cells, add rows, renames, the settings \"keep last N\" field."],
            ["<b>Read-only</b>", "No look for it; the linked-options field fakes one with opacity."],
            ["<b>Detected values</b>", "The receipt-detected highlight uses <code>!important</code>, so it hides the red error border on the same field."],
            ["<b>Inline variant</b>", "The accent underline is always on, it has no focus ring and no error state, and its text size follows the row (task renames can jump in size)."],
            ["<b>Types</b>", "The resource URL field is <code>type=\"text\"</code>."],
            ["<b>Dark mode</b>", "A global <code>.dark input</code> rule in index.css likely paints a background on the transparent bare/inline fields and greys every placeholder the same. To check in the app."],
            ["<b>Raw fields left</b>", "The dropdown search (14px), the wiki title and the wiki tag field."],
        ])},
        TA_SECTION,
        {"h2": "Proposal: props instead of hand-made pieces", "sub": "Input keeps one box; these props cover what is built around it today.", "body": proposal},
        {"h2": "The rules they would enforce", "body": rules("Input", [
            "<b><code>numeric</code></b>: right-aligned, tabular digits, no spinner arrows. Every number field.",
            "<b><code>unit</code></b>: a muted suffix inside the box (CHF, %, h, m).",
            "<b><code>icon</code> + <code>onClear</code></b>: a leading icon and a clear button. SearchBar and the DatePicker are built on them; the Resources copy goes.",
            "<b><code>width</code></b> xs 64 · sm 96 · md 144 for short fields; otherwise full width.",
            "<b><code>readOnly</code></b> has a look (no fill, dashed border, muted text).",
            "<b><code>detected</code></b> state instead of the <code>!important</code> class; an error still wins.",
            "No <code>size=\"sm\"</code> written out; <code>md</code> stays for the large rename/title case only.",
        ], "Around it", [
            "<b><code>InlineRename</code></b>: the 10 renames; Enter saves, Esc cancels, has a label, can show an error, keeps the row's text size.",
            "<b><code>AddRow</code></b>: the ~10 \"field + plus\" rows; Enter adds, one gap.",
            "<b>Textarea</b>: 3 rows by default, grows with its content up to 12 rows, then scrolls; <code>fill</code> for the dashboard note. Notes are 3 rows everywhere.",
            "<b>Every field has a name</b>: FormField, or <code>aria-label</code> from the column header in tables.",
            "<b>Tag entry</b> is one component (wiki and resources).",
        ]) + code('<Input numeric unit="CHF" width="sm" />\n<Input icon={Search} onClear={() => setQ("")} />\n<InlineRename value={name} label={t.rename} onSave={save} />\n<AddRow placeholder={t.new_task} onAdd={add} />\n<Textarea autoGrow />')},
    ],
    decisions=[
        ("numeric and unit props on Input?", "Right-aligned tabular numbers with the unit inside the box, for the 16 number fields; currencies shown next to amounts."),
        ("Textarea: 3 rows, grows, then scrolls?", "One behaviour for every notes field instead of 2 or 3 fixed rows and one auto-grow."),
        ("InlineRename and AddRow building blocks?", "Ten renames in three styles and ten add rows with three gaps become two components."),
        ("Width scale xs / sm / md?", "64, 96, 144px for short fields, instead of w-14, w-16, w-24, w-28 and w-36."),
        ("Keep size=\"md\"?", "Nothing uses it today except the large dropdown trigger. Keep it for title-like renames, or remove it."),
    ],
    extra_css=CSS,
)
print(p)
