from dd import page, var, table, rules, code

CSS = """
.es { display: flex; flex-direction: column; align-items: center; text-align: center; color: var(--color-muted); }
.es .ic { opacity: .4; margin-bottom: 8px; }
.sk { height: 10px; border-radius: 4px; background: var(--color-border-header); margin: 8px 0; }
.cardbox { background: var(--color-surface); border-radius: 12px; padding: 16px; }
"""
ICON = lambda s=32: f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16v16H4z"/><path d="M4 9h16"/></svg>'

today = "".join([
    var("List pages", "EmptyState · 12 of 14 with icon", f'<div class="es" style="padding:20px 0">{ICON()}<div style="font-size:13px">No quotes yet</div><span class="b p" style="margin-top:10px">+ New quote</span></div>'),
    var("Widgets and blocks", "6 text styles", '<div class="cardbox"><div style="font-size:14px;font-weight:500;margin-bottom:8px">Overdue</div><div class="xs muted">No data</div></div><div class="xs muted" style="margin-top:8px">text-xs · text-sm · centred · left · with or without padding</div>'),
    var("Loading", "skeleton · spinner · text · nothing", '<div class="sk" style="width:90%"></div><div class="sk" style="width:70%"></div><div class="xs muted" style="margin:8px 0">Lists: table skeleton (even for the projects card grid)</div><div class="xs muted">Detail pages and peeks: a centred spinner · Notifications: "Loading..." · Dashboard and project blocks: nothing, so "No data" flashes</div>'),
    var("Load errors", "not handled", '<div class="es" style="padding:16px 0">{}<div style="font-size:13px">No clients yet</div><span class="b p" style="margin-top:10px">+ New client</span></div><div class="xs muted">What a failed load shows today: the empty state, with a create button</div>'.format(ICON())),
    var("Not found", "plain text", '<div class="muted" style="font-size:13px">No projects</div><div class="xs muted" style="margin-top:6px">A missing project shows \"No projects\"</div>'),
    var("Popover lists", "4 styles", '<div class="xs muted" style="text-align:center;padding:8px">No results found.</div><div class="muted" style="font-size:13px;text-align:center;padding:12px">No results found.</div><div class="xs muted" style="margin-top:6px">dropdown · command palette · wiki link · wiki explorer shows nothing</div>'),
])

proposal = f'''<div class="panel"><div class="stage" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">
<div><div class="xs muted" style="margin-bottom:6px">EmptyState · page (lg)</div><div class="cardbox es" style="padding:28px 16px">{ICON()}<div style="font-size:13px;color:var(--color-text)">No quotes yet</div><div class="xs">Create one from a client or a project.</div><span class="b p" style="margin-top:10px">+ New quote</span></div></div>
<div><div class="xs muted" style="margin-bottom:6px">EmptyState · no results</div><div class="cardbox es" style="padding:28px 16px">{ICON()}<div style="font-size:13px;color:var(--color-text)">No quotes match</div><span class="b" style="margin-top:10px">Clear filters</span></div></div>
<div><div class="xs muted" style="margin-bottom:6px">EmptyState · sm (widgets, blocks, popovers)</div><div class="cardbox"><div style="font-size:14px;font-weight:600;margin-bottom:8px">Overdue</div><div class="es" style="padding:8px 0">{ICON(20)}<div class="xs">Nothing overdue</div></div></div></div>
<div><div class="xs muted" style="margin-bottom:6px">Load error</div><div class="cardbox"><div style="display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:8px;background:var(--color-danger-bg);color:var(--color-danger-text);font-size:12px">Couldn't load the quotes<span class="b" style="margin-left:auto">Retry</span></div></div></div>
<div><div class="xs muted" style="margin-bottom:6px">Loading · matches the shape</div><div class="cardbox"><div class="sk" style="width:40%"></div><div class="sk"></div><div class="sk" style="width:80%"></div></div></div>
</div></div>'''

p = page(
    file="states.html", title="StudioManager Empty States", eyebrow="StudioManager · empty, loading, error", h1="Empty, loading and error states",
    intro="Lists have a proper empty state; most other surfaces show a line of grey text in one of six styles. Many show nothing while loading, so \"No data\" flashes before the data arrives. Failed loads aren't handled at all: a list that can't load says \"No clients yet\" and offers to create one. This page measures every surface and proposes one QueryState wrapper and two EmptyState sizes.",
    stats=[("14", "EmptyState uses"), ("~40", "hand-written empty lines, 6 styles"), ("~20", "surfaces with no loading state"), ("1", "place that handles a failed load")],
    sections=[
        {"h2": "Today", "body": f'<div class="panel"><div class="var-grid">{today}</div></div>'},
        {"h2": "What else differs", "body": table([
            ["<b>Skeleton shape</b>", "Projects (a card grid) and Tasks (grouped list) load with a table skeleton."],
            ["<b>Create action</b>", "Seven list pages offer \"New …\" when empty; Tasks doesn't; the wiki offers it only when articles already exist."],
            ["<b>No results</b>", "Eight pages tell \"nothing yet\" from \"no match\", but none offers to clear the filters."],
            ["<b>Wording</b>", "\"No invoices yet\" vs \"No projects\"; generic \"No data\" on 8 widgets; \"No results found.\" with a full stop."],
            ["<b>Crashes</b>", "One error boundary around everything, so a crash in one widget replaces the whole app, sidebar included."],
            ["<b>Buttons</b>", "Some settings buttons swap their label to \"Loading...\" instead of showing the button spinner."],
        ])},
        {"h2": "Proposal: QueryState and two EmptyState sizes", "body": proposal},
        {"h2": "The rules they would enforce", "body": rules("States", [
            "<b><code>QueryState</code></b> wraps every data surface: <b>loading</b> (its skeleton), <b>error</b> (a danger Callout with Retry), <b>empty</b>, <b>no results</b> (with Clear filters), then the content. Empty text never shows while loading.",
            "<b>Skeletons match the shape</b>: TableSkeleton, ListSkeleton, CardGridSkeleton, DetailSkeleton (detail pages and peeks, instead of the spinner).",
            "<b>Not found</b> is its own state with a way back.",
        ], "EmptyState", [
            "<b><code>size=\"lg\"</code></b> for pages: 32px icon, message, optional hint, create action.",
            "<b><code>size=\"sm\"</code></b> for widgets, project and client blocks, side panels and popovers: 20px icon, 12px text.",
            "<b>Every entity list offers \"New …\"</b> when empty, wiki and tasks included.",
            "<b>Wording</b>: \"No quotes yet\" when empty, \"No quotes match\" for filters; specific, never \"No data\".",
            "<b>Crashes</b> are caught per page and per widget; the shell stays.",
        ]) + code('<QueryState query={quotes} skeleton={<TableSkeleton columns={7} />}\n  empty={<EmptyState icon={FileText} message={t.no_quotes_yet} action={…} />}\n  noResults={{ message: t.no_quotes_match, onClear: clearFilters }}>\n  {(data) => <Table>…</Table>}\n</QueryState>')},
    ],
    decisions=[
        ("A QueryState wrapper on every data surface?", "Adds a real error state with Retry and stops empty text flashing while loading."),
        ("EmptyState in two sizes, sm for widgets and blocks?", "Replaces the ~40 hand-written grey lines in six styles."),
        ("Skeletons that match the shape, including detail pages and peeks?", "Detail pages and peek panels stop showing a centred spinner."),
        ("Clear filters on every \"no results\" state?", "Eight list pages."),
        ("Error boundaries per page and per widget?", "A crash in one widget no longer takes down the whole window."),
    ],
    extra_css=CSS,
)
print(p)
