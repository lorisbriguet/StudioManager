# Network page — design

Date: 2026-11-02 · Status: draft, waiting for Loris's approval

Built on [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md). Extends the machines and connections of the
[studio upkeep design](2026-10-28-studio-upkeep-design.md). Organisations and the "equipment from" setting:
[organisations design](2026-09-22-organisations-design.md). The opt-in sidebar page follows the pattern of
[Agents](../../agents.md).

Decisions marked *[call]* were made by the designer from the conversation and the code; Loris can overturn any.
Everything else was said by Loris.

## Why

Loris's studio now runs on a small network: a Synology NAS with self-hosted services (Paperless, Pi-hole, Uptime
Kuma, Forgejo, FreshRSS, Homepage), a Mac mini driven remotely, Time Machine to the NAS, a 3D printer. Each
service has its own web page and port, and nothing shows at a glance whether the studio is healthy: Time Machine
was broken for five months without anyone noticing.

StudioManager is already the app open all day and already knows the machines (Upkeep). It gets a **Network page**:
quick links to every service with their status, the NAS's health, backups, remote machines and the upkeep due on
them.

Loris uses the studio machines for client work and personal projects alike, so the page must work in both of his
organisations.

**StudioManager is meant for other users too.** Nothing here may be specific to Loris's hardware or services: the
page is filled from the machines, links and connections each user enters, and it is off until switched on.

**Considered and set aside:** several dashboard pages (tabs) with a "Studio" page of widgets. It was mocked up and
chosen first, then replaced by this page: a dashboard rework (layout storage, presets, migration of every
organisation) for what is really one fixed page. Dashboard pages stay an idea for later, in
[IDEAS.md](../../../IDEAS.md).

## Goals

1. A **Network** page in the sidebar, **under Agents**, hidden until switched on in Settings.
2. **Links** to the web pages of the services a user opens often, grouped under their machine, each with a
   **status dot**.
3. **NAS health:** disk space (used / total, with a bar) and drive health of a connected NAS.
4. **Remote machines:** online or not, and their open buttons (for Loris: Screen Sharing and Jump Desktop).
5. **Backups:** the last Time Machine backup of this Mac, the last NAS snapshot, and manual copies (an external HDD
   refreshed by hand).
6. **Upkeep due** on these machines.
7. The same machines in every organisation that uses the same equipment.

## Non-goals

- **A monitoring system.** No history graphs and no alert rules beyond what Upkeep and the connections already do.
  Uptime Kuma (or similar) stays the tool for that.
- **Live 3D printer progress.** The Bambu connection reads print history only; live status (MQTT) is later,
  separate work.
- **Pi-hole or other service statistics.** Nice to look at, nothing to act on.
- **Controlling services** (restart a container, start a backup) from StudioManager.
- **Rearranging the page.** It has one designed layout; what it shows comes from the user's data.
- **Running anything on the NAS.** StudioManager stays a desktop app; checks run while it is open.

## Anti-goals

- **Anything hard-coded to Loris's setup** (his hostnames, his services, Synology wording in generic places).
- **A second way of doing what Upkeep already does.** Links are machine links, manual backup copies are Upkeep
  reminders, machines are Upkeep machines.
- **A page that cries wolf.** A service on a Tailscale address is unreachable when the user is away with Tailscale
  off: the page says *unreachable*, never *down*, and nothing notifies about it.
- **Secrets in the database, logs or the page.** Keychain only, as for the connections.
- **One organisation using another's connection secrets** (Loris's decision, see §6).

## Constraints

- **UI rules:** everything follows [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md): reuse first, name what each
  piece derives from, flag anything new to Loris; tokens only, no literal colours; cards = `Card` (rounded-xl,
  surface, no border); headings `HEADING_1` / `HEADING_2`, labels `SectionLabel`; `ProgressBar` for disk space
  (warning from 75%, danger from 90%); `dot-sm` / `dot` for status; lucide icons from `ICONS` only; the five
  states (skeleton, failed `Callout` + Retry, empty, …); all text through `useT()` in EN and FR.
- **Organisations:** each has its own database. Machines, upkeep and consumables are read through
  `getEquipmentDb()`, which follows the organisation's **"Use equipment from"** setting (Settings › Upkeep,
  `prefs.equipmentFrom`). Loris's Personal Projects organisation already uses the studio organisation's equipment.
- **Connections** (Synology, Bambu, Paperless) sync only for the open organisation, every 6 hours
  (`src/lib/upkeep/connections.ts`); their secrets are in the Keychain per (organisation, connection), and
  `guard()` / `check_org` (`src-tauri/src/connectors/mod.rs`) refuse any other organisation.
- **Opening links:** machine links open through `openMachineAttachment` (`src/lib/upkeep/openAttachment.ts`), but
  the app's `shell:allow-open` capability only allows http(s) and mailto. `vnc://` and Jump Desktop links need a
  deliberate, narrow way to open (§4).

## How it works

### 1. Switching it on, and the sidebar

- **Settings:** a "Network page" switch, stored as an organisation preference like "Show Tasks page"
  (`showTasksPage`) and "Show Income" *[call: per organisation, so a user can have it in one organisation only]*.
  Loris turns it on in both. Placed in the settings section that holds the other page switches.
- **Sidebar:** a **Network** entry right under Agents (`src/components/layout/Sidebar.tsx`), filtered out when the
  switch is off, the same way as `tasks`, `income` and `agents`. Route `/network`. Icon: an existing network
  concept in `ICONS` if there is one, otherwise a new lucide icon added to `ICONS` (flag it).
- **When it is on but empty** (no machine has links, no connection, Time Machine off): the page's empty state
  explains what fills it (add links to a machine in Upkeep, connect a NAS) with a button to Upkeep.

### 2. Layout (Loris's choice: grouped by machine, option A of the mockups)

- **Header:** `PageHeader` titled "Network", with "Checked {time} ago" (fine print) and a refresh `IconButton` that
  runs the status checks now.
- **Two columns** (wide left, narrow right; one column on narrow windows):
  - **Left: one card per machine** that has links, a NAS connection or remote links, in the order of the Upkeep
    machine list *[call]*. Each card:
    - title: the machine's name, with its kind and, for a connected NAS, "updated {time} ago" on the right;
    - **NAS health** when the machine has a NAS connection (§5);
    - **remote state and buttons** when it has remote links (§4);
    - **Services:** its http(s) links in two columns, each a row with a status dot, the label, and an open action
      (`ICONS.openExternal`); an error shows its short reason ("Error 502").
    - The card title links to the machine's page in Upkeep (`upkeep/machines/:id`).
  - **Right:** a **Backups** card (§7) and an **Upkeep due** card (§8).
- **Mockup:** shown in the brainstorming session on 2026-11-02 (option A). Its numbers were illustrative.

### 3. Links and status dots

- **Links are machine links** (`machine_files` with `kind = 'link'`, label + address), which already exist per
  machine in Upkeep. *[call]* A user without a NAS adds links to any machine, or to a "generic" machine such as
  "Web services"; no separate link list is invented.
- **StudioManager checks each http(s) link itself**: a request from the Rust side with a short timeout, accepting
  any answer from the server (even 401/403: the service is up, it wants a login). Works without Uptime Kuma, so it
  is generic. *[call]* An optional Uptime Kuma connection can come later.
- **States and wording:** **up** (success dot), **unreachable** (muted dot, "Unreachable": no answer, including
  being away from the network), **error** (warning dot: the server answered 5xx, with the code as the short
  reason). Never "down".
- **Certificates:** a link whose host and port match a connection with a pinned certificate (`cert_fingerprint`,
  `connectors/tls.rs`) is checked with that pin (`pinned_http_client`), so a self-signed NAS the user already
  trusted shows "up". Any other certificate error counts as "error" with a hint. *[call]* (Loris's own services use
  publicly trusted Tailscale certificates; this matters for other users.)
- **When checks run:** on opening the page, on the refresh button, and every 5 minutes while the page is shown
  *[call]*. Nothing runs in the background, nothing notifies.

### 4. Remote machines

- A machine shows **remote state** when it has at least one remote link: a link whose scheme is on the remote
  allow-list (`vnc`, plus Jump Desktop's scheme, to confirm during the build) *[call: recognised by scheme]*.
- **Online check:** a TCP connection to the link's host on its port (5900 for `vnc://` when none is given), short
  timeout. "Online" (success dot) or "Unreachable" (muted dot), same wording rules as §3.
- **Buttons:** one per remote link, labelled with the link's label ("Screen Sharing", "Jump Desktop").
- **Opening them safely:** a dedicated Rust command opens a machine link only if its scheme is on the allow-list
  and the link is read from a machine in the database by id, never passed as free text from the page. The general
  `shell:allow-open` scope stays as it is. This is a new command: flag it to Loris.
- On the iPad, Loris uses Jump Desktop directly (StudioManager is a Mac app); the button is for the Mac.

### 5. NAS health

- On the card of a machine with a NAS connection: per volume, "Volume 1 · 4.8 of 7 TB" with a `ProgressBar`;
  drive health from `machine_disks` (`diskHealthVariant`), summarised ("2 drives healthy", or the drive that is
  not); "updated {time} ago" from the connection's last sync.
- **New Synology read:** volume usage (`load_info` also returns `volumes` and `storagePools`), stored as machine
  readings (`machine_readings`, e.g. `volume_used_bytes` / `volume_total_bytes` per volume), plus the newest
  snapshot date per shared folder for §7. The fixtures in `src-tauri/src/connectors/fixtures/` gain these fields.
- Generic wording ("NAS", "Volume 1"); other NAS kinds can fill the same readings later.

### 6. Organisations

- The page reads machines through `getEquipmentDb()`, so an organisation that uses another's equipment shows
  **the same machines, links, upkeep and backups**. Nothing new is needed for that.
- **Connection readings are not refreshed by a borrowing organisation** (Loris's decision). A connection's secret
  stays usable only by the organisation that owns it; `guard()` / `check_org` are not loosened. In Personal
  Projects, NAS health and the snapshot row show the owning organisation's last sync with its age ("updated 3 h
  ago"). Everything that needs no secret stays live in every organisation: links and status dots, remote machines,
  Time Machine, upkeep.
- **Fix in passing:** today a borrowing organisation's sync pass mixes databases (`getConnections()` /
  `storeReadings()` / `recordSync()` read its own database while `getMachines()` reads the lender's), so its own
  connections could be matched against the lender's machine ids. A borrowing organisation skips connection syncs
  entirely, since the machines in use are not its own. *[call]*

### 7. Backups card

One row per backup source, with a dot and "last {date}". A source that was never set up is not shown.

- **Time Machine (this Mac):** read from `/Library/Preferences/com.apple.TimeMachine.plist` (destination, last
  result, latest backup date), readable without Full Disk Access (checked on Loris's Mac 2026-11-02). Shows
  "running" while a backup runs. Warning after 2 days without a backup, danger after 7 or when the last result is
  an error *[call]*. Hidden when Time Machine is off.
- **NAS snapshots:** the newest snapshot across the NAS's shared folders, from the Synology connection (§5); a
  `Tooltip` lists each folder's latest snapshot *[call]*.
- **Manual copies:** Upkeep items marked as backups (for Loris: "Refresh the HDD copy", monthly, on the NAS). The
  row shows `last_done_on` and the due state; ticking it in Upkeep updates it. *[call]* The mark is a new column
  on `upkeep_items` (e.g. `is_backup`, a checkbox in the upkeep item form) unless a lighter way fits.

### 8. Upkeep due card

The due and overdue upkeep items of the machines on the page, reusing the rows of the existing Upkeep widget /
Overview tab (`src/components/upkeep/`). Empty: "Nothing due". *[call]* Low stock, warranties and renewals stay
on the dashboard widget and the Upkeep page.

## Build order

Each step ships on its own:

1. **The page, its switch and sidebar entry, machine cards with links and status dots**, Upkeep due card.
2. **Remote machines:** online check and the remote-link command.
3. **NAS health and Backups card**, with the new Synology reads, Time Machine and the backup mark; the sync fix
   of §6 ships here, where the new readings appear.

## Left to the builder

- Table and column names, and how readings are keyed per volume.
- The concurrency and exact timeouts of the checks.
- How the Time Machine plist is parsed (Rust `plist` crate or `defaults`), and its exact fields.
- Which DSM API gives snapshot dates (`SYNO.Core.Share.Snapshot` `list` is the candidate) and the volume fields of
  `load_info`; capture real fixtures from Loris's DS925+ through the existing connection.
- Jump Desktop's URL scheme.
- Wording in EN and FR, following the design system's wording rules.
