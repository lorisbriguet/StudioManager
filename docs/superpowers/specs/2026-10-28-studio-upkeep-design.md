# Studio upkeep — design

Date: 2026-10-28 · Status: implemented (see [the plan](../plans/2026-10-28-studio-upkeep.md))

Plan: [2026-10-28-studio-upkeep.md](../plans/2026-10-28-studio-upkeep.md)

Mockups (4 screens, dark theme): https://claude.ai/artifact/3WGEaXkpVcZNfkFDy41avo. Built on
[DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md). Idea backlog: [IDEAS.md](../../../IDEAS.md).

Decisions marked *[call]* were made by the designer from the conversation and the code; Loris can overturn any.
Everything else was said by Loris.

## 1. Why

Loris keeps forgetting the upkeep on his NAS drives and his 3D printer. Nothing tells him a backup restore test
is three months overdue or that the printer passed the hours where the rods need cleaning, so it only gets
done when something breaks.

The fix is a place in StudioManager that knows the studio's machines, what each one needs and when, and
**puts the reminder where he already looks: Apple Calendar and the dashboard.** A tab nobody opens fixes
nothing.

StudioManager is a product for any freelance creative ([README](../../../README.md)), not Loris's tool. Every
part of this is designed for a user who has never heard of Synology or Bambu Lab, and works fully by hand.

**Success:** a user adds a machine from a template in under a minute; its upkeep shows up in Apple Calendar
with an alert and on the dashboard; checking it off logs it and moves the next date. For Loris specifically:
drive health and printer hours fill themselves in, and he stops being surprised by them.

## 2. Goals

- An **Upkeep** page (sidebar, under Resources) with four tabs: Overview, Machines, Consumables,
  Subscriptions. A machine detail opens in the peek panel and as a full page.
- **Machines:** any kind of equipment, with status, location, purchase and warranty, replacement planning,
  files and links, linked projects, a service log.
- **Upkeep items** per machine, by time ("every 3 months") or by use ("every 200 print hours"), each with an
  "In calendar" switch.
- **Consumables:** stock, reorder level, supplier and product link, price, use logged against projects.
- **Subscriptions & licences:** renewal date, period, cost, yearly total.
- **Reminders that don't get missed:** Apple Calendar events with alerts, an "Upkeep" dashboard widget, a
  sidebar badge, one in-app notification per event worth knowing.
- **Connections** (optional, off by default): Synology DSM (drive health and age) and Bambu Lab cloud (print
  hours). Built so more brands can be added without touching the rest.
- **Templates** that suggest a starter set of upkeep items for common kinds of machine.
- Same rules as the rest of the app: EN + FR, per organisation, in backups, demo data, test mode, agent
  (MCP) read access.

## 3. Non-goals

- Ordering anything. "Reorder" opens the supplier link in the browser; no carts, no prices fetched.
- Controlling devices. Connections only read; no starting prints, no DSM settings, no firmware installs.
- Two-way calendar sync. Like tasks today, the app writes to Apple Calendar and never reads back; ticking an
  event in Calendar does nothing.
- Platforms other than macOS (the app is macOS-only).
- More than the two connections in v1, and agent write access to upkeep (read-only in v1) *[call]*.

## 4. Anti-goals (a failure even if it works)

- **A reminder gets missed.** If the app is closed for a week, the reminder must still fire. That is why
  reminders live in Apple Calendar alerts, which fire without the app.
- **Notification spam.** One notification per thing worth knowing, never one a day for the same overdue
  item. The rules are in §7.
- **Credentials leak.** A NAS or Bambu password or token never touches the database, a backup, an export, a
  log or the MCP server.
- **The app talks to the internet behind the user's back.** No network call unless the user set up that
  connection. That's the README's promise ("keeps all your data local, no cloud dependency").
- **Built around Loris's studio.** No hard-coded Synology or Bambu assumptions outside their connection
  code and templates.

## 5. What the user sees

The mockups show the layout; the rules below win where they differ.

**Overview tab.** "Due soon" (overdue first, then the next 14 days *[call]*) with mark-done and snooze;
low-stock card; warranty & renewals card (ending within 60 days *[call]*); "Replacements coming" card
(machines whose replace-around year is this year or next, with the sum of their purchase prices as a rough
budget) *[call]*; machine cards.

**Machines tab.** Table: name, kind, location, status, next upkeep. Click → peek panel; Maximize2 → full page.
Machine detail holds:

- Header: name, kind and location line, status (Working, Needs attention, Broken, Lent out, Retired; "Lent
  out" asks to whom and until when).
- Facts: bought (date, supplier), price (links to an existing expense or creates one prefilled), serial,
  warranty end, replace-around year (from purchase date + lifespan in years, editable), linked projects,
  photo.
- Upkeep schedule: items with next date, "In calendar" toggle, add / edit / archive.
- Readings from a connection, when there is one (§8): disks for a NAS, print hours for a printer, last sync
  time and any error.
- Files & links: attach a file (copied into the org's data folder, like receipts) or a URL; label each.
- Service log: date, what was done, cost (optional link to an expense), reading at the time (e.g. 412 h).
  Entries come from mark-done or are added by hand.

**Consumables tab.** Table sorted by stock left: item, for (machine, optional), stock bar and amount, reorder
level, supplier, price, "Reorder" (opens the product link). A banner when anything is below its reorder level.
"Log usage" records an amount, optionally against a project. "Restock" adds to stock and offers to create an
expense prefilled with supplier and price.

**Subscriptions tab.** Name, plan, renews on, period (monthly or yearly), cost, status (active, cancelled),
"In calendar" toggle, yearly total in the org's currency. Cancelled ones stay listed, greyed, and never remind.

When an active subscription's renewal date passes, the app moves `renews_on` forward one period on its own
(and moves its Calendar event), then **asks before touching Expenses** (Loris's choice): "Creative Cloud
renewed · add CHF 840 to expenses?" with Add (opens a new expense prefilled with vendor, amount, date and
category; the user saves it) and Skip. The question shows once as a notification and stays on the
Subscriptions tab and the dashboard widget until answered. Nothing is written to Expenses without that
click. If the app was closed across several renewals, it asks once per missed renewal.

**Calendar page** (in-app). Upkeep and renewals show next to tasks and deadlines, each with its own colour and
a filter chip, as in the mockup.

**Dashboard.** One new widget, "Upkeep": overdue and due within 14 days, low stock, renewals within 14 days,
with mark-done inline *[call: one widget with sections, not three]*. In the default layout for new users.

**Project page.** A small "Equipment & materials" block: linked machines and consumable usage with its cost
for that project *[call]*.

**Settings.** An "Upkeep" card: default alert ("on the day at 9:00", "1 day before", "1 week before", "none"),
the warning windows above, and a "Connections" list (add, test, sync now, remove).

**Sidebar.** "Upkeep" with a red count of overdue items (none when zero), Wrench icon.

## 6. Data

New tables in a numbered migration (`src-tauri/migrations/007_upkeep.sql`, registered in `migrate.rs`),
per organisation like everything else. Names are a guide; the builder may adjust.

- `machines`: name, kind, maker, model, serial, location, status, lent_to, lent_until, purchase_date,
  supplier, price, currency, expense_id (nullable), warranty_until, lifespan_years, photo_path, notes,
  template_key, connection_id (nullable), device_id (the device's serial inside that connection),
  reading_baseline (value typed in from the device's own counter when linked), timestamps. Several machines
  can share one connection (a Bambu account with three printers) *[call]*.
- `machine_files`: machine_id, label, kind (file or link), path_or_url.
- `machine_projects`: machine_id, project_id.
- `upkeep_items`: machine_id, title, notes, schedule (`interval` or `usage`), interval_n, interval_unit
  (day, week, month, year), usage_metric (`print_hours` in v1), usage_every, last_done_on,
  last_done_reading, next_due_on (stored, recomputed on change), snooze_until, in_calendar, alert,
  calendar_event_id,
  overdue_notified_for (the due date already notified), archived.
- `service_log`: machine_id, upkeep_item_id (nullable), done_on, description, cost, expense_id (nullable),
  reading.
- `consumables`: name, machine_id (nullable), unit, stock, reorder_level, supplier, product_url, unit_price,
  currency, low_notified.
- `consumable_usage`: consumable_id, project_id (nullable), used_on, amount, cost (amount × unit price at the
  time).
- `subscriptions`: name, plan, vendor, url, renews_on, period, cost, currency, status, in_calendar, alert,
  calendar_event_id, notes.
- `subscription_renewals`: subscription_id, renewed_on, amount, decision (`pending`, `added`, `skipped`),
  expense_id (nullable). One row per renewal that happened; pending rows are the open questions.
- `connections`: kind (`synology`, `bambu_cloud`), label, host or region, account name (not secret),
  last_sync_at, last_ok_at, last_error, failing_since. Secrets live in the macOS Keychain keyed by
  connection id, never here.
- `machine_readings`: machine_id, metric, value, read_at. Keeps history for the usage forecast.
- `machine_disks`: machine_id, slot, model, serial, size_bytes, power_on_hours, health (`healthy`,
  `warning`, `failing`), bad_sectors, temperature, first_seen, last_read_at.

**Consumable usage is a material cost, not an expense** *[call]*. The expense happened when the consumable
was bought (restock). Logging use against a project shows it as material cost on that project; creating
expense rows again would count the money twice.

Add every new table to backup/restore (`src/lib/backup.ts`); the v1.10 rule is "all tables covered".

## 7. Reminders and notifications

**When is it due?**

- *Interval items:* next due = last done (or the start date chosen at creation) advanced by the interval.
  Reuse `advanceDate` from `src/utils/recurringDates.ts`, which already handles month ends.
- *Usage items:* left = usage_every − (current reading − reading when last done). The predicted date is
  today + left ÷ average daily use over the last 30 days of readings. With no readings or no use, no date;
  the item shows "18 h left" instead. Without a connection the user types the reading in.
- *Mark done:* writes a service-log entry (with the current reading for usage items), sets last done, and
  recomputes the next date. Done early or late, the next date counts from when it was actually done.
- *Snooze:* sets `snooze_until` (1, 3 or 7 days) without a log entry. The item counts as due on
  `snooze_until` until that date passes or it's done, whatever a sync forecasts in between *[call]*. Snoozing
  resets `overdue_notified_for`.
- *Machine status* *[call]*: Retired stops every item of that machine and removes their Calendar events
  (un-retiring brings them back). Working, Needs attention, Broken and Lent out keep reminding: upkeep is
  still owed, and silence is the worse failure.

The interval helper: `advanceDate` in `src/utils/recurringDates.ts` only steps whole months today. Extend it
(or wrap it) for days, weeks and N units, keeping its month-end handling.

**Apple Calendar.** One all-day event per item for its **next** due date, with an alert, in the calendar
chosen in Settings. Mark done or snooze moves it. *[call: one event for the next date, not an Apple repeating
event. A repeating event can't follow "done late, so the next one is later" or a usage forecast, and
leaves stale future events behind.]* The event title says what and on which machine ("Clean nozzle · Prusa
MK4"). Renewals work the same way (default alert one week before *[call]*).

- This needs **alerts on calendar events**, which the app can't do today: `apple.rs` only sets summary,
  dates and description. Add an alert (trigger offset in minutes) to the create-event script and command.
- Usage items' predicted dates move as printing goes on. Move the event only when the date shifts by
  2 days or more *[call]*, so Calendar isn't rewritten on every sync.
- If calendar sync is off in Settings, nothing goes to Calendar; the dashboard and notifications still work.
- Removing an item, turning "In calendar" off, or deleting a machine removes its events.

**In-app notifications.** Into the existing Notifications page, at most one per cause:

| Cause | When | Fires again when |
|---|---|---|
| Upkeep item overdue | the day after its due date | it's done or snoozed and becomes overdue again |
| Consumable low | stock drops below its reorder level | it was restocked above the level, then drops again |
| Drive health worse | a disk goes healthy → warning, or → failing | it gets worse again |
| Warranty ending | inside the warning window | never for the same date |
| Renewal coming | inside the warning window | the next renewal |
| Renewal happened: add to expenses? | the renewal date passed | the next renewal |
| Connection failing | it has failed for 3 days in a row *[call]* | after it worked again and then failed for 3 days |

No daily repeats, no digest. The sidebar badge and the dashboard widget carry the ongoing "still overdue".

## 8. Connections

Optional, off until the user adds one in Settings › Upkeep › Connections, then links a machine to it.
The network code runs in Rust (`src-tauri/src/connectors/`, one file per kind behind a common trait: test,
sync → readings). The frontend only calls Tauri commands (`connection_test`, `connection_sync`). Adding a
brand later means one new file plus its form.

**Sync:** on app start, then every 6 hours while the app is open, plus "Sync now" *[call]*. A failed sync
keeps the last good data and shows the error and its time on the machine. No network in test or
presentation mode; demo data has made-up readings.

**Which organisation:** sync and the notification checks run for the open organisation only, as other
checks do today *[call]*. Reminders for the others aren't lost: their Calendar events already exist and fire
on their own. Test and presentation modes never sync and never notify about real data.

**Secrets:** stored in the macOS Keychain (service `ch.studiomanager.app`, account = `<org id>:<connection
id>`, since connection ids repeat across organisations). Store a
session or refresh token rather than the password wherever the service allows. Never in SQLite, backups,
exports, logs, error messages or the MCP server.

### Synology DSM

- The user enters the NAS address (local IP, hostname or QuickConnect is out of scope), port, account and
  password, and a one-time code if the account has 2-step verification. DSM's "remember this device" token
  is stored so the code isn't asked again.
- HTTPS. Many NAS use a self-signed certificate: on first connect, show its fingerprint and let the user
  trust **that** certificate. Never turn certificate checks off.
- Reads through the DSM Web API: model and DSM version, and per disk the slot, model, serial, size, health
  status, bad sectors, temperature and power-on hours where DSM reports them. Drive age comes from power-on
  hours, or from the first time the app saw that serial.
- The setup form recommends a dedicated DSM account. If DSM needs admin rights to read storage health, say
  so plainly in the form.

### Bambu Lab cloud

- The user signs in with their Bambu account (email, password, the emailed code when asked; region global
  or China). The app keeps the token, not the password.
- Reads the bound printers (model, serial, name) and the print-task history; **print hours = the sum of
  finished print durations** since the connection was made, plus a starting value the user types in from
  the printer's own counter (the printer has run before the app knew it).
- This is Bambu's **unofficial** cloud API; it can change without notice. The design must survive that: a
  failure degrades to "type the hours in", with a clear message, and never blocks the rest of Upkeep.
- LAN-only Bambu printers are out of scope for v1 *[call]*; their owners type hours in.

## 9. Templates

Choosing a kind when adding a machine offers a starter set of upkeep items, editable before saving and after.
Templates live in code with EN + FR text. v1 set *[call]*: NAS, 3D printer (FDM), photo / inkjet printer,
monitor (colour calibration), camera, computer, generic. Examples:

- NAS: test a backup restore (3 months), update the system (monthly check), check backup logs (monthly),
  dust filters and fans (6 months).
- 3D printer: clean nozzle and lubricate rods (200 h), clean build plate (50 h), check belts (6 months).

Intervals are starting points; the builder picks sensible values and marks them as editable defaults.

## 10. Agents (MCP)

Read-only in v1 *[call]*: `list_machines` (with next upkeep) and upkeep items in `whats_due`, behind the
existing Agent access switches. Follows
[the agent access design](2026-10-27-agent-access-mcp-design.md). No secrets, no readings history.

## 11. Fits with the rest

- Follows [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md): tokens, shared components, lucide icons, i18n via
  `useT()` with EN and FR keys (`i18nParity` test).
- Per organisation like everything since [organisations](2026-09-22-organisations-design.md).
- Demo app seed (`seed.rs`, see [the demo app design](2026-09-23-demo-app-design.md)): a few machines,
  items in every state, consumables, subscriptions, fake readings.
- Undo/redo and the unsaved-changes guard work on the new forms like on the others.
- Docs: a short section in [README.md](../../../README.md) and in [the tester guide](../../GUIDE.md).

## 12. Left to the builder

- Exact DSM API calls and fields, and the Bambu endpoints; verify against real devices or their docs before
  coding the parsers, and keep sample responses as test fixtures.
- The AppleScript syntax for an alert on an all-day event (offset from midnight).
- Keychain access from Rust (crate choice).
- Component structure, query hooks, and how the Upkeep page splits into files, following existing pages
  (Resources, Expenses).
- Template intervals (§9).

## Shared equipment between organisations

Equipment is per organisation by default ([organisations](2026-09-22-organisations-design.md)). Settings › Upkeep ›
Equipment lets an organisation use another's machines, upkeep and consumables instead (`equipmentFrom` in its
prefs; absent = its own).

- The borrowing organisation reads and writes the other's database (`getEquipmentDb`, and `execute_batch` with a
  `targetOrg`). The data exists once; nothing is copied.
- Not shared: projects, expenses, connections and subscriptions stay with the organisation that owns them.
  A borrowed machine has no project links, and its consumable use is not tied to a project.
- Calendar events for upkeep items are written only by the organisation that owns the equipment.
- Test and presentation mode never reach into another organisation.
