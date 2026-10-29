"""Mark a deep-dive page as decided and built: python3 mark_built.py <file.html> "<note>" """
import pathlib, sys
p = pathlib.Path(__file__).resolve().parent / "out" / sys.argv[1]
note = sys.argv[2]
s = p.read_text()
s = s.replace("<h2>To decide</h2>", "<h2>Decided · built in PR #2</h2>", 1)
banner = f'<div class="panel" style="padding:12px 16px;border-color:var(--color-success-text)"><b style="color:var(--color-success-text)">Built.</b> <span class="xs">{note}</span></div>'
marker = '<div class="bar">'
if "Built.</b>" not in s and marker in s:
    s = s.replace(marker, banner + "\n    " + marker, 1)
p.write_text(s)
print("ok", p.name)
