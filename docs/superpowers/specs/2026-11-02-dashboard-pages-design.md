# Dashboard pages and studio widgets — design

Date: 2026-11-02 · Status: draft, waiting for Loris's approval

Built on [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md). Extends the dashboard of the
[v1.6.3–v1.7.0 design](2026-03-27-v163-v170-design.md) (presets, §3) and the machines and connections of the
[studio upkeep design](2026-10-28-studio-upkeep-design.md). Organisations and the "equipment from" setting:
[organisations design](2026-09-22-organisations-design.md).

Decisions marked *[call]* were made by the designer from the conversation and the code; Loris can overturn any.
Everything else was said by Loris.

## Why

Loris's studio now runs on a small network: a Synology NAS with self-hosted services (Paperless, Pi-hole, Uptime
Kuma, Forgejo, FreshRSS…), a Mac mini driven remotely, Time Machine to the NAS, a 3D printer. Each service has its
own web page and port, and nothing shows at a glance whether the studio is healthy (Time Machine was broken for
five months without anyone noticing).

StudioManager is already the app open all day, and already knows the machines (Upkeep). Instead of a separate
start page in the browser, the dashboard gets **several pages**, and one of them can be a **studio page**: quick
links to every service, their status, backups, the NAS, remote machines and upkeep.

Loris uses the studio machines for client work and personal projects alike, so the studio widgets must work in
both of his organisations.

**StudioManager is meant for other users too.** Nothing here may be specific to Loris's hardware or services:
every widget is filled from data the user enters or connects.

## Goals

1. **Dashboard pages.** The dashboard holds several pages, shown as **tabs under the page title** (Loris's choice,
   option A of the mockups). Each page is its own grid of widgets, added, dragged and resized exactly as today.
   Any widget can go on any page.
2. **Links widget.** One-click links to the web pages a user opens often (for Loris: DSM, Paperless, Pi-hole,
   Uptime Kuma, Forgejo, FreshRSS, Homepage), each with a **status dot**.
3. **Backups widget.** "Is my work safe?": the last Time Machine backup of this Mac, the last NAS snapshot, and
   manual copies (an external HDD refreshed by hand).
4. **NAS widget.** Disk space (used / total, with a bar) and drive health of a connected NAS.
5. **Remote machines widget.** Each computer the user reaches remotely: online or not, and its open buttons
   (for Loris: Screen Sharing from the MacBook, Jump Desktop from the iPad).
6. **Upkeep widget** on the studio page: the existing widget, unchanged.
7. The studio widgets show the same machines in every organisation that uses the same equipment (readings that
   need a connection's secret are refreshed only by the owning organisation, see §2).

## Non-goals

- **A monitoring system.** No history graphs, no alert rules beyond what Upkeep and the connections already do.
  Uptime Kuma (or similar) stays the tool for that.
- **Live 3D printer progress.** The Bambu connection reads print history only; live status (MQTT) is a later,
  separate piece of work.
- **Pi-hole or other service statistics.** Nice to look at, nothing to act on.
- **Controlling services** (restart a container, start a backup) from StudioManager.
- **Running anything on the NAS.** StudioManager stays a desktop app; checks run while it is open.

## Anti-goals

- **Anything hard-coded to Loris's setup** (his hostnames, his services, Synology-only wording in generic widgets).
- **A second way of doing what Upkeep already does.** Manual backup copies are Upkeep reminders, links are
  machine links, machines are Upkeep machines.
- **A widget that cries wolf.** A service on a Tailscale address is "unreachable" when the user is away with
  Tailscale off: the widget must say *unreachable*, not *down*, and never notify about it.
- **Changing what an existing user sees on upgrade.** Their current dashboard becomes their first page, as is.
- **Secrets in the database, logs or the page.** Same rule as the connections: Keychain only.

## Constraints

- **UI rules:** everything follows [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md): reuse first, name what each
  piece derives from, flag anything new to Loris; tokens only, no literal colours; widget frame = `Card
  padding="none"` + `WidgetShell` / `WidgetTitle`; `EmptyState size="sm"`, `ListSkeleton size="sm"`, failed =
  danger `Callout` + Retry, never the raw error; `ProgressBar` for disk space (warning 75%, danger 90%); `dot-sm`
  for status; lucide icons from `ICONS` only; all text through `useT()` in EN and FR.
- **Organisations:** each organisation has its own database. Machines, upkeep and consumables are read through
  `getEquipmentDb()`, which follows the organisation's **"Use equipment from"** setting (Settings › Upkeep,
  `prefs.equipmentFrom`). Loris's Personal Projects organisation already borrows the studio's equipment.
- **Connections** (Synology, Bambu, Paperless) sync only for the open organisation, every 6 hours
  (`src/lib/upkeep/connections.ts`), secrets in the Keychain per (organisation, connection).
- **Opening links:** machine links open through `openMachineAttachment` (`src/lib/upkeep/openAttachment.ts`), which
  passes any scheme to the shell plugin, but the app's capability (`shell:allow-open`) only allows http(s) and
  mailto. `vnc://` (Screen Sharing) and Jump Desktop links need a deliberate, narrow way to open (see §5).

## How it works

### 1. Pages

- The dashboard header keeps the title, year, presets and Add. Under it, a **tab row**: one tab per page, the
  active one underlined, and a **+** at the end that adds a page. Built on the existing `TabList` / `TabItem` /
  `tabIds` (DESIGN-SYSTEM.md, Tabs).
- A tab's context menu (existing `ContextMenu`) offers **Rename** (existing `InlineRename`), **Move left / right**
  and **Delete** (existing `ConfirmDialog`; the last page can't be deleted). *[call]* Dragging tabs to reorder is
  left out of the first version.
- **The year selector stays one dashboard-wide setting**, unsaved as today, and applies to whatever page is shown.
  *[call]* Pages store no year.
- **Presets and Add act on the active page.** Picking a preset fills the active page with that preset's
  layout instead of replacing the whole dashboard. Saving a preset saves the active page's layout.
- **A new page** starts empty, showing the existing empty state with the Add button. *[call]*
- **Pages belong to the organisation** and are stored in its database (a new table, e.g.
  `dashboard_pages(id, name, sort_order, layout_json)`, `layout_json` = `{widgets, layout}` like the presets).
  This also fixes today's quirk: the live layout sits in localStorage keys (`dashboard-layout`,
  `dashboard-widgets`…) that are **not** namespaced per organisation, so both organisations currently share one
  layout.
- **The last open tab is remembered** per organisation (a namespaced localStorage key is fine for that; it is a
  convenience, not data).
- **Upgrade:** on first launch, the current localStorage layout (`dashboard-layout`, `dashboard-widgets`) becomes
  page 1, named after the active preset or "Dashboard" *[call]*, written in the same pass into **every**
  organisation's database (through `targetOrg`), since that is what each one shows today. Only then are those two
  keys and `dashboard-preset-id` / `dashboard-preset-name` removed (the active preset becomes per page). *[call]*
- **Pinned notes are not touched:** `dashboard-pinned-notes` keeps its key and stays one note shared by every
  pinned-notes widget, as today. *[call]*
- **An organisation created later** starts with one page holding the default layout (`DEFAULT_WIDGETS` /
  `DEFAULT_LAYOUT`), as a new organisation does today. *[call]*

### 2. A shared studio page across organisations

Loris wanted the studio page to be "the same in every organisation". The code already gives most of that:

- The studio widgets read machines through `getEquipmentDb()`, so an organisation that uses another's
  equipment shows **the same machines, links, upkeep and backups**. Nothing new is needed for the data.
- **What is not shared is the page layout:** each organisation arranges its own studio tab once. *[call]* This
  replaces the "shared page" setting discussed in the conversation: the data is already shared, and a layout
  shared across separate databases would be the riskiest part of this work for a one-time arrangement. If Loris
  still wants one layout for both, it is a follow-up.
- **Connection readings are not refreshed by a borrowing organisation** (Loris's decision, 2026-11-02). A
  connection's secret stays usable only by the organisation that owns it: `guard()` / `check_org` in
  `src-tauri/src/connectors/mod.rs` are not loosened. In Personal Projects, the NAS widget and the snapshot row of
  the Backups widget show the readings from the owning organisation's last sync, with their age ("Updated 3 h
  ago"). Everything that needs no secret stays live in every organisation: links and status dots, Time Machine,
  remote machines online, upkeep.
- **Fix in passing:** today a borrowing organisation's sync pass mixes databases (`getConnections()` /
  `storeReadings()` / `recordSync()` read its own database while `getMachines()` reads the lender's), so its own
  connections could be matched against the lender's machine ids. A borrowing organisation skips connection syncs
  entirely, since the machines in use are not its own. *[call]*

### 3. Links widget

- **The links are machine links** (`machine_files` with `kind = 'link'`), which already exist per machine in
  Upkeep (label + address). The widget lists them **grouped by machine** (NAS: DSM, Paperless, Pi-hole…; Mac
  mini: Screen Sharing…). *[call]* A user without machines adds links to a machine of kind "generic" (e.g.
  "Web services"); no separate link list is invented.
- It shows **every machine that has links**. Widgets have no settings today (`DashboardWidget` is `{id, type}`);
  choosing machines per widget is left for later, so no new settings pattern is needed. *[call]*
- Each row: status dot, label, and an `IconButton href`-style open action (`ICONS.openExternal`). Clicking the
  row opens the link.
- An empty widget says what to do: "No links yet", with a way to add one to a machine.

### 4. Status dots

- **StudioManager checks each http(s) link itself**: a request from the Rust side with a short timeout (a few
  seconds), accepting any answer from the server (even 401/403: the service is up, it just wants a login).
  It works without Uptime Kuma, so it is generic. *[call]* An optional Uptime Kuma connection can come later.
- States and wording: **up** (success dot), **unreachable** (muted dot, "Unreachable": no answer, which
  includes being away from the network), **error** (warning dot: the server answered with a 5xx). Never "down".
- Checks run when the studio page is shown and every few minutes while it stays shown *[call: 5 minutes]*;
  nothing runs in the background, nothing notifies.
- Non-http links (`vnc://`, Jump Desktop) get no dot in the Links widget; their machine's online state is in the
  Remote machines widget.
- **Certificates:** a link whose host and port match a connection with a pinned certificate
  (`cert_fingerprint`, `connectors/tls.rs`) is checked with that pin (`pinned_http_client`), so a self-signed NAS the
  user already trusted shows "up". Any other certificate error counts as "error" with a hint. *[call]* (Loris's
  own services use publicly trusted Tailscale certificates, so this matters for other users.)

### 5. Remote machines widget

- Lists machines of kind **computer** that have at least one remote link (any non-http(s) link, or a link marked
  as remote *[call: by scheme]*): name, **online / unreachable**, and one button per remote link (label from the
  link, e.g. "Screen Sharing", "Jump Desktop").
- **Online check** *[call]*: a TCP connection to the link's host on its port (5900 for `vnc://` when none is
  given), short timeout. Same wording rules as §4.
- **Opening remote links safely:** a dedicated Rust command opens a machine link only if its scheme is on a short
  allow-list (`vnc`, plus the scheme Jump Desktop uses, to confirm during the build) and the link comes from a
  machine in the database, not from free text. The general `shell:allow-open` scope stays as it is. This is a new
  command: flag it to Loris.
- On the iPad, Jump Desktop is used directly (StudioManager is a Mac app); the Jump Desktop link in the widget is
  for the Mac.

### 6. Backups widget

One row per backup, with a dot and "last: {relative date}":

- **Time Machine (this Mac):** read from `/Library/Preferences/com.apple.TimeMachine.plist` (last destination,
  result, latest snapshot date), readable without Full Disk Access (checked on Loris's Mac 2026-11-02). Warning
  after 2 days without a backup, danger after 7 or when the last result is an error *[call]*. Hidden on a Mac
  with Time Machine off.
- **NAS snapshots:** the newest snapshot date per shared folder, from the Synology connection (new read; see §7).
  One row for the NAS ("Snapshots: today 02:00"), expandable or with a tooltip listing the shares *[call]*.
- **Manual copies:** Upkeep items flagged as backups, for example "Refresh the HDD copy, every month" on the NAS.
  The row shows the item's `last_done_on` and due state, and ticking it in Upkeep updates it. *[call]* The flag is
  a new column on `upkeep_items` (e.g. `is_backup`) or a template item; the builder picks the lighter one.
- A row that was never set up is not shown; an empty widget explains the three sources.

### 7. NAS widget

- For each machine with a NAS connection: model, **volume used / total** with a `ProgressBar` (thresholds from
  the design system), drive health (existing `machine_disks`, `diskHealthVariant`), last sync time.
- **New Synology read:** volume usage (from `load_info`, which also returns `volumes` and `storagePools`) stored as
  machine readings (`machine_readings`, metrics such as `volume_used_bytes` / `volume_total_bytes` per volume),
  plus the snapshot dates for §6. The fixtures in `src-tauri/src/connectors/fixtures/` gain these fields.
- Generic wording ("NAS", "Volume 1"), no Synology branding in the widget; other NAS kinds can fill the same
  readings later.

### 8. Upkeep widget

Unchanged: it already shows due and overdue maintenance, low stock, warranties ending and renewals, and reads
through `getEquipmentDb()`.

### Widget catalogue

The five new widgets join `WIDGET_CATALOG` in a new **"Studio"** category *[call]*, each addable once **per page**.
They follow the existing pattern: type in `WidgetType`, entry in `WIDGET_CATALOG`, case in `renderWidget`,
`WidgetShell` + `WidgetTitle`, its own `ErrorBoundary`, EN + FR strings. A built-in **"Studio" preset** fills a
page with Links, Backups, NAS, Remote machines and Upkeep. *[call]*

## Build order

Each step ships on its own and is useful alone:

1. **Pages:** tabs, per-organisation storage, presets acting on a page, upgrade of the current layout.
2. **Links widget + status dots.**
3. **Backups, NAS and Remote machines widgets**, with the new Synology reads and the remote-link command.

The sync fix of §2 (a borrowing organisation skips connection syncs) ships with step 3, where the new readings
appear.

## Left to the builder

- The table and column names, and whether page layouts reuse the preset JSON helpers.
- The exact refresh interval of the status checks and their concurrency.
- How the Time Machine plist is parsed (Rust `plist` crate or `defaults`), and its exact fields.
- Which DSM API gives snapshot dates (`SYNO.Core.Share.Snapshot` `list` is the candidate) and the volume fields of
  `load_info`; capture real fixtures from Loris's DS925+ through the existing connection.
- Jump Desktop's URL scheme for a saved or ad-hoc connection.
- Wording in EN and FR, following the design system's wording rules.

## Mockups

The page-switcher mockups (A tabs, B header switch, C title menu) were shown in the brainstorming session on
2026-11-02; Loris chose **A**. The studio page in those mockups used placeholder widgets and data.
