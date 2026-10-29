import pathlib

HERE = pathlib.Path(__file__).resolve().parent
tmp = HERE / "out"
tmp.mkdir(exist_ok=True)
btn = (HERE / "style-source.html").read_text()
style = btn[btn.index("<style>"):btn.index("</style>")]
style = style.replace(".page { max-width: 960px;", ".page { max-width: 1040px;")
extra = """
.fl { display: block; font-size: 12px; color: var(--color-muted); margin-bottom: 4px; }
.fl.med { font-weight: 500; }
.fl.mini { font-size: 10px; margin-bottom: 2px; }
.fl.up { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: .1em; }
.req { color: var(--color-accent); margin-left: 2px; }
.f { display: flex; align-items: center; height: 26px; padding: 0 10px; font-size: 12px; border-radius: 6px; background: var(--color-input-bg); border: 1px solid var(--color-input-border); color: var(--color-text); white-space: nowrap; overflow: hidden; }
.f.tall { height: 32px; }
.f.ph { color: var(--color-muted); }
.f.err { border-color: var(--color-danger-text); }
.f .chev { margin-left: auto; opacity: .5; }
.hint { font-size: 12px; color: var(--color-muted); margin-top: 4px; }
.errt { font-size: 12px; color: var(--color-danger-text); margin-top: 4px; }
.g { display: grid; gap: 12px; }
.g2 { grid-template-columns: 1fr 1fr; }
.g3 { grid-template-columns: 1fr 1fr 1fr; }
.g4 { grid-template-columns: repeat(4, 1fr); }
.gap2 { gap: 8px; } .gap4 { gap: 16px; }
.span2 { grid-column: span 2; } .spanall { grid-column: 1 / -1; }
.acts { display: flex; gap: 8px; margin-top: 16px; }
.acts.end { justify-content: flex-end; }
.b { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--color-input-border); background: var(--color-input-bg); color: var(--color-text); font-weight: 500; white-space: nowrap; }
.b.p { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
.b.d { background: transparent; border-color: var(--color-danger-text); color: var(--color-danger-text); }
.b.raw { border: 0; background: none; padding: 0 2px; color: var(--color-accent); font-weight: 400; }
.b.raw.m { color: var(--color-muted); }
.ml { margin-right: auto; }
.var-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
.var { padding: 14px 16px 16px; border-right: 1px solid var(--color-border-header); border-bottom: 1px solid var(--color-border-header); min-width: 0; }
.var h3 { margin: 0 0 10px; font-size: 12px; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
.var h3 span { font-weight: 400; color: var(--color-muted); font-family: var(--mono); font-size: 11px; }
.lbl10 { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: .1em; color: var(--color-muted); }
.sec + .sec { margin-top: 24px; }
.sec .lbl10 { display: block; margin-bottom: 12px; }
.cbr { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.cbx { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--color-input-border); background: var(--color-input-bg); display: inline-block; }
.cbx.on { background: var(--color-accent); border-color: var(--color-accent); }
.demo { padding: 20px; max-width: 640px; }
@media (max-width: 640px) { .g2, .g3, .g4 { grid-template-columns: 1fr; } .span2 { grid-column: auto; } }
"""

def fld(label, value, cls="", lcls="", req=False, ph=False, chev=False, extra=""):
    v = f'<span>{value}</span>' + ('<span class="chev">▾</span>' if chev else "")
    return f'<div><span class="fl {lcls}">{label}{"<span class=req>*</span>" if req else ""}</span><div class="f {cls} {"ph" if ph else ""}">{v}</div>{extra}</div>'

def var(title, meta, body):
    return f'<div class="var"><h3>{title}<span>{meta}</span></h3>{body}</div>'

today = "".join([
    var("Invoice form", "gap 12 · actions right",
        f'<div class="g g2">{fld("Client","Art Basel",req=True,chev=True)}{fld("Date","28.10.2026",req=True)}</div>'
        '<div class="acts end"><span class="b d ml">Delete</span><span class="b">Cancel</span><span class="b p">Create</span></div>'),
    var("Quote form", "py-2 on some fields · actions left",
        f'<div class="g g2">{fld("Client","Art Basel",cls="tall",req=True,chev=True)}{fld("Date","28.10.2026",req=True)}</div>'
        '<div class="acts"><span class="b">Cancel</span><span class="b p">Create</span></div>'),
    var("New client card", "Save before Cancel",
        f'<div class="g g2">{fld("Name","Fondation Artvis")}{fld("Email","hello@artvis.ch")}</div>'
        '<div class="acts"><span class="b p">Save</span><span class="b">Cancel</span></div>'),
    var("New project card", "no labels · toast errors",
        f'<div class="g g2"><div class="f ph">Project name *</div><div class="f ph">Client ▾</div><div class="f ph">dd.mm.yyyy</div><div class="f ph">dd.mm.yyyy</div></div>'
        '<div class="acts"><span class="b p">Save</span><span class="b">Cancel</span></div>'),
    var("Client contacts", "10px labels · text links",
        f'<div class="g g3 gap2">{fld("First name","Marc",lcls="mini")}{fld("Last name","Spiegler",lcls="mini")}{fld("Role","Director",lcls="mini")}</div>'
        '<div class="acts end"><span class="b raw m">Cancel</span><span class="b raw">Save</span></div>'),
    var("Profile", "gap 16 · max 512px · button alone",
        f'<div class="g g2 gap4">{fld("Company","Loris Briguet")}{fld("VAT number","CHE-123.456.789")}</div>'
        '<div class="acts" style="margin-top:24px"><span class="b p">Save</span></div>'),
    var("Template editor", "bold labels",
        f'<div class="g">{fld("Template name","Default",lcls="med")}{fld("Accent colour","#2F6FEB",lcls="med")}</div>'),
    var("Quick timer", "uppercase labels",
        f'<div class="g">{fld("Project","Studio Manager",lcls="up",chev=True)}{fld("Description","Dropdown spec",lcls="up")}</div>'
        '<div class="acts"><span class="b p" style="flex:1;justify-content:center">Start</span></div>'),
    var("Resources card", "4 columns · hand-made buttons",
        f'<div class="g g4 gap2">{fld("Name","Figma")}{fld("Type","Tool",chev=True)}{fld("Link","figma.com")}{fld("Price","15")}</div>'
        '<div class="acts"><span class="b p" style="border-radius:6px">Save</span><span class="b raw m">Cancel</span></div>'),
])

proposal = f'''
<div class="demo">
  <div class="sec">
    <span class="lbl10">Client</span>
    <div class="g g2">
      {fld("Client", "Art Basel", req=True, chev=True)}
      {fld("Project", "Key visual 2027", chev=True)}
      {fld("Billing address", "Messeplatz 10, 4058 Basel", extra="", cls="")[:-6]}<div class="hint">Taken from the client; change it for this invoice only.</div></div>
      {fld("PO number", "PO-", cls="err", extra='<div class="errt">Use the client\'s PO format (PO-0000).</div>')}
    </div>
  </div>
  <div class="sec">
    <span class="lbl10">Dates and currency</span>
    <div class="g g3">
      {fld("Date", "28.10.2026", req=True)}
      {fld("Due", "27.11.2026")}
      {fld("Currency", "CHF", chev=True)}
    </div>
    <div class="cbr" style="margin-top:12px"><span class="cbx on"></span>Use one rate for all lines</div>
  </div>
  <div class="acts end" style="margin-top:24px"><span class="b d ml">Delete</span><span class="b">Cancel</span><span class="b">Save and preview</span><span class="b p">Create invoice</span></div>
</div>'''

body = f"""
<div class="page">
  <header class="top">
    <span class="eyebrow">StudioManager · forms</span>
    <h1>Forms</h1>
    <p>Every field is now one 26px control, but the forms around them are still each laid out by hand: label styles, gaps, column counts and where the buttons go change from form to form. This page measures the 36 forms and proposes one way to build them.</p>
    <div class="stats">
      <div class="stat"><b>36</b><span>forms (pages, cards, modals, popovers)</span></div>
      <div class="stat"><b>9</b><span>label styles</span></div>
      <div class="stat"><b>48 · 31</b><span>FormField labels · hand-written labels</span></div>
      <div class="stat"><b>10</b><span>action-row layouts</span></div>
    </div>
    <div class="bar"><div class="seg" role="group" aria-label="Theme"><button type="button" data-th="light">Light</button><button type="button" data-th="dark">Dark</button></div></div>
  </header>

  <section>
    <div class="sec-head"><h2>Today</h2><p class="xs muted">Two fields and the buttons from each form, drawn with its own label, gap and action styles.</p></div>
    <div class="panel"><div class="var-grid">{today}</div></div>
  </section>

  <section>
    <div class="sec-head"><h2>What else differs</h2></div>
    <div class="panel tw"><table>
      <thead><tr><th>Topic</th><th>Today</th></tr></thead>
      <tbody>
        <tr><td><b>Labels</b></td><td>FormField (12px muted) on 48 fields. 31 hand-written labels: 8 bold, 3 at 10px (client contacts and addresses, column editor), 2 uppercase (quick timer), 5 copies of FormField's look. None of them is linked to its field, so a click on the label doesn't focus it.</td></tr>
        <tr><td><b>No labels</b></td><td>About 10 forms show placeholders only. New project has two date fields with no label at all, and reports errors as toasts.</td></tr>
        <tr><td><b>Field heights</b></td><td>11 fields have a <code>py-2</code> bump (32px instead of 26px), only some fields in a row: Quote has it, Invoice doesn't; in Expenses the date doesn't.</td></tr>
        <tr><td><b>Gaps</b></td><td>12px in 8 grids, 16px in Profile, 8px in client contacts and addresses. Vertical spacing between blocks: 8, 12, 16, 20 or 32px.</td></tr>
        <tr><td><b>Buttons</b></td><td>Right-aligned on Invoice, left on Quote. Save·Cancel on Clients, Projects, Resources; Cancel·Save on Expenses and Income. Text links on client contacts; hand-made buttons on Resources. Cancel is secondary in 10 places, outline in 5.</td></tr>
        <tr><td><b>Help and errors</b></td><td>FormField has no help text. Errors: FormField's red line, a 10px version, a toast, or nothing.</td></tr>
        <tr><td><b>Checkboxes</b></td><td>10 checkboxes are wrapped in a hand-written label (6 different class strings) instead of using Checkbox's own <code>label</code>.</td></tr>
        <tr><td><b>Width</b></td><td>Invoice and Quote cap at 768px, Profile at 512px inside 672px, inline create cards are full page width.</td></tr>
      </tbody>
    </table></div>
  </section>

  <section>
    <div class="sec-head"><h2>Proposal: FormField, FormGrid, FormSection, FormActions</h2><p class="xs muted">The invoice form header rebuilt with them: sections, a 2- and a 3-column grid, a hint, an error, a checkbox, and the action row.</p></div>
    <div class="panel">{proposal}</div>
  </section>

  <section>
    <div class="sec-head"><h2>The rules they would enforce</h2></div>
    <div class="opts">
      <div class="opt"><h3>Fields</h3><ul>
        <li><b>Label above,</b> 12px muted, linked to the field (a click focuses it). One label style everywhere.</li>
        <li><b>Required</b> = accent <code>*</code>; <b>hint</b> and <b>error</b> under the field, 12px, the error announced.</li>
        <li><b>One field height</b> (26px); the <code>py-2</code> bumps go.</li>
        <li><b>Checkboxes and toggles</b> use their own <code>label</code>.</li>
      </ul></div>
      <div class="opt"><h3>Layout</h3><ul>
        <li><b>FormGrid</b> <code>cols={{1|2|3|4}}</code>, 12px gaps both ways; a field can <code>span</code> 2 or the full row. One column on narrow windows.</li>
        <li><b>FormSection</b>: SectionLabel, 12px to its fields, 24px between sections.</li>
        <li><b>FormActions</b>: 24px above. Destructive on the far left, then Cancel (secondary), other actions, primary last.</li>
        <li><b>Width</b>: forms cap at 768px.</li>
      </ul></div>
    </div>
    <div class="panel" style="padding:12px 16px"><code style="background:none;padding:0;font-size:12px;line-height:1.7;display:block;white-space:pre-wrap">&lt;FormSection title={{t.client}}&gt;
  &lt;FormGrid cols={{2}}&gt;
    &lt;FormField label={{t.client}} required&gt;&lt;DropdownSelect … /&gt;&lt;/FormField&gt;
    &lt;FormField label={{t.billing_address}} hint={{t.billing_hint}} span={{2}}&gt;&lt;Input … /&gt;&lt;/FormField&gt;
  &lt;/FormGrid&gt;
&lt;/FormSection&gt;
&lt;FormActions destructive={{&lt;Button variant="danger"&gt;…}}&gt;
  &lt;Button variant="secondary"&gt;{{t.cancel}}&lt;/Button&gt; &lt;Button&gt;{{t.create}}&lt;/Button&gt;
&lt;/FormActions&gt;</code></div>
    <p class="xs muted">Not forms in this sense: settings rows (SettingRow, label left and control right), filter bars, inline single-field adds and row editing in tables keep their own layouts.</p>
  </section>

  <section>
    <div class="sec-head"><h2>To decide</h2></div>
    <div class="panel dec">
      <div><span class="n">1</span><div><b>Buttons on the right, primary last?</b><p>The macOS order and what the Modal footer already does. Today Invoice is right-aligned and Quote and the create cards are left-aligned.</p></div></div>
      <div><span class="n">2</span><div><b>Labels: plain or medium weight?</b><p>Plain (FormField today, 48 fields) or medium (8 hand-written labels). Proposal: plain.</p></div></div>
      <div><span class="n">3</span><div><b>One label size, even in client contacts and addresses?</b><p>Their 10px labels go to 12px; the cards get a little taller.</p></div></div>
      <div><span class="n">4</span><div><b>Create forms: keep them inline above the list, or open a Modal?</b><p>Clients, expenses, income, projects and resources open a card above the table today. Inline keeps the list in view; a Modal matches invoices' "make recurring" and focuses the task.</p></div></div>
      <div><span class="n">5</span><div><b>Forms cap at 768px?</b><p>Including the inline create cards, which are full page width today.</p></div></div>
    </div>
  </section>
</div>

<script>
(() => {{
  const root = document.documentElement;
  const paint = () => {{
    const cur = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.querySelectorAll("[data-th]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.th === cur)));
  }};
  document.querySelectorAll("[data-th]").forEach(b => b.addEventListener("click", () => {{ root.setAttribute("data-theme", b.dataset.th); paint(); }}));
  paint();
}})();
</script>
"""
out = "<title>StudioManager Forms</title>\n" + style + extra + "</style>\n" + body
(tmp / "forms.html").write_text(out)
print("ok")
