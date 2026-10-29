from dd import page, var, table, rules, code

today = "".join([
    var("Native dialog", "27 calls · 20 say Yes / No", '<div class="native"><b>StudioManager</b><p style="margin:6px 0 12px">Delete selected items?</p><div style="text-align:right"><span class="nb">No</span><span class="nb def">Yes</span></div></div>'),
    var("In place · ConfirmButton", "2 uses", '<div style="display:flex;gap:8px;align-items:center;font-size:12px"><span>Delete this project and all its tasks?</span><span class="b d">Delete</span><span class="b">Cancel</span></div>'),
    var("Hand-made in place", "invoice form", '<div style="display:flex;gap:8px;align-items:center;font-size:12px"><span style="color:var(--color-danger-text)">Delete INV-2026-014?</span><span class="b d">Delete</span><span class="b">Cancel</span></div><div class="xs muted" style="margin-top:6px">no Esc, no click-outside</div>'),
    var("Type the name", "delete organisation", '<p style="margin:0 0 8px;font-size:12px">Type the organisation name to confirm.</p><div class="f ph">Studio</div><div class="acts" style="margin-top:10px"><span class="b">Cancel</span><span class="b d">Delete</span></div>'),
    var("Undo instead of asking", "10 deletes", '<div class="ts" style="display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--color-border-header);border-radius:10px;font-size:12px;background:var(--color-surface)">Expense deleted<span style="margin-left:auto;color:var(--color-accent);font-weight:500">Undo</span></div>'),
    var("Nothing at all", "~13 actions", '<div style="font-size:12px">Clear all notifications · delete invoice template · delete workload template · delete named-table row or column · delete saved filter · remove activity</div>'),
])

p = page(
    file="confirms.html", title="StudioManager Confirmations", eyebrow="StudioManager · destructive actions", h1="Confirmations",
    intro="The same delete is confirmed one way from a list, another from its detail page and a third in bulk; 27 questions use the native system dialog, which says Yes / No and ignores the app's look; and about 13 destructive actions neither ask nor offer Undo. This page sorts every one and proposes a rule: undo what can be undone, ask in place for one visible record, and use the app's own dialog for the rest.",
    stats=[("27", "native system dialogs"), ("20", "say Yes / No instead of the verb"), ("10", "deletes that offer Undo instead"), ("~13", "destructive actions with neither")],
    sections=[
        {"h2": "Today", "body": f'<div class="panel"><div class="var-grid">{today}</div></div>'},
        {"h2": "Same action, different answers", "body": table([
            ["<b>Delete client</b>", "List menu: system dialog + Undo. Detail page: in place + Undo. Bulk: system dialog, no toast."],
            ["<b>Delete project</b>", "List menu: Undo, no question. Detail page: in place, toast without Undo. Bulk: system dialog."],
            ["<b>Delete invoice</b>", "List menu: Undo. Invoice form: hand-made in-place question, toast without Undo. Bulk: system dialog."],
            ["<b>Delete task</b>", "Tasks page: Undo. Project's task section: plain toast."],
            ["<b>Draft export</b>", "List pages: system dialog with 2 choices. Preview pages: app dialog with 3 choices. Same sentence."],
            ["<b>Exit test / presentation mode</b>", "The same question written twice (banner and settings)."],
            ["<b>Delete column</b>", "Workload: undoable, no question. Named table: neither."],
            ["<b>Wording</b>", "\"Delete X?\", \"…Are you sure?\", \"…Continue?\", and the wiki's glued \"Delete?\" with no subject."],
        ], head=("Action", "Today"))},
        {"h2": "The rule", "body": rules("Which one", [
            "<b>Can be undone</b> → no question; do it and show <b>Undo</b> (8s). Clients, contacts, addresses, projects, tasks, invoices, quotes, expenses, income, resources, wiki articles, tables, templates, categories, workload rows and columns.",
            "<b>One record, on a visible button</b>, that can't be undone → <b>ConfirmButton</b> in place (detail headers, form footers, row trash).",
            "<b>Many records, or the whole organisation or database</b> → <b>ConfirmDialog</b>: bulk delete, restore backup or snapshot, demo data, exit test or presentation mode, delete organisation (type the name), reset guide.",
            "<b>Choices, not danger</b> (draft export, unsaved changes, past date) → ConfirmDialog with the choices as buttons.",
        ], "How it looks", [
            "<b>The question names the thing</b>: \"Delete INV-2026-014?\", \"Delete 3 expenses?\". One translated sentence, never glued.",
            "<b>The button says the verb</b> (Delete, Restore, Leave), danger-styled for destructive ones. Never Yes / No or OK.",
            "<b>Focus</b> starts on Cancel in dialogs.",
            "<b>Bulk deletes</b> give one toast with one Undo for all.",
            "<b>No native dialogs</b> for the app's own questions; the app's dialog is themed and testable.",
        ]) + code('const confirm = useConfirm()\nif (await confirm({ title: t.delete_n_expenses(3), message: t.cant_undo, confirmLabel: t.delete, tone: "danger" })) …\n\ndeleteWithUndo(deleteExpense, id, t.expense_deleted)\n<ConfirmButton question={t.delete_named(ref)} onConfirm={remove}>{t.delete}</ConfirmButton>')},
    ],
    decisions=[
        ("Undo instead of a question for everything that can be undone?", "Client and project deletes cascade; they are undoable, but you may still want a question there."),
        ("One app ConfirmDialog replacing all 27 system dialogs?", "Themed, the verb on the button, Cancel focused, and testable; including unsaved changes."),
        ("Add Undo (or a question) to the ~13 that have neither?", "Clear all notifications, invoice and workload templates, named-table rows and columns, saved filters, presets, activities."),
        ("Bulk delete: one toast with one Undo?", "Today it asks and then shows nothing; Undo exists only one item at a time through Cmd+Z."),
    ],
)
print(p)
