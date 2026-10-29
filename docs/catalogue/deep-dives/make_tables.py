import pathlib

HERE = pathlib.Path(__file__).resolve().parent
tmp = HERE / "out"
tmp.mkdir(exist_ok=True)
btn = (HERE / "style-source.html").read_text()
style = btn[btn.index("<style>"):btn.index("</style>")]
style = style.replace("Layout: one spec column (max 960px): findings, live comparison next to fields, proposal options, decisions.",
                      "Layout: one spec column (max 1040px): findings, today's variants, the proposed table at two densities, decisions.")
style = style.replace(".page { max-width: 960px;", ".page { max-width: 1040px;")
extra = """
:root { --color-indigo-bg: #e0e7ff; --color-indigo-text: #4338ca; --color-info-bg: #dbeafe; --color-info-text: #1d4ed8; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --color-indigo-bg: #1a1a2e; --color-indigo-text: #818cf8; --color-info-bg: #0c1a2e; --color-info-text: #38bdf8; } }
:root[data-theme="dark"] { --color-indigo-bg: #1a1a2e; --color-indigo-text: #818cf8; --color-info-bg: #0c1a2e; --color-info-text: #38bdf8; }
.t { width: 100%; border-collapse: collapse; font-size: 14px; }
.t th { height: 32px; padding: 0 16px; font-size: 12px; font-weight: 500; color: var(--color-muted); border-bottom: 1px solid var(--color-border-header); text-align: left; white-space: nowrap; }
.t td { height: 40px; padding: 0 16px; border-bottom: 1px solid var(--color-border-divider); vertical-align: middle; }
.t.compact th, .t.compact td { padding: 0 12px; }
.t.compact td { height: 32px; font-size: 13px; }
.t tr.row:hover td { background: var(--color-hover-row); cursor: pointer; }
.t .num { text-align: right; font-variant-numeric: tabular-nums; }
.t .w8 { width: 32px; padding: 0 8px; }
.t .muted { color: var(--color-muted); }
.t tr.group td { height: 32px; background: transparent; }
.t tr.foot td { border-top: 1px solid var(--color-border-header); border-bottom: 0; font-weight: 500; }
.lbl10 { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: .1em; color: var(--color-muted); }
.pill { display: inline-flex; align-items: center; gap: 4px; border-radius: 99px; font-weight: 500; white-space: nowrap; font-size: 12px; line-height: 16px; padding: 2px 8px; }
.c-success { background: var(--color-success-bg); color: var(--color-success-text); }
.c-warning { background: var(--color-warning-bg); color: var(--color-warning-text); }
.c-danger { background: var(--color-danger-bg); color: var(--color-danger-text); }
.c-indigo { background: var(--color-indigo-bg); color: var(--color-indigo-text); }
.cbx { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--color-input-border); background: var(--color-input-bg); display: inline-block; vertical-align: middle; }
.cbx.on { background: var(--color-accent); border-color: var(--color-accent); }
.cbx.mixed { background: var(--color-accent); border-color: var(--color-accent); position: relative; }
.cbx.mixed::after { content: ""; position: absolute; left: 3px; right: 3px; top: 6px; height: 2px; background: #fff; border-radius: 1px; }
.ib { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 4px; color: var(--color-muted); border: 0; background: transparent; padding: 0; cursor: pointer; }
.ib:hover { background: var(--color-hover-row); color: var(--color-text); }
.reveal { opacity: 0; }
tr.row:hover .reveal, tr.row:focus-within .reveal { opacity: 1; }
.fld { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; font-size: 12px; border-radius: 6px; background: var(--color-input-bg); border: 1px solid var(--color-input-border); }
.var-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0; }
.var { padding: 14px 16px; border-right: 1px solid var(--color-border-header); border-bottom: 1px solid var(--color-border-header); min-width: 0; }
.var h3 { margin: 0 0 8px; font-size: 12px; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
.var h3 span { font-weight: 400; color: var(--color-muted); font-family: var(--mono); font-size: 11px; }
.mini { width: 100%; border-collapse: collapse; font-size: 13px; }
.mini th { font-size: 12px; font-weight: 500; color: var(--color-muted); text-align: left; }
.mini td, .mini th { border-bottom: 1px solid var(--color-border-divider); }
.empty { padding: 28px 16px; text-align: center; color: var(--color-muted); font-size: 13px; }
"""

def svg(path, s=12):
    return f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{path}</svg>'
CHEV_R = '<path d="m9 18 6-6-6-6"/>'
CHEV_D = '<path d="m6 9 6 6 6-6"/>'
MORE = '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'
TRASH = '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'
PENCIL = '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'
SORT = '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>'
DOWN = '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'

def variant(title, meta, header_style, row_style, rows=2, extra_td=""):
    trs = "".join(f'<tr><td style="{row_style}">INV-2026-01{i}</td><td style="{row_style}" class="muted">Art Basel</td><td style="{row_style};text-align:right">CHF 4 800.00</td></tr>' for i in range(rows))
    return f'''<div class="var"><h3>{title}<span>{meta}</span></h3><table class="mini"><thead><tr><th style="{header_style}">Reference</th><th style="{header_style}">Client</th><th style="{header_style};text-align:right">Amount</th></tr></thead><tbody>{trs}</tbody></table></div>'''

variants = "".join([
    variant("Invoices · Quotes · Clients", "th 32 · rows 40", "padding:8px 16px", "padding:10px 16px"),
    variant("Resources", "th 32 · rows 36", "padding:8px 12px", "padding:8px 12px"),
    variant("Recurring · categories", "no side padding · rows 42", "padding:8px 8px 8px 0", "padding:8px 8px 8px 0;height:42px"),
    variant("Named tables", "th 28 · rows 32", "padding:6px 12px", "padding:6px 12px"),
    variant("Time entries", "12px text · filled header · border", "padding:8px 12px;background:var(--color-surface)", "padding:8px 12px;font-size:12px"),
    variant("Line items", "no borders · rows 48", "padding:0 4px 8px;border:0", "padding:4px;height:48px;border:0"),
])

rows_default = ""
data = [("INV-2026-014", "Art Basel", "28.10.2026", "Sent", "c-warning", "4 800.00"),
        ("INV-2026-013", "Fondation Artvis", "21.10.2026", "Paid", "c-success", "12 350.00"),
        ("INV-2026-012", "Atelier Noir", "02.10.2026", "Overdue", "c-danger", "980.50")]
for i, (ref, client, date, st, cls, amt) in enumerate(data):
    sel = "on" if i == 1 else ""
    rows_default += f'''<tr class="row"><td class="w8"><span class="cbx {sel}"></span></td><td><b style="font-weight:500">{ref}</b></td><td>{client}</td><td class="muted">{date}</td><td><span class="pill {cls}">{st}</span></td><td class="num" style="font-weight:500">{amt}</td><td class="w8"><button class="ib reveal" type="button" aria-label="Row actions">{svg(MORE)}</button></td></tr>'''

compact_rows = ""
for d, desc, h in [("28.10.2026", "Art Basel · key visual review", "1:30"), ("27.10.2026", "Studio Manager · dropdown spec", "2:45"), ("27.10.2026", "PlantR · onboarding screens", "0:50")]:
    compact_rows += f'''<tr class="row"><td class="muted" style="font-variant-numeric:tabular-nums">{d}</td><td>{desc}</td><td class="num">{h}</td><td class="w8"><button class="ib reveal" type="button" aria-label="Edit">{svg(PENCIL)}</button></td><td class="w8"><button class="ib reveal" type="button" aria-label="Delete">{svg(TRASH)}</button></td></tr>'''

body = f"""
<div class="page">
  <header class="top">
    <span class="eyebrow">StudioManager · tables and lists</span>
    <h1>Tables</h1>
    <p>There is no Table component. Each of the 12 tables and 8 table-like lists builds its own header, rows, cells, row actions, empty and loading states. This page measures them and proposes one Table with two densities.</p>
    <div class="stats">
      <div class="stat"><b>12 + 8</b><span>tables + table-like lists</span></div>
      <div class="stat"><b>5</b><span>header styles</span></div>
      <div class="stat"><b>8</b><span>row heights (24–48px)</span></div>
      <div class="stat"><b>6</b><span>cell paddings</span></div>
    </div>
    <div class="bar"><div class="seg" role="group" aria-label="Theme"><button type="button" data-th="light" id="th-l">Light</button><button type="button" data-th="dark" id="th-d">Dark</button></div></div>
  </header>

  <section>
    <div class="sec-head"><h2>Today</h2><p class="xs muted">The same three rows drawn with each table's own header and row styles.</p></div>
    <div class="panel"><div class="var-grid">{variants}</div></div>
  </section>

  <section>
    <div class="sec-head"><h2>What else differs</h2></div>
    <div class="panel tw">
      <table>
        <thead><tr><th>Topic</th><th>Today</th></tr></thead>
        <tbody>
          <tr><td><b>Header</b></td><td>SortHeader 32px on 6 tables; Expenses and Income mix in a 14px "Receipt" header (40px); one is UPPERCASE; two use the divider line instead of the header line; the doc says py-2.5, SortHeader uses py-2.</td></tr>
          <tr><td><b>Row actions</b></td><td>The ⋯ menu is in column 2 on Invoices, Quotes, Expenses and in the last column on Income; delete is sometimes always visible, sometimes on hover, sometimes hand-coded; categories use text buttons in a flex cell.</td></tr>
          <tr><td><b>Opening a row</b></td><td>Main lists: keyboard Enter or right-click only (no click). Clients: a link on the name. Resources: pointer cursor but only double-click edits. Projects, notifications: single click.</td></tr>
          <tr><td><b>Numbers</b></td><td>Amounts right-aligned but not tabular (digits don't line up), except time entries. Client discount % is left-aligned.</td></tr>
          <tr><td><b>Empty · loading</b></td><td>EmptyState on 8 pages, a plain line of text elsewhere; Resources hides the header when empty. Loading: TableSkeleton, a custom skeleton, a line of text or a page spinner.</td></tr>
          <tr><td><b>Totals</b></td><td>Workload has a real totals row; line items and time entries draw totals outside the table; invoice totals live in the year rows.</td></tr>
          <tr><td><b>Container</b></td><td>The doc says no border; time entries has a bordered, rounded container with a filled header.</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <div class="sec-head"><h2>Proposal: one Table, two densities</h2><p class="xs muted">Rows have a fixed height, so a row with a 26px field, Select or pill is as tall as a text row.</p></div>
    <div class="panel">
      <div style="padding:14px 16px 6px"><b style="font-size:13px">Default · 40px rows</b> <span class="xs muted">lists: invoices, quotes, expenses, income, clients, resources, tasks</span></div>
      <div class="tw">
        <table class="t">
          <thead><tr><th class="w8"><span class="cbx mixed"></span></th><th>Reference {svg(SORT,10)}</th><th>Client</th><th>Date {svg(DOWN,10)}</th><th>Status</th><th class="num">Amount</th><th class="w8"></th></tr></thead>
          <tbody>
            <tr class="group"><td colspan="7"><div style="display:flex;align-items:center;gap:8px">{svg(CHEV_D)}<span class="lbl10">2026</span><span class="xs muted">3 invoices</span><span class="xs" style="margin-left:auto;font-variant-numeric:tabular-nums;font-weight:500">CHF 18 130.50</span></div></td></tr>
            {rows_default}
            <tr class="group"><td colspan="7"><div style="display:flex;align-items:center;gap:8px">{svg(CHEV_R)}<span class="lbl10">2025</span><span class="xs muted">24 invoices</span><span class="xs" style="margin-left:auto;font-variant-numeric:tabular-nums;font-weight:500">CHF 96 400.00</span></div></td></tr>
          </tbody>
        </table>
      </div>
      <div style="padding:18px 16px 6px;border-top:1px solid var(--color-border-header)"><b style="font-size:13px">Compact · 32px rows</b> <span class="xs muted">settings lists, time entries, named tables, workload, line items</span></div>
      <div class="tw">
        <table class="t compact">
          <thead><tr><th>Date</th><th>Description</th><th class="num">Hours</th><th class="w8"></th><th class="w8"></th></tr></thead>
          <tbody>
            {compact_rows}
            <tr class="row"><td><span class="fld">27.10.2026</span></td><td><span class="fld" style="width:100%">Editing a row inline</span></td><td class="num"><span class="fld" style="justify-content:flex-end;width:56px">1:15</span></td><td class="w8"></td><td class="w8"></td></tr>
            <tr class="foot"><td colspan="2">Total</td><td class="num">6:20</td><td class="w8"></td><td class="w8"></td></tr>
          </tbody>
        </table>
      </div>
      <div style="padding:18px 16px 6px;border-top:1px solid var(--color-border-header)"><b style="font-size:13px">Empty</b> <span class="xs muted">the header stays, the empty state sits in the body</span></div>
      <table class="t"><thead><tr><th>Reference</th><th>Client</th><th class="num">Amount</th></tr></thead><tbody><tr><td colspan="3" style="height:auto"><div class="empty">No quotes yet<br><span class="xs">Create one from a client or a project.</span></div></td></tr></tbody></table>
    </div>
  </section>

  <section>
    <div class="sec-head"><h2>The rules it would enforce</h2></div>
    <div class="opts">
      <div class="opt"><h3>Shape</h3><ul>
        <li><b>Header:</b> 32px, 12px muted medium text, lowercase, header line under it. Sortable or not, same look (SortHeader inside).</li>
        <li><b>Rows:</b> 40px default or 32px compact, fixed; divider line; hover tint.</li>
        <li><b>Cells:</b> 16px sides (12px compact). <code>numeric</code> = right-aligned, tabular digits.</li>
        <li><b>No container border</b>, horizontal scroll built in.</li>
      </ul></div>
      <div class="opt"><h3>Behaviour</h3><ul>
        <li><b>Selection:</b> checkbox column + select-all with "some selected", shift-click range, BulkActionBar.</li>
        <li><b>Group rows:</b> collapsible, SectionLabel + count + total on the right.</li>
        <li><b>Row actions:</b> always in the last column, IconButton xs, shown on row hover and keyboard focus.</li>
        <li><b>Empty</b> keeps the header; <b>loading</b> is TableSkeleton at the same density.</li>
        <li><b>Totals</b> are a footer row inside the table.</li>
      </ul></div>
    </div>
    <div class="panel" style="padding:12px 16px"><code style="background:none;padding:0;font-size:12px;line-height:1.7;display:block;white-space:pre-wrap">&lt;Table density="default" | "compact" selection={{bulk}} empty={{&lt;EmptyState … /&gt;}} loading={{isLoading}}&gt;
  &lt;Table.Head&gt; &lt;Table.Th sort="date"&gt;Date&lt;/Table.Th&gt; &lt;Table.Th numeric&gt;Amount&lt;/Table.Th&gt; &lt;/Table.Head&gt;
  &lt;Table.Group label="2026" count={{3}} total="CHF 18 130.50" /&gt;
  &lt;Table.Row onOpen={{open}} actions={{&lt;IconButton … /&gt;}}&gt; &lt;Table.Td&gt;…&lt;/Table.Td&gt; &lt;Table.Td numeric&gt;…&lt;/Table.Td&gt; &lt;/Table.Row&gt;
  &lt;Table.Foot&gt;…totals…&lt;/Table.Foot&gt;
&lt;/Table&gt;</code></div>
    <p class="xs muted">Stays as its own layout: the projects card grid, notifications (multi-line), dashboard widget lists and the P&amp;L lines — they are lists, not tables.</p>
  </section>

  <section>
    <div class="sec-head"><h2>To decide</h2></div>
    <div class="panel dec">
      <div><span class="n">1</span><div><b>Two densities (40 and 32px), or one?</b><p>Two keeps editing grids and settings lists tight; one (40px) is simplest but makes time entries and named tables much taller.</p></div></div>
      <div><span class="n">2</span><div><b>Single click opens a row?</b><p>Today the main lists only open with Enter or the right-click menu. Proposal: a click anywhere on the row opens it (pointer cursor), checkboxes and row buttons excepted.</p></div></div>
      <div><span class="n">3</span><div><b>Row actions: on hover, or always visible?</b><p>Proposal: last column, shown on hover and keyboard focus. Always visible is easier to discover but busier.</p></div></div>
      <div><span class="n">4</span><div><b>Line items in the Table too?</b><p>The invoice/quote line editor is a grid of fields with drag-to-reorder. It can use Table compact, or stay its own editor.</p></div></div>
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
out = "<title>StudioManager Tables</title>\n<meta name=\"claude:viewport-fit-sides\" content=\"cover\">\n" + style + extra + "</style>\n" + body
(tmp / "tables.html").write_text(out)
print("ok")
