"""Shared generator for deep-dive pages (same look as button/tables/forms)."""
import pathlib, html

HERE = pathlib.Path(__file__).resolve().parent
TMP = HERE / "out"
TMP.mkdir(exist_ok=True)
_btn = (HERE / "style-source.html").read_text()
STYLE = _btn[_btn.index("<style>"):_btn.index("</style>")].replace(".page { max-width: 960px;", ".page { max-width: 1040px;")

EXTRA = """
.var-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.var { padding: 14px 16px 16px; border-right: 1px solid var(--color-border-header); border-bottom: 1px solid var(--color-border-header); min-width: 0; }
.var h3 { margin: 0 0 10px; font-size: 12px; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
.var h3 span { font-weight: 400; color: var(--color-muted); font-family: var(--mono); font-size: 11px; }
.f { display: flex; align-items: center; height: 26px; padding: 0 10px; font-size: 12px; border-radius: 6px; background: var(--color-input-bg); border: 1px solid var(--color-input-border); color: var(--color-text); white-space: nowrap; overflow: hidden; }
.f.ph { color: var(--color-muted); }
.fl { display: block; font-size: 12px; color: var(--color-muted); margin-bottom: 4px; }
.b { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--color-input-border); background: var(--color-input-bg); color: var(--color-text); font-weight: 500; white-space: nowrap; }
.b.p { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
.b.d { background: transparent; border-color: var(--color-danger-text); color: var(--color-danger-text); }
.b.o { background: transparent; }
.acts { display: flex; gap: 8px; justify-content: flex-end; }
.ml { margin-right: auto; }
.dlg { background: var(--color-surface); border: 1px solid var(--color-border-header); border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.18); overflow: hidden; }
.dlg .hd { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid var(--color-border-divider); font-size: 14px; font-weight: 600; }
.dlg .bd { padding: 20px; font-size: 13px; }
.dlg .ft { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 20px; border-top: 1px solid var(--color-border-divider); }
.native { background: #ececec; color: #222; border-radius: 10px; padding: 18px; font: 13px -apple-system, system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.native .nb { display: inline-block; padding: 3px 14px; border-radius: 6px; background: #fff; border: 1px solid #ccc; margin-left: 6px; }
.native .nb.def { background: #2f6feb; color: #fff; border-color: #2f6feb; }
.stage { padding: 20px; background: var(--color-bg); display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.lbl10 { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: .1em; color: var(--color-muted); }
.ruler { position: relative; height: 22px; margin: 4px 0 10px; }
@media (max-width: 640px) { .g2 { grid-template-columns: 1fr; } }
"""

THEME_JS = """
<script>
(() => {
  const root = document.documentElement;
  const paint = () => {
    const cur = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.querySelectorAll("[data-th]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.th === cur)));
  };
  document.querySelectorAll("[data-th]").forEach(b => b.addEventListener("click", () => { root.setAttribute("data-theme", b.dataset.th); paint(); }));
  paint();
})();
</script>
"""


def var(title, meta, body):
    return f'<div class="var"><h3>{title}<span>{meta}</span></h3>{body}</div>'


def page(*, file, title, eyebrow, h1, intro, stats, sections, decisions, extra_css=""):
    stats_html = "".join(f'<div class="stat"><b>{b}</b><span>{s}</span></div>' for b, s in stats)
    secs = ""
    for sec in sections:
        sub = f'<p class="xs muted">{sec["sub"]}</p>' if sec.get("sub") else ""
        secs += f'<section><div class="sec-head"><h2>{sec["h2"]}</h2>{sub}</div>{sec["body"]}</section>\n'
    dec = "".join(f'<div><span class="n">{i}</span><div><b>{q}</b><p>{p}</p></div></div>' for i, (q, p) in enumerate(decisions, 1))
    body = f"""
<div class="page">
  <header class="top">
    <span class="eyebrow">{eyebrow}</span>
    <h1>{h1}</h1>
    <p>{intro}</p>
    <div class="stats">{stats_html}</div>
    <div class="bar"><div class="seg" role="group" aria-label="Theme"><button type="button" data-th="light">Light</button><button type="button" data-th="dark">Dark</button></div></div>
  </header>
{secs}
  <section><div class="sec-head"><h2>To decide</h2></div><div class="panel dec">{dec}</div></section>
</div>
{THEME_JS}"""
    out = f"<title>{title}</title>\n" + STYLE + EXTRA + extra_css + "</style>\n" + body
    (TMP / file).write_text(out)
    return TMP / file


def table(rows, head=("Topic", "Today")):
    th = "".join(f"<th>{h}</th>" for h in head)
    tr = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<div class="panel tw"><table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div>'


def rules(left_title, left, right_title, right):
    li = lambda xs: "".join(f"<li>{x}</li>" for x in xs)
    return f'<div class="opts"><div class="opt"><h3>{left_title}</h3><ul>{li(left)}</ul></div><div class="opt"><h3>{right_title}</h3><ul>{li(right)}</ul></div></div>'


def code(txt):
    return f'<div class="panel" style="padding:12px 16px"><code style="background:none;padding:0;font-size:12px;line-height:1.7;display:block;white-space:pre-wrap">{html.escape(txt)}</code></div>'
