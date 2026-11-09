# Changelog

What changed in each StudioManager release, newest first. The section of a version is its release description, and its first paragraph is the line the in-app updater shows: write it before tagging ([RELEASING.md, step 5](RELEASING.md#5-changelog--docs)). The Release build workflow refuses a version without a section. Older releases (1.x, 2.x) are described on the [Releases](https://github.com/lorisbriguet/StudioManager/releases) page.

Format of a section:

```markdown
## X.Y.Z (YYYY-MM-DD)

One line for the updater: what this release is about.

### Features
### Fixes
### Under the hood
```

## 3.5.0 (2026-11-09)

Archive clients, foreign-currency expenses, per-document language, safer backups and a new updater key: install this update before the next one.

### Before updating

- **New updater key.** This release carries a new signing key for updates. Install 3.5.0 before the next release: an app still on 3.4.0 or older when the next version comes out can't install it and has to be replaced by hand from the `.dmg` (your data stays where it is).
- **Back up first** (Settings › Backup › Back up now). The first start upgrades every organisation's database; a copy of each file is kept next to it as `studiomanager.db.pre-migration.db` before it changes.
- **Apple silicon only in the updater.** The update manifest no longer lists Intel Macs, which could not run the build anyway.

### Features

- **Archive clients.** A client with issued invoices can't be deleted any more (invoices are kept 10 years): archive it instead, with Undo. Archived clients leave the lists, pickers and palette; Show archived brings them back. Agents don't see them either.
- **Expenses in other currencies.** A EUR or USD receipt keeps its currency and amount and is booked in CHF at the rate of its date; the receipt reader detects the currency.
- **Language per document.** Invoices and quotes get a FR/EN selector, defaulting to the client's language and kept on edit and on conversion.
- **New invoice and New quote from a project.** The project's Invoices and Quotes blocks open a form with client, project, language and discount filled in, also when the form is already open for another project.
- **Calendar:** a New task button, drag across days or a time range to create, Swiss dates and 24-hour times in the app's language.
- **Cmd+N everywhere.** Cmd+N and the palette's New open the right form on every list page; the palette gains New task, quote, income and article.
- **Network page:** a Tailscale card with every device, and the Time Machine backups of every Mac the NAS keeps.
- **VAT warning.** The dashboard warns once invoiced turnover reaches 80 % of CHF 100,000.
- **Each invoice in its own currency.** Dashboard widgets, client and project pages, the palette and the trustee invoice list show an invoice's own currency, with its CHF equivalent under a foreign one, and "Draft" instead of an internal id.
- Draft PDFs are marked "Draft / Brouillon" on the page and named by type, client and date.
- Notifications in the current language, French labels across Dashboard, Clients and Upkeep, units on PDFs in the document language.
- Undo after removing a dashboard widget and after deleting a wiki article; Escape closes the menu bar panel and the side peek; a cancelled invoice shows its original amount struck through.
- Start an agent on a finding from the review report page.

### Fixes

- **Invoice numbers.** Bulk "Mark as sent" gives consecutive numbers; undoing a send no longer frees its number or deletes the document. A draft marked paid or overdue now gets its number too, and a draft can no longer be set to Cancelled (delete it instead).
- **The stored invoice PDF is the one the client received.** It is written when the invoice leaves draft and again only when its lines or total change; marking it paid or sending a reminder leaves it alone, and cancelling saves a separate `_VOID` copy. PDFs from every export path (lists, email, bulk, trustee) use the document's template; the trustee export copies the stored PDF.
- **Trustee invoice list:** totals are in CHF like the P&L and leave out cancelled invoices, which are struck through.
- **Foreign-currency drafts** take the exchange rate of their date until they are sent; recurring drafts take the rate of their own date.
- **A new quote keeps its billing address, template and project link** (they were lost on the first save and on Undo after a delete).
- **QR bill:** pays from the invoice's billing address, names the payer only for a Swiss address (otherwise the "Payable by" box stays blank), and no longer prints a draft's internal id; the PDF discount adds up to the total.
- Rounding: half-centimes round up correctly; line items can't go negative.
- Expense and income numbers take the year of their own date.
- Overdue invoices are marked after midnight while the app stays open, not only at the next launch.
- Deleted starter data (addresses, resources, presets, templates) stays deleted.
- The app starts in the theme you chose, without a flash; light themes are readable on a Mac in Dark Mode.
- **Dashboard:** it can be arranged at the default window size; the layout is saved only at full width and per organisation; layouts squeezed by 3.4.0 are spread back over the 12 columns; new widgets fill the first free spot.
- **Wiki:** a title being typed is no longer reverted by the autosave, Cmd+Q saves text typed in the last seconds, and opening an article no longer saves it.
- **Agent access:** an organisation that isn't ticked in Settings › Agents is closed to agents, and a toggle no longer reopens it. Organisations that worked before stay open; switching agent access on ticks the active organisation.
- Agents: the chat opens at the latest message; one click answers a question; polling slows down when the window is hidden.
- Retry on the startup error screen really reopens the database; a missing data folder is an error instead of a new empty organisation.
- Test and presentation modes no longer touch real files, Apple Calendar or backups.
- The Calendar side peek reopens when you click the same project again; Client Activity refreshes after every invoice or quote change.
- Network's Upkeep card lists the same items as the Upkeep badge.

### Data

- The upgrade adds archived clients, expense currency and notification languages, and moves the tables the app used to add itself into the regular schema. Once a file has been opened by 3.5.0, older versions can't open it; from now on the app refuses a database saved by a newer version instead of damaging it.
- **Backups, rebuilt.** Each backup is a consistent snapshot of every organisation; receipts and invoice PDFs go into one shared `files-<organisation>` folder, copied only when new or changed. Kept: one per day for the last 30 days with a backup, one per month for 12 months, the 5 newest and everything from the last 24 hours ("Keep last N" is gone). The safety backup taken before a restore is kept until you delete it. Auto-backup is daily unless you turned it off. Activities and Paperless links are now in backups. Older backups still restore.
- Restoring an older snapshot upgrades it; a snapshot from a newer version is refused and the live database stays as it was.
- The Paperless token is now bound to its server in the Keychain; the existing token is taken over at the first start.
- Every organisation's database now uses the same journal mode (WAL), so agents and the app no longer block each other.

### Under the hood

- Updater key rotated: this release carries the new update key and is still signed with the old one; the next release after 3.5.0 is the first signed with the new key. Skipping 3.5.0 means reinstalling that release from the `.dmg`.
- Database and file commands run off the main thread; old notifications are purged (200 shown); the app keeps a log in `~/Library/Logs`, startup errors included.
- One schema for the app, the agent tools and `sm` (migrations 014 and 015); the organisations upgrade resumes after a crash.
- Routine links open through Finder only.
- The PDF library loads only when a PDF is made, and exports show their progress.
- The demo build keeps off this Mac: no Apple Calendar, network checks, links, Agents or real Keychain entries.
- Release build on GitHub: audit first, key kept away from the build, signature checked against installed apps, notes from this changelog; CI lints and tests both Rust crates.
- Dependencies: vitest 5, TypeScript 6, react-markdown 10, swissqrbill, sha2, rcgen, vt100, base64, Rust 1.93.1. Not in this release: FullCalendar 7 and TypeScript 7 (deferred).

After updating: in Claude Code, reconnect the StudioManager agent tools (`/mcp` › studiomanager › Reconnect).

## 3.4.0 (2026-11-05)

Start work with agent from a task, subtask, project or calendar event; agents polish.

### Features

- **Start work with agent.** Right-click a task, subtask or project (Tasks page, Projects page, a project's Tasks section) or a task, subtask or deadline on the Calendar. One click starts an agent on Opus in the project's folder and opens it on the Agents page. The agent reads the item and its context, then asks you what to do before changing anything. A project without a folder asks for one and keeps it.
- **Flag a conversation.** Right-click an agent to flag it; flagged agents sit in their own group at the top.
- **Jump to latest.** A conversation opens at its latest message and stays there as new messages arrive; a button brings you back down after scrolling up.
- **Claude sign-in date.** The Agents page shows until when Claude is signed in, warns from 10 days before it ends, and the menu bar notifies you at 10, 3 and 1 day.
- **Paperless count on Expenses.** The sidebar shows how many Paperless documents wait to be checked.
- **New organisations start unticked in Agent access.** Agents only reach a new organisation once you tick it in Settings › Agents. Existing organisations are unchanged.

### Fixes

- Cmd+Q now stops a command routine that is still running.
- The menu bar panel may only call its own commands.

### Under the hood

- Dependency audit cleared (rustls, webpki, zip, pulldown-cmark, minimatch); the updater plugin moved to 2.14.
- Menu bar checks added to the release checklist.

After updating: in Claude Code, reconnect the StudioManager agent tools (`/mcp` › studiomanager › Reconnect).

**Not in this release:** PR #21 (brief renderer path documentation, draft).

## 3.3.1 (2026-11-03)

Agent Upkeep tools are back, and agents can add links to machines for the Network page.

### Fixes

- **Agent Upkeep tools are back.** 3.3.0 shipped without them: AI apps connected through Agent access could read machines but no longer log a service or add and edit machines, upkeep items, consumables and subscriptions. Each of these still asks you first and says what it will save.

### Features

- **Links on machines through Agent access.** A new tool adds a web page or a remote-access link (`vnc://…`) to a machine, so an agent can fill the Network page for you. A machine's details now include its links.

### Under the hood

- The agent tools' tests now list every Upkeep tool, so a release that drops one fails its checks.
- The release checklist checks open pull requests and unmerged branches before a release, and the agent tools after installing.

After updating: in Claude Code, reconnect the StudioManager agent tools (`/mcp` › studiomanager › Reconnect).

**Not in this release:** PR #21 (brief renderer path documentation, draft).

## 3.3.0 (2026-11-03)

Network page, flat Agents and Wiki pages, fixes for undo, calendar and borrowed equipment.

### Features

- **Network page.** An optional page under Agents (Settings › Behaviour › Network page) that shows your studio at a glance: one card per machine with its service links and a status dot, checked from the Mac every 5 minutes while the page is open. A service you can't reach reads "Unreachable", never "down", and nothing notifies.
  - **Remote machines:** online state and one button per remote-desktop link (Screen Sharing `vnc://`), opened safely.
  - **NAS health:** volume usage and drive health from the Synology connection.
  - **Backups:** this Mac's Time Machine (running, last backup, warning after 2 days, danger after 7), the NAS's newest snapshot, and upkeep items you mark "Counts as a backup".
  - Works in an organisation that uses another's equipment: it shows the owner's machines and last readings.
- **Calmer Agents and Wiki pages.** Both get a normal page header with their main button, and a flat layout like Invoices: lists as grouped rows, no boxes. The Wiki's open-article tabs and bottom bar are gone; back and forward (Cmd+[ / ]) and the graph view stay.
- **Upkeep and Network styling.** Upkeep's Machines, Consumables and Subscriptions tabs get headings with counts; the Network page uses the dashboard's cards.
- **"In calendar" is a dropdown** on upkeep items and renewals, ready for more calendars later.
- **Unsent task titles are kept.** A task or subtask you started typing is still there when you come back; Escape clears it.
- **Redo** now works after undoing a task's or subtask's status change.

### Fixes

- **Undo stays in its organisation.** Switching organisation clears the undo history, so Cmd+Z can no longer change a row in the other organisation.
- **Undo and the calendar.** Undoing a new task waits for its calendar event and removes it; redoing a deleted task brings back the same task with its subtasks.
- **Upkeep events no longer get lost** when you switch organisation while one moves in Apple Calendar.
- **Borrowed equipment.** An organisation that uses another's equipment now reads the owner's readings and drive health, saves typed-in readings and upkeep notices in the owner's database, shows the owner's connections read-only, and no longer runs syncs with its own connections.
- **Links typed without https://** (`nas.local:5001`) open correctly in Upkeep.
- **Time Machine** is read without Full Disk Access.

### Data

This release adds a database change (version 10, the "Counts as a backup" mark on upkeep items). It is applied automatically on first launch. If you ran the development build, your databases are already at version 10 and the agent tools refuse them ("This database is newer than the agent tools") until 3.3.0 is installed. As always, Backup Now before updating is a good idea.

## 3.2.0 (2026-11-01)

Paperless invoice inbox, Local Network permission for the NAS, morning brief comments again, Agents chat fixes.

### Features

- **Paperless invoice inbox.** Supplier invoices that reached your Paperless-ngx (by email, for example) and aren't expenses yet show up in an inbox. Each one becomes an expense in one confirmation: supplier, date, amount and category pre-filled, the PDF attached as the receipt. Dismiss what isn't an expense. Connect Paperless in Upkeep › Connections.
- **Copy code in one click.** Code blocks in an agent's reply have a copy button in their corner.
- **Agent names are always valid.** In the new agent form and the routine form, a space becomes "-" and characters a name can't hold are refused as you type.

### Fixes

- **NAS connection on macOS 15 and later.** StudioManager now declares that it uses the local network, so macOS asks once and then lets the connection to the NAS through instead of blocking it silently.
- **Morning brief comments work again.** Since AgentBar was retired, the brief couldn't reach anyone: comments stayed in the browser and the button said "Keep". StudioManager now receives them itself (on this Mac only, protected by a token) and sends each one to that day's morning agent; the button says "Send" again. Needs Agents switched on. The brief page itself needs the matching agent-bar update.
- **Agents chat: only your messages look like yours.** Skill instructions, background task notices, command output and the summary written after a compaction no longer appear as messages from you. A slash command you typed reads as typed ("/model opus").
- **Agents chat: no more stuck greyed-out copies.** A message sent with images no longer stays greyed out ("Sent, not read yet") next to the copy the agent received.
- **Tooltips** no longer flash in the top left corner of the window before moving into place (the same fix the menus got in 3.1.0).
- **Amounts** always use the Swiss apostrophe (1’234.50), whatever the system's number formatting.

### Data

This release adds a database change (version 9, for the Paperless inbox). It is applied automatically on first launch. Your databases are already at version 9 if you ran the development build; until 3.2.0 is installed, the agent tools refuse them ("This database is newer than the agent tools"). As always, Backup Now before updating is a good idea.

## 3.1.0 (2026-10-29)

Shared equipment between organisations, new agents in any folder, wiki dashboard widgets, agents and menu bar polish.

### Features

- **Shared equipment between organisations.** An organisation can use another one's machines, upkeep and consumables instead of keeping its own (Settings › Upkeep › Equipment). Project links and calendar events stay with the organisation that owns them.
- **Wiki dashboard widgets.** Recently edited articles, and an article overview (articles edited this week, projects with articles).
- **New agent in any folder.** The folder list now also offers your home folder, linked project folders and the folders that hold them (such as your GitHub folder), plus **Choose…** for any other. A folder Claude Code doesn't trust yet asks before trusting it, which is the same as answering Yes to Claude's own trust question. Trust covers the folders inside it.
- **Agents: pending messages.** A message you send shows greyed out ("Sent, not read yet") until it reaches the agent's transcript.

### Fixes

- Agents: the working dots stop once the agent's reply has settled, whatever the status says.
- Agents: the conversation keeps your reading position when the window slides.
- Terminal: fits the panel exactly, so Claude's footer line (sub-agent count) is no longer cut off; expand and shrink buttons.
- Menu bar: one notification badge, rounded panel corners, no scroll pull-down.
- Popovers and menus open in place and only fade, never slide in from the window corner.

### Other

- Component catalogue generator scripts are now kept in the repo ([docs/catalogue](docs/catalogue/README.md)).

No data layout change: no backup needed before updating.

## 3.0.0 (2026-10-29)

StudioManager 3.0: run your Claude agents from a page and the menu bar, studio upkeep with NAS and printer connections, the whole interface on one component library, and the fixes of the 2026-10-29 full check. Take a Backup Now before updating.

StudioManager 3.0 gives the app a second role: it runs your Claude agents, from a page and from the Mac menu bar. It also takes care of the studio's hardware, and the whole interface was rebuilt on one component library.

**Before updating:** this release adds tables for studio upkeep and agents. The upgrade is automatic; take a **Backup Now** in Settings first, as for every major version.

### Features

- **Agents page** (off by default, needs the `claude` CLI): every Claude Code agent on your Mac by needs you / working / idle / done, labelled by project. Start one on a project folder, read its conversation, answer its prompts with a click, send messages and images, switch the model, stop or delete it; a terminal attached to the agent when you want the real thing. A Mac notification when an agent has been waiting for you for a few seconds, at most once every three minutes per agent. [Docs](docs/agents.md)
- **Menu bar**: StudioManager's icon in the menu bar opens a panel with your agents, your Claude plan limits with alerts, and a Day tab of routines you run by hand or on a schedule (a command or an agent, once a day, caught up after sleep). The panel never steals focus and shows on every Space, full-screen apps included; it keeps running when the window is closed. [Docs](docs/menu-bar.md)
- **Studio upkeep**: machines and equipment with their upkeep items (every N days, weeks, months, years, or print hours), what is overdue or due soon on the Upkeep page, in the calendar and in notifications; service log with costs, consumables with reorder alerts, subscriptions with renewals you confirm into expenses (converted to CHF at today's rate), warranties, lending. Optional read-only connections to a Synology NAS (disk health) and the Bambu Lab cloud (print hours), secrets in the macOS Keychain.
- **One component library**: every form, table, menu, dialog, input and badge in the app is a shared component now, with colour tokens by role, one icon map, three modal widths, a DatePicker you can type in, undo on every reversible delete, and consistent toasts and empty, loading and error states. The design system is documented in [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md).
- **Agent access** (MCP): 27 tools, `list_machines` added; the settings are described as what they are, a consent switch; the server resolves wiki file links before taking the write lock, caps text at 1 MB, keeps its log safe across two AI apps, and only accepts folders inside Documents, Desktop, Downloads and CloudStorage. See [Agent access](docs/agent-access.md).

### Fixes

From the full check of 2026-10-29 (eight review passes, [report](docs/audits/2026-10-29-full-check.md)):

- An invalid date typed in a form no longer submits it with the previous date; one submit per Enter, even held down; a dirty form no longer closes on a stray click.
- Undo after deleting an invoice template, a wiki article, a project table or a workload template restores the row with its id, children and links.
- Settings lists (calendar, backups) load when the menu opens; a second failed save is never silent; Esc discards a column rename instead of saving it.
- Accessibility and French: the page language follows the UI language, complete tab pattern with arrow keys, live regions for agent replies and prompts, plurals, money and percent formats, translated column types.
- Security: links in agent replies open in the browser and the app's webview can no longer navigate away from the app; messages to agents are sent as a paste so `!` and `/` never run a command; a command routine runs only once allowed in a native dialog, and a failed routine's output never reaches the lock screen or disk; the NAS password is bound to its host and certificate; "Open folder" never launches an application bundle.
- Upkeep: a past renewal date no longer asks once per missed period; non-CHF amounts are converted or refused with a reason; port and certificate checks on reconnect.
- Menus and date pickers no longer flash in the top-left corner before appearing.
- Dependencies: npm audit at zero (vite, vitest, happy-dom patched).

### Known follow-ups

Per-window command gating for the menu bar panel (same origin today) and verification of the MCP sidecar path are tracked in [IDEAS.md](IDEAS.md).
