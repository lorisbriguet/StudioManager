from dd import page, var, table, rules, code

CSS = """
.ts { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 8px; font-size: 13px; background: #fff; color: #111; border: 1px solid #e5e5e5; box-shadow: 0 4px 12px rgba(0,0,0,.08); margin-bottom: 8px; }
.ts .act { margin-left: auto; font-size: 12px; font-weight: 500; padding: 3px 8px; border-radius: 4px; background: #111; color: #fff; }
.ts.app { background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border-header); border-radius: 12px; box-shadow: var(--shadow-menu, 0 8px 24px rgba(0,0,0,.12)); }
.ts.app .act { background: transparent; color: var(--color-accent); padding: 0; }
.dot { width: 8px; height: 8px; border-radius: 99px; flex-shrink: 0; }
.ok { background: var(--color-success-text); } .err { background: var(--color-danger-text); } .warn { background: var(--color-warning-text); } .inf { background: var(--color-muted); }
.mono { font-family: var(--mono); font-size: 11px; }
"""

today = "".join([
    var("Raw errors", "~90 calls", '<div class="ts"><span class="dot err"></span><span class="mono">Error: SqliteError: UNIQUE constraint failed: clients.name</span></div><div class="xs muted">54 db hooks show <code>String(e)</code></div>'),
    var("Same error twice", "hook + page", '<div class="ts"><span class="dot err"></span><span class="mono">Error: database is locked</span></div><div class="ts"><span class="dot err"></span>Delete failed</div><div class="xs muted">Resources, template editor, invoice and quote forms</div>'),
    var("Button labels as messages", "", '<div class="ts"><span class="dot ok"></span>Save</div><div class="ts"><span class="dot ok"></span>Download PDF</div><div class="ts"><span class="dot ok"></span>Delete: Figma</div>'),
    var("Same delete, two answers", "", '<div class="ts"><span class="dot ok"></span>Project deleted<span class="act">Undo</span></div><div class="xs muted" style="margin-bottom:8px">Projects list</div><div class="ts"><span class="dot ok"></span>Project deleted</div><div class="xs muted">Project detail page: no undo</div>'),
    var("Validation as toasts", "", '<div class="ts"><span class="dot err"></span>Name is required</div><div class="xs muted">New project, template editor, settings backups: the field itself shows nothing</div>'),
    var("Not in the app's colours", "sonner defaults", '<div class="ts" style="background:#fff;color:#111">Invoice saved</div><div class="xs muted">Same white toast in dark mode; corner, font and shadow not the app\'s</div>'),
])

proposal = '<div class="panel" style="padding:16px 20px;max-width:440px">' + "".join([
    '<div class="ts app"><span class="dot ok"></span>Invoice saved</div>',
    '<div class="ts app"><span class="dot ok"></span>Project deleted<span class="act">Undo</span></div>',
    '<div class="ts app"><span class="dot err"></span>Couldn\'t save the client<span class="act">Details</span></div>',
    '<div class="ts app"><span class="dot warn"></span>3 invoices are now overdue<span class="act">Show</span></div>',
    '<div class="ts app"><span class="dot inf"></span>Generating 12 PDFs…</div>',
]) + '</div>'

p = page(
    file="toasts.html", title="StudioManager Toasts", eyebrow="StudioManager · feedback", h1="Toasts",
    intro="There are about 245 toast calls in 61 files, nearly all straight to the library, past the two helpers that exist. About 90 show the raw database error, several errors show two toasts, some messages are just a button label, and the toasts ignore the app's colours and dark mode. This page measures them and proposes one notify API with fixed kinds, durations and wording.",
    stats=[("~245", "toast calls in 61 files"), ("~90", "show the raw error"), ("27 · 22", "use notifyError · undo helpers"), ("0", "follow the app theme")],
    sections=[
        {"h2": "Today", "body": f'<div class="panel"><div class="var-grid">{today}</div></div>'},
        {"h2": "What else differs", "body": table([
            ["<b>Undo</b>", "Deleting a project, task, resource, organisation or list offers Undo in one place and not in another; Resources' bulk delete shows nothing at all. Undo toasts last 5s, warnings 8s, some errors 10s."],
            ["<b>Wording</b>", "\"Created\" vs \"Invoice created\"; \"updated\" vs \"saved\"; \"Failed to…\", \"… failed\", \"Could not…\", \"Something went wrong\"; two keys for \"Status updated\"."],
            ["<b>Translation</b>", "The overdue check is English with a hand-made plural; several messages are glued from pieces (word order breaks in French); many French strings are missing their accents."],
            ["<b>Noise</b>", "A toast on every auto-backup, on every layout save, on starting a timer."],
            ["<b>Progress</b>", "PDF exports juggle loading toasts by hand."],
            ["<b>Copy</b>", "Copying shows a toast in notifications and an inline \"Copied\" in agent access."],
        ])},
        {"h2": "Proposal: one notify API, in the app's look", "body": proposal},
        {"h2": "The rules it would enforce", "body": rules("Kinds", [
            "<b><code>notify.success(msg)</code></b> 4s · <b><code>info</code></b> 4s · <b><code>warning</code></b> 8s · <b><code>error</code></b> 10s.",
            "<b><code>notify.error(label, err)</code></b> shows a translated sentence and logs the raw error (\"Details\" copies it). Never the raw text.",
            "<b><code>notify.undo(label, onUndo)</code></b> 8s, for every delete that can be undone, everywhere.",
            "<b><code>notify.progress(label, promise)</code></b> for exports.",
            "Errors from saving are handled once (the query layer), so there is never a second toast.",
        ], "Wording and look", [
            "<b>Success</b>: \"Invoice saved\", \"Client deleted\": thing + past verb, no \"successfully\", no period.",
            "<b>Error</b>: \"Couldn't save the invoice\".",
            "<b>No button labels</b> as messages; translated templates with placeholders, never glued strings.",
            "<b>Not for</b> validation (FormField shows it), copy (inline \"Copied\"), or background routine (auto-backup).",
            "<b>Look</b>: app surface, border, radius, shadow and font; follows dark mode.",
            "Direct use of the library is blocked by a lint rule.",
        ]) + code('notify.success(t.invoice_saved)\nnotify.undo(t.project_deleted, restore)\nnotify.error(t.couldnt_save_client, err)\nnotify.progress(t.generating_pdfs, exportAll(ids), { success: t.pdfs_exported })')},
    ],
    decisions=[
        ("Never show the raw error, with a Details action to copy it?", "About 90 toasts change; the raw text stays in the log."),
        ("Undo on every reversible delete, 8 seconds?", "Project detail, task sections, resources (incl. bulk), organisations and lists gain Undo."),
        ("No toast for routine background work?", "Auto-backup, layout saves and starting a timer go quiet; errors still show."),
        ("Toasts in the app's look and dark mode?", "Surface, border and shadow tokens instead of the library's white default."),
        ("Lint rule against using the library directly?", "Everything goes through notify, so the rules hold."),
    ],
    extra_css=CSS,
)
print(p)
