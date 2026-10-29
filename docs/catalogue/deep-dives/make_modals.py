from dd import page, var, table, rules, code

def dlg(w, title, body, foot, note=""):
    hd = f'<div class="hd">{title}<span class="muted" style="font-weight:400">✕</span></div>' if title else ""
    ft = f'<div class="ft">{foot}</div>' if foot else ""
    return f'<div style="width:{w}px;max-width:100%"><div class="xs muted" style="margin-bottom:6px">{note}</div><div class="dlg">{hd}<div class="bd">{body}</div>{ft}</div></div>'

field = lambda l, v: f'<div><span class="fl">{l}</span><div class="f">{v}</div></div>'

today = "".join([
    var("Create client · FormModal lg", "512px · 9 fields", f'<div class="g2">{field("Name","Fondation Artvis")}{field("Email","hello@artvis.ch")}</div><div class="acts" style="margin-top:12px"><span class="b">Cancel</span><span class="b p">Save</span></div>'),
    var("Create resource · FormModal md", "448px · 4 fields", f'<div class="g2">{field("Name","Figma")}{field("Type","Tool ▾")}</div><div class="acts" style="margin-top:12px"><span class="b">Cancel</span><span class="b p">Save</span></div>'),
    var("New organisation · Modal sm", "384px · Enter by hand", f'{field("Name","Studio")}<div class="acts" style="margin-top:12px"><span class="b">Cancel</span><span class="b p">Create</span></div>'),
    var("Draft export · Modal sm, no title", "Cancel is outline", '<p style="margin:0 0 12px;font-size:12px">This invoice is a draft. Mark it as sent before exporting?</p><div class="acts"><span class="b o">Cancel</span><span class="b">Export as draft</span><span class="b p">Mark sent &amp; export</span></div>'),
    var("Same warning · native ask()", "from the list pages", '<div class="native"><b>StudioManager</b><p style="margin:6px 0 12px">This invoice is a draft. Export anyway?</p><div style="text-align:right"><span class="nb">Cancel</span><span class="nb def">OK</span></div></div>'),
    var("Delete org · Modal sm", "type the name", f'<p style="margin:0 0 8px;font-size:12px">Type <b>Studio</b> to delete it.</p><div class="f ph">Studio</div><div class="acts" style="margin-top:12px"><span class="b">Cancel</span><span class="b d">Delete</span></div>'),
])

proposal = '<div class="panel"><div class="stage">' + "".join([
    dlg(400, "Delete invoice?", '<p style="margin:0">INV-2026-014 and its PDF will be deleted. This can\'t be undone.</p>', '<span class="b">Cancel</span><span class="b d">Delete</span>', "sm · 400px — confirm, prompt, 1–3 fields"),
    dlg(560, "New client", f'<div class="g2">{field("Name *","Fondation Artvis")}{field("Email","hello@artvis.ch")}{field("Phone","+41 61 000 00 00")}{field("Language","Français ▾")}</div>', '<span class="b">Cancel</span><span class="b p">Create client</span>', "md · 560px — forms, wizard, palette, editors"),
]) + '<div style="width:100%"><div class="xs muted" style="margin-bottom:6px">full · 80% × 85% — viewers (receipts, PDFs). The body scrolls in every size; header and footer stay.</div></div></div></div>'

p = page(
    file="modals.html", title="StudioManager Modals", eyebrow="StudioManager · dialogs", h1="Modals",
    intro="Dialogs come in four sizes but are picked by habit: create forms are 384, 448 or 512px wide, the same draft warning is an app dialog on one page and a system dialog on another, and 29 confirmations use the native system dialog, which ignores the app's look. Confirmations get their own deep dive; this page is about the dialog itself.",
    stats=[("17", "app dialogs"), ("29", "native ask() dialogs"), ("4 · 2", "sizes used · sizes never used"), ("0", "dialogs whose body scrolls")],
    sections=[
        {"h2": "Today", "sub": "Six of the 17 dialogs, at their real width class.", "body": f'<div class="panel"><div class="var-grid">{today}</div></div>'},
        {"h2": "What else differs", "body": table([
            ["<b>Sizes</b>", "sm ×8, md ×2, lg ×6, full ×1. xl and 2xl are never used. Create forms are lg, except Resources (md) and new organisation (sm)."],
            ["<b>Tall dialogs</b>", "No size except full has a max height or a scrolling body, so the 9-field client form and the column editor can run off a short window."],
            ["<b>Forms not on FormModal</b>", "New organisation, template name, paid date and make-recurring are plain Modals; Enter is wired by hand or not at all. The column editor places its Delete by hand."],
            ["<b>Focus</b>", "Expense, income and make-recurring don't focus their first field; the draft warnings focus nothing."],
            ["<b>Titles</b>", "The two draft warnings have no title and no accessible name. Quick timer draws its own header."],
            ["<b>Body padding</b>", "20px with a title, 24px without."],
            ["<b>Busy state</b>", "New client disables Save while saving but shows no spinner; Resources shows one."],
        ])},
        {"h2": "Proposal: three widths by purpose", "body": proposal},
        {"h2": "The rules it would enforce", "body": rules("Shape", [
            "<b>sm (400px)</b>: confirmations, prompts, forms of 1–3 fields in one column.",
            "<b>md (560px)</b>: record forms in two columns, the wizard, the column editor, the command palette and quick timer.",
            "<b>full</b>: viewers. <code>xl</code>, <code>2xl</code> and the old <code>lg</code> go.",
            "<b>Height</b>: at most 85% of the window; the body scrolls, header and footer stay.",
            "<b>Padding</b>: 20px always.",
        ], "Behaviour", [
            "<b>Every dialog with fields is a FormModal</b>: Enter submits, Cancel · primary in the footer, Delete in its left slot.",
            "<b>The first field gets focus</b>; a dialog without fields focuses its safe button.",
            "<b>Every dialog has a title</b> (or an aria-label for the palettes).",
            "<b>Busy</b>: the primary shows its spinner (<code>submitting</code>).",
            "<b>No native dialogs</b> for the app's own questions (see Confirmations).",
        ]) + code('<Modal size="sm" | "md" | "full" title=…>\n<FormModal size="sm" | "md" title=… submitLabel=… onSubmit=… destructive={…}>')},
    ],
    decisions=[
        ("Three widths: sm 400, md 560, full?", "md is wider than today's lg (512) so two date fields sit side by side comfortably. The alternative keeps lg at 512."),
        ("Scrolling body with an 85% height cap?", "Header and footer stay visible; only the fields scroll."),
        ("The four small forms onto FormModal sm?", "New organisation, template name, paid date, make recurring: Enter submits, focus goes to the field."),
        ("One draft-export warning, in the app?", "The 3-choice dialog from the preview pages replaces the 4 native 2-choice ones on the list pages."),
    ],
)
print(p)
