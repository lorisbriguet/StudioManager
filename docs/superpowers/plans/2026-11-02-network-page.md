# Network page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in Network page under Agents in the sidebar: one card per machine with its service links and their status, NAS health and remote buttons, plus Backups and Upkeep due cards.

**Architecture:** The page reads machines, links, upkeep and readings through `getEquipmentDb()` so a borrowing organisation sees the lender's equipment. Reachability checks, the remote-link opener and the Time Machine read are new Rust commands in `src-tauri/src/network.rs`; NAS volume and snapshot readings are added to the existing Synology connector and stored as `machine_readings`. The UI is built from existing design-system components only.

**Tech Stack:** Tauri 2 (Rust, reqwest blocking + rustls, rusqlite), React + TypeScript, TanStack Query, zustand, vitest + Testing Library.

**Spec:** [2026-11-02-network-page-design.md](../specs/2026-11-02-network-page-design.md) · **Handover:** [2026-11-02-network-page-handover.md](2026-11-02-network-page-handover.md)

## Global Constraints

- Follow [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md): reuse first; tokens only (no hex, no palette classes, no `bg-x/20`); `Card` for cards; `PageHeader`, `HEADING_2`, `SectionLabel`; `ProgressBar` for disk space (warning from 75%, danger from 90%); `dot-sm` / `dot` with solid tokens for status; lucide icons through `ICONS` and `ICON_SIZE` only; skeleton while loading, danger `Callout` "Couldn't load {thing}" + Retry on failure, `EmptyState` when empty; `Tooltip`, never `title`; toasts only through `notify`, and no toast for background checks.
- Every visible string through `useT()`, keys in `src/i18n/ui.ts` in EN and FR (`i18nParity.test.ts` must pass). Short labels take no trailing period.
- Status wording: "Up" is shown as a dot only; "Unreachable" (muted dot); "Error {code}" (warning dot); "Certificate not trusted" (warning dot). Never the word "down". Nothing notifies.
- Nothing specific to Loris's setup in code, copy or defaults (no hostnames, no "Synology" in generic UI).
- A connection's Keychain secret is used only by the organisation that owns it: `guard()` / `check_org` in `src-tauri/src/connectors/mod.rs` are not changed.
- Connections and network checks never run in test or presentation mode (`ActiveOrg::in_mode()` in Rust, `testMode` / `presentationMode` in the app store).
- New things to flag to Loris in the final summary (design-system rule "Flag anything new"): the `network` icon, the `network_check`, `open_remote_link` and `time_machine_status` commands, the `is_backup` column, the `plist` crate.
- Database version goes from 9 to 10 (Task 7). The installed StudioManager's MCP tools refuse a database newer than they know ("database newer") until a release ships: run Task 7 last and tell Loris before the dev build is opened on his real data.

## Review Focus

1. **Personal Projects (borrowing) open:** the page shows the lender's machines, links, disks, volume readings and upkeep, and no sync runs or errors appear for the borrowing organisation. Tested in Task 2 and Task 4.
2. **Links typed without a scheme** (`dsm.local:5001`): opened as https today by `openMachineAttachment`; the checker and the service list must treat them as https too, not drop them. Tested in Task 4 (`linkUrl`).
3. **Away from the studio** (Tailscale off): every check times out; rows read "Unreachable", nothing turns red, no toast, no notification. Tested in Task 3 (timeout → unreachable) and Task 4 (hook never calls `notify`).
4. **One service that hangs** (accepts the connection, never answers): its row ends as "Unreachable" within the timeout and the other rows still get their result. Tested in Task 3 with a silent local listener.
5. **Test or presentation mode:** no request leaves the Mac; the page renders without dots and without errors. Tested in Task 3 (`network_check` returns an empty list in a mode) and Task 4.

---

### Task 1: Network page switch, sidebar entry and empty page

**Files:**
- Modify: `src-tauri/src/orgs.rs` (struct `OrgPrefs`, `Default`, tests)
- Modify: `src/lib/orgs.ts` (`OrgPrefs`, `DEFAULT_ORG_PREFS`)
- Modify: `src/stores/org-store.ts` (`applyPrefsToAppStore`)
- Modify: `src/stores/app-store.ts` (state + setter, next to `showTasksPage`)
- Modify: `src/pages/SettingsPage.tsx` (Behaviour card, after the Income row)
- Modify: `src/components/layout/Sidebar.tsx` (item after `agents`; the switch filter goes in **both** `navItems.filter` lists, the main one and the collapsed/compact one further down)
- Modify: `src/components/ui/icons.ts` (`network: Network` from lucide)
- Modify: `src/App.tsx` (route `network`)
- Create: `src/pages/NetworkPage.tsx`
- Modify: `src/i18n/ui.ts`, `DESIGN-SYSTEM.md` (icon table: `network`), `docs/GUIDE.md` (short "Network page" section linking the spec)
- Test: `src/__tests__/Sidebar.test.tsx`, `src-tauri/src/orgs.rs` tests

**Interfaces:**
- Produces: `OrgPrefs.showNetworkPage?: boolean` (TS, absent = false); Rust `show_network_page: bool` with `#[serde(default)]`; `useAppStore` `showNetworkPage: boolean`, `setShowNetworkPage(show: boolean): void` (writes through `savePrefs({ showNetworkPage })` like `setShowTasksPage`); route `/network` rendering `NetworkPage`; `ICONS.network`.

- [ ] **Step 1: Write the failing tests**

Rust, in `orgs.rs` tests: `prefs_without_show_network_page_read_as_off` deserialises the existing JSON literal at the `showIncome…exportLanguage` test and asserts `!prefs.show_network_page`; `show_network_page_round_trips` serialises a prefs with it `true` and asserts the JSON contains `"showNetworkPage":true`. (Without the Rust field the switch would be silently dropped on the next `set_prefs`.)

TS, in `Sidebar.test.tsx`: `hides Network when the switch is off` (`useAppStore.setState({ showNetworkPage: false })` → `queryByText("Network")` is null) and `shows Network right after Agents when on` (`agentsEnabled: true, showNetworkPage: true` → the link to `/network` follows the link to `/agents` in document order).

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml show_network_page` and `npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: FAIL (unknown field / no Network item).

- [ ] **Step 3: Implement**

Add the pref on both sides, the app-store field and setter, the Settings row (`SettingRow label={t.show_network_page} desc={t.show_network_page_desc}` + `Toggle`), the sidebar item `{ to: "/network", icon: ICONS.network, labelKey: "network" }` filtered on `showNetworkPage`, and the route. `NetworkPage` for now renders `PageHeader title={t.network}` and the page empty state: `EmptyState` (`ICONS.network`) with `t.network_empty_title` "Nothing to show yet", `t.network_empty_desc` "Add links to a machine in Upkeep, or connect a NAS", and a button "Open Upkeep" to `/upkeep`. EN/FR keys: `network` "Network" / "Réseau", `show_network_page` "Network page" / "Page Réseau", `show_network_page_desc` "Links, status and backups of your machines" / "Liens, état et sauvegardes de vos machines".

- [ ] **Step 4: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml orgs` and `npx vitest run src/__tests__/Sidebar.test.tsx src/__tests__/i18nParity.test.ts src/__tests__/orgPrefsWriteThrough.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src-tauri/src/orgs.rs src DESIGN-SYSTEM.md docs/GUIDE.md
git commit -m "feat(network): opt-in Network page in the sidebar"
```

---

### Task 2: Borrowing organisations read the lender's readings and stop syncing

**Files:**
- Modify: `src/db/queries/connections.ts` (`currentReading`, `firstReadingSince`, `getMachineReadings`, `getMachineDisks` → `getEquipmentDb()`; new `getEquipmentConnections`, `getLatestMetrics`)
- Modify: `src/db/hooks/useConnections.ts` (new hooks)
- Modify: `src/lib/upkeep/connections.ts` (`syncPass`)
- Test: `src/__tests__/equipmentReadings.test.ts` (new), `src/__tests__/connectionsRunner.test.ts` (add a case)

**Interfaces:**
- Produces:
  - `getEquipmentConnections(): Promise<Connection[]>` — all rows of `connections` in the equipment database.
  - `getLatestMetrics(machineId: number, prefix: string): Promise<{ metric: string; value: number; read_at: string }[]>` — the newest row per metric whose name starts with `prefix`, via `getEquipmentDb()`.
  - Hooks `useEquipmentConnections()` (key `["equipment-connections"]`) and `useLatestMetrics(machineId, prefix)` (key `["machine-readings", machineId, "latest", prefix]`, so the existing sync invalidation of `"machine-readings"` refreshes it). Add `"equipment-connections"` to the keys invalidated after a sync in `useConnections.ts`.

- [ ] **Step 1: Write the failing tests**

`equipmentReadings.test.ts`, mocking `../db` with `getEquipmentDb` returning a fake whose `select` records its SQL and `getDb` throwing: `getMachineDisks reads the equipment database`, `getLatestMetrics returns one row per metric for the prefix` (fake rows `volume_used_bytes:volume_1` at two times → only the newest is returned; SQL uses `LIKE` with the prefix escaped for `%` and `_`), `getEquipmentConnections reads the equipment database`.

In `connectionsRunner.test.ts`: `a borrowing organisation runs no connection sync` — with `equipmentOrgId()` mocked to `"stud"`, `runConnectionSyncs(qc, { force: true })` never calls `invoke("connection_sync", …)` nor `recordSync`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/__tests__/equipmentReadings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Switch the four read queries to `getEquipmentDb()` (writes stay as they are: when not borrowing, both databases are the same one). Add the two queries and hooks. In `syncPass`, return before `getConnections()` when `equipmentOrgId()` is not null.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/__tests__/equipmentReadings.test.ts src/__tests__/equipmentOrg.test.ts` `src/__tests__/connectionsRunner.test.ts`
Expected: PASS, and `npm test` stays green.

- [ ] **Step 5: Commit**

```bash
git add src/db src/lib/upkeep/connections.ts src/__tests__
git commit -m "fix(upkeep): borrowed equipment shows the lender's readings; borrowers skip syncs"
```

---

### Task 3: Rust reachability checks

**Files:**
- Create: `src-tauri/src/network.rs`
- Modify: `src-tauri/src/lib.rs` (`mod network;`, register `network::network_check`)
- Create: `src/lib/network/commands.ts`

**Interfaces:**
- Produces (Rust, serde camelCase):
  - `CheckTarget { key: String, kind: CheckKind, url: String, pin: Option<String> }`, `CheckKind = Http | Tcp`.
  - `CheckResult { key: String, state: CheckState, reason: Option<String> }`, `CheckState = Up | Unreachable | Error` (serialised `"up" | "unreachable" | "error"`). `reason`: `"http_502"`-style for a 5xx, `"certificate"` for a TLS failure, `None` otherwise.
  - `fn classify_status(code: u16) -> (CheckState, Option<String>)`: below 500 → Up (401/403 count as up); 500 and above → Error with `http_{code}`.
  - `#[tauri::command] async fn network_check(app, targets: Vec<CheckTarget>) -> Result<Vec<CheckResult>, String>`: returns `Ok(vec![])` in test or presentation mode; otherwise checks all targets concurrently (one thread each inside `spawn_blocking`), at most 32 targets per call.
  - Http: GET with redirects off, connect timeout 3 s, total timeout 5 s, built from `connectors::tls::pinned_http_client(pin)` (system roots plus the pin). Connect error or timeout → Unreachable; an error whose `connectors::describe` text mentions the certificate → Error/`certificate`.
  - Tcp: `host:port` of the URL (port 5900 when the scheme is `vnc` and none is given), `TcpStream::connect_timeout` 3 s → Up or Unreachable.
- Produces (TS): `networkCheck(targets: CheckTarget[]): Promise<CheckResult[]>` in `src/lib/network/commands.ts`, same shapes.

- [ ] **Step 1: Write the failing tests** (in `network.rs`)

`status_below_500_is_up` (200, 302, 401, 403 → Up, no reason); `status_5xx_is_error_with_code` (502 → Error, `Some("http_502")`); `silent_server_is_unreachable_within_timeout` (bind `127.0.0.1:0`, accept and hold the socket without writing; check it as Http; assert Unreachable and elapsed under 7 s); `closed_port_is_unreachable` (Tcp to a port just bound then dropped); `open_port_is_up` (Tcp to a live listener); `vnc_without_port_uses_5900` (the address helper turns `vnc://host` into `host:5900`); `targets_are_checked_independently` (one silent listener and one listener answering `HTTP/1.1 200` → results Unreachable and Up, keyed correctly).

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml network::`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** the types, `classify_status`, the address helper, the two checks and the command; register it.

- [ ] **Step 4: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml network::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/network.rs src-tauri/src/lib.rs src/lib/network/commands.ts
git commit -m "feat(network): reachability checks for links and remote machines"
```

---

### Task 4: The Network page — machine cards, service links with status, Upkeep due

**Files:**
- Create: `src/lib/network/model.ts`, `src/lib/network/format.ts`, `src/hooks/useNetworkChecks.ts`
- Create: `src/components/network/MachineCard.tsx`, `ServiceRow.tsx`, `UpkeepDueCard.tsx`
- Modify: `src/db/queries/machines.ts` (`getMachineLinks`), `src/db/hooks/useUpkeep.ts` (`useMachineLinks`, key `["machine-links"]`; the add/remove machine-file mutations also invalidate it)
- Modify: `src/pages/NetworkPage.tsx`, `src/i18n/ui.ts`
- Test: `src/__tests__/networkModel.test.ts`, `src/__tests__/networkPage.test.tsx`

**Interfaces:**
- Consumes: `useMachines()`, `useMachineLinks()`, `useEquipmentConnections()` (Task 2), `useUpkeepOverview()`, `networkCheck` (Task 3), `openMachineAttachment`.
- Produces:
  - `getMachineLinks(): Promise<MachineFile[]>` — every `machine_files` row with `kind = 'link'`, via `getEquipmentDb()`.
  - `linkUrl(raw: string): string` — trims, and adds `https://` when there is no scheme (same rule as `openMachineAttachment`).
  - `isRemoteLink(raw: string): boolean` — true for the schemes in `REMOTE_SCHEMES = ["vnc", "jump"]` (keep in sync with Rust in Task 5).
  - `pinFor(url: string, connections: Connection[]): string | null` — `cert_fingerprint` of a connection whose `host` equals the URL host (case-insensitive) and whose `port` equals the URL port (443 for https and 80 for http when absent).
  - `NetworkCard { machine: Machine; services: MachineFile[]; remote: MachineFile[]; nas: Connection | null }` and `buildNetworkCards(machines: Machine[], links: MachineFile[], connections: Connection[]): NetworkCard[]` — keeps machines (`status !== "retired"`) that have a link or a `synology` connection (`machine.connection_id`), in the order of `machines`; `services` = links whose `linkUrl` is http(s) (spec §2: "its http(s) links"; other schemes such as `smb://` are neither checked nor listed), `remote` = remote links.
  - `formatAgo(from: string | number, now: number, t: ReturnType<typeof useT>): string` in `src/lib/network/format.ts` — "just now" under a minute, then "{n} min ago", "{n} h ago", "{n} d ago" (EN/FR keys; the app has no such helper yet). Used for "Checked … ago" and "Updated … ago".
  - `useNetworkChecks(targets: CheckTarget[]): { results: Map<string, CheckResult>; checkedAt: number | null; checking: boolean; refresh: () => void }` — checks on mount, on `refresh()`, and every 300 000 ms while mounted; skipped in test/presentation mode; never calls `notify`. Target keys: `link:{file.id}` for services (Http, `pin` from `pinFor`), `machine:{machine.id}` for the online check (Task 5).

- [ ] **Step 1: Write the failing tests**

`networkModel.test.ts`: `formatAgo steps from just now to minutes, hours and days` (30 s, 5 min, 3 h, 2 d); `linkUrl adds https to bare hosts` (`"dsm.local:5001"` → `"https://dsm.local:5001"`, `"vnc://mini"` unchanged); `isRemoteLink recognises vnc and jump only`; `pinFor matches host and port, default 443`; `buildNetworkCards keeps machines with links or a NAS connection, in order, without retired ones`; `buildNetworkCards splits services and remote links`.

`networkPage.test.tsx` (hooks mocked): `shows one card per machine with its services` (two machines, three links → two card titles, three rows); `shows Unreachable and Error 502 from check results`; `shows the empty state when no card`; `renders without dots in presentation mode` (`presentationMode: true` → `networkCheck` not called); `does not notify when everything is unreachable` (spy on `notify` from `src/lib/notify`, never called); `Upkeep due lists only the due items of machines on the page`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/__tests__/networkModel.test.ts src/__tests__/networkPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Layout per spec §2: `PageHeader` with "Checked {time} ago" (`text-xs text-muted`, `formatAgo`) and a refresh `IconButton` (`ICONS.updates`, `Tooltip` "Check now"); a two-column grid (wide left, narrow right; one column below the `md` breakpoint) using the card gap constants. `MachineCard`: `Card` with `HEADING_2` title linking to `/upkeep/machines/:id`, kind as fine print, a `SectionLabel` "Services" and the service rows in two columns. `ServiceRow`: `dot-sm` (success = up, muted = unreachable or not checked yet, warning = error), label, reason text ("Unreachable", "Error 502", "Certificate not trusted"), open action `IconButton` (`ICONS.openExternal`); the row opens the link through `openMachineAttachment`. Right column: `UpkeepDueCard` = `DueList compact` over `useUpkeepOverview().due` filtered to the cards' machine ids, `EmptyState size="sm"` "Nothing due". Loading: `ListSkeleton size="sm"` in each card; query failure: `Callout` "Couldn't load the network" + Retry.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/__tests__/networkModel.test.ts src/__tests__/networkPage.test.tsx src/__tests__/i18nParity.test.ts && npm run lint`
Expected: PASS, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat(network): machine cards with service links and status"
```

---

### Task 5: Remote machines — online state and safe remote buttons

**Files:**
- Modify: `src-tauri/src/network.rs` (`open_remote_link`, `REMOTE_SCHEMES`), `src-tauri/src/lib.rs` (register)
- Create: `src/components/network/RemoteBlock.tsx`
- Modify: `src/components/network/MachineCard.tsx`, `src/lib/network/commands.ts`, `src/i18n/ui.ts`
- Test: `src-tauri/src/network.rs` tests, `src/__tests__/networkPage.test.tsx`

**Interfaces:**
- Consumes: `NetworkCard.remote`, `useNetworkChecks` (Task 4), `equipmentOrgId()`.
- Produces:
  - Rust `pub(crate) const REMOTE_SCHEMES: &[&str] = &["vnc", "jump"];` and `fn remote_url_allowed(url: &str) -> Result<reqwest::Url, String>` (parses; scheme must be on the list; refuses anything else).
  - `#[tauri::command] async fn open_remote_link(app, target_org: Option<String>, file_id: i64) -> Result<(), String>`: opens the organisation database with the same resolution as `execute_batch` (`batch_db_path`), reads `SELECT kind, path_or_url FROM machine_files WHERE id = ?`, requires `kind = 'link'`, validates with `remote_url_allowed`, then runs `/usr/bin/open` with the URL as its single argument. Refused in test/presentation mode only for another organisation (same rule as `batch_db_path`).
  - TS `openRemoteLink(fileId: number): Promise<void>` calling it with `targetOrg: equipmentOrgId()`.
- Online check: the machine's first `vnc://` remote link becomes a `Tcp` target keyed `machine:{id}`; a machine whose remote links have no `vnc` link shows its buttons without an online state.

- [ ] **Step 1: Write the failing tests**

Rust: `remote_url_allowed_accepts_vnc_and_jump`; `remote_url_allowed_refuses_https_file_and_shell_like_input` (`https://x`, `file:///etc/passwd`, `vnc` without `://`, `javascript:alert(1)` → Err); `open_remote_link_refuses_a_file_attachment` and `…_refuses_a_missing_row` (temporary database with a `machine_files` table, using the lookup helper the command calls, not the command itself).

TS: `Remote block shows Online and one button per remote link`; `clicking a remote button calls openRemoteLink with the file id`.

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml network:: && npx vitest run src/__tests__/networkPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** the helper, the command, `RemoteBlock` (state dot + "Online" / "Unreachable" on the card title row, `Button` per remote link labelled with the link label) and its place at the top of `MachineCard`. Confirm Jump Desktop's URL scheme on the Mac (`/Applications/Jump Desktop.app/Contents/Info.plist`, `CFBundleURLSchemes`); if it is not `jump`, change both lists.

- [ ] **Step 4: Run the tests**

Run: same as Step 2
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src src
git commit -m "feat(network): remote machines with online state and Screen Sharing / Jump Desktop buttons"
```

---

### Task 6: NAS health — volume and snapshot readings from the Synology connector

**Files:**
- Modify: `src-tauri/src/connectors/synology.rs` (`parse_volumes`, `snapshots`, `sync`)
- Modify: `src-tauri/src/connectors/fixtures/synology_storage_load_info.json` (add `size` to the volume); create `fixtures/synology_share_list.json`, `fixtures/synology_snapshot_list.json`
- Create: `src/components/network/NasHealth.tsx`, `src/lib/network/nas.ts`
- Modify: `src/components/network/MachineCard.tsx`, `src/i18n/ui.ts`
- Test: `synology.rs` tests, `src/__tests__/networkNas.test.ts`

**Interfaces:**
- Produces (Rust):
  - `pub(crate) fn parse_volumes(data: &JsonValue) -> Vec<(String, f64)>` — for each entry of `data.volumes` with `size.total` and `size.used` (DSM sends byte counts as strings): metrics `volume_total_bytes:{id}` and `volume_used_bytes:{id}`.
  - `fn parse_snapshot_time(s: &str) -> Option<f64>` — DSM snapshot names like `GMT+01-2026.11.02-02.00.03` → Unix seconds (UTC).
  - Sync adds metrics `snapshot_latest_at:{share}` (Unix seconds of the newest snapshot of each shared folder) read via `SYNO.Core.Share` `list` then `SYNO.Core.Share.Snapshot` `list` per share. A failure in the snapshot read leaves those metrics out; it never fails the sync.
- Produces (TS): `formatBytesShort(n: number): string` in `src/lib/network/format.ts` — decimal units, one decimal at most, trailing ".0" dropped ("4.8 TB", "7 TB", "512 GB"); `volumesFrom(rows: {metric: string; value: number}[]): { id: string; used: number; total: number }[]`, `latestSnapshot(rows): { at: number; byShare: { share: string; at: number }[] } | null`.
- Consumes: `useLatestMetrics(machineId, "volume_")`, `useLatestMetrics(machineId, "snapshot_latest_at:")`, `useMachineDisks`, the card's `nas` connection (`last_sync_at`).

- [ ] **Step 1: Write the failing tests**

Rust: `parse_volumes_reads_used_and_total` (fixture volume `volume_1`, total `"7000000000000"`, used `"4800000000000"` → the two metrics); `parse_volumes_skips_volumes_without_size`; `parse_snapshot_time_reads_dsm_names` (`GMT+01-2026.11.02-02.00.03` → the UTC epoch of 2026-11-02 01:00:03); `sync_without_snapshot_api_still_succeeds` (fake DSM answering an error for the snapshot API → sync Ok, volume metrics present, no `snapshot_latest_at:` metric).

TS `networkNas.test.ts`: `formatBytesShort` (4.8e12 → "4.8 TB", 7e12 → "7 TB", 5.12e11 → "512 GB"); `volumesFrom pairs used and total per volume`; `latestSnapshot picks the newest share`; `NasHealth shows "Volume 1 · 4.8 of 7 TB" with a warning bar above 75%` and `"Updated 3 h ago"` from `last_sync_at`; `NasHealth summarises "2 drives healthy" or names the drive that is not`.

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml synology && npx vitest run src/__tests__/networkNas.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Rust as above. The session gains the two API paths from `SYNO.API.Info` (add both names to the `query` list in `login`), but **optional**: unlike `system` and `storage`, a NAS that does not offer them must still log in and sync (look them up without `?`; missing → no snapshot metrics). Add both entries to `fixtures/synology_api_info.json`. `NasHealth`: one line per volume ("Volume 1 · 4.8 of 7 TB", sizes through `formatBytesShort`) with `ProgressBar`, the disk summary with `diskHealthVariant`, "Updated {time} ago" on the card title row. Volume names: `volume_1` → "Volume 1".

- [ ] **Step 4: Run the tests**

Run: same as Step 2, then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/connectors src
git commit -m "feat(network): NAS volume usage, snapshot dates and health on the machine card"
```

---

### Task 7: Backups card — Time Machine, NAS snapshots, manual copies

**Files:**
- Create: `src-tauri/migrations/010_upkeep_backup.sql` (`ALTER TABLE upkeep_items ADD COLUMN is_backup INTEGER NOT NULL DEFAULT 0;`); modify `src-tauri/src/migrate.rs` (version 10)
- Modify: `src-tauri/Cargo.toml` (`plist = "1"`), `src-tauri/src/network.rs` (`time_machine_status`), `src-tauri/src/lib.rs` (register)
- Modify: `src/types/upkeep.ts` (`UpkeepItem.is_backup: number`), `src/db/queries/upkeepItems.ts` (create/update accept it), `src/components/upkeep/UpkeepItemForm.tsx` (`Checkbox` "Counts as a backup")
- Create: `src/lib/network/backups.ts`, `src/components/network/BackupsCard.tsx`
- Modify: `src/pages/NetworkPage.tsx`, `src/i18n/ui.ts`, `docs/GUIDE.md`
- Test: `network.rs` tests, `src/__tests__/networkBackups.test.ts`, existing backup/restore tests (`backupTables.test.ts`, `backupCsv.test.ts`) stay green

**Interfaces:**
- Produces (Rust): `TimeMachineStatus { enabled: bool, last_backup_at: Option<String>, last_result: Option<i64>, running: bool }` (camelCase); `fn parse_time_machine(prefs: &plist::Value) -> TimeMachineStatus` — `enabled` from `AutoBackup`; the destination whose `DestinationID` equals `LastDestinationID`; `last_backup_at` = newest of its `SnapshotDates` (ISO 8601), `None` when absent; `last_result` = its `RESULT`. `#[tauri::command] async fn time_machine_status() -> Result<Option<TimeMachineStatus>, String>`: `None` when `/Library/Preferences/com.apple.TimeMachine.plist` is missing; `running` from `/usr/bin/tmutil status` output containing `Running = 1`.
- Produces (TS): `timeMachineState(s: TimeMachineStatus | null, now: Date): { show: boolean; tone: "success" | "warning" | "danger"; label: "running" | "last" | "never" }` — hidden when `null` or not enabled; running → tone of the previous backup, label `running`; no backup yet → warning, `never`; `last_result` not 0 and not running → danger; older than 7 days → danger; older than 2 days → warning; else success.
- Consumes: `latestSnapshot` (Task 6), `useActiveUpkeepItems()` filtered on `is_backup = 1` with `dueStateVariant`.

- [ ] **Step 1: Write the failing tests**

Rust: `migrates_to_010_adds_is_backup` in `migrate.rs` (like `migrates_to_009_adds_paperless`; `LATEST_VERSION` becomes 10); `parse_time_machine_reads_the_last_destination` (inline plist with two destinations, `LastDestinationID` pointing at the second, `SnapshotDates` with two dates → the newer one, `RESULT` 0); `parse_time_machine_without_snapshot_dates_has_no_last_backup` (shape of a first backup in progress: `RESULT` 26, no `SnapshotDates`); `parse_time_machine_auto_backup_off_is_disabled`.

TS `networkBackups.test.ts`: `timeMachineState` cases for 1 day (success), 3 days (warning), 8 days (danger), `last_result` 21 not running (danger), running with no backup yet (warning, `running`), disabled (hidden); `BackupsCard hides sources that are not set up`; `BackupsCard lists upkeep items marked as backups with their last done date`; `UpkeepItemForm saves the backup checkbox`.

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml time_machine && npx vitest run src/__tests__/networkBackups.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Migration, type and form field; the Rust parse and command; `BackupsCard` (`Card`, `HEADING_2` "Backups", one row each: "Time Machine" with "Running" / "Last {date}" / "No completed backup yet"; "NAS snapshots" with "Last {date}" and a `Tooltip` listing each share; each backup upkeep item with "Last {date}" or "Never done"); placed above `UpkeepDueCard` in the right column. Add the backup mark to the GUIDE section.

- [ ] **Step 4: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && npm test && npm run lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri src docs/GUIDE.md
git commit -m "feat(network): Backups card with Time Machine, NAS snapshots and manual copies"
```

---

### Task 8: Check on the real setup (with Loris)

Not code. Before the branch is merged, with Loris at the Mac, on the dev build:

- [ ] Settings › Behaviour › Network page on, in both organisations; Network appears under Agents.
- [ ] On the NAS machine, the links DSM, Paperless, Pi-hole, Uptime Kuma, Forgejo, FreshRSS, Homepage show dots; on the Mac mini, its Screen Sharing (`vnc://`) and Jump Desktop links open their app.
- [ ] Upkeep › connections › Sync now on the DS925+, then the NAS card shows the real volume and snapshot dates. If the shapes differ from the fixtures, save the real answers (secrets removed) as the fixtures and fix the parsers.
- [ ] In Personal Projects, the same cards, with "Updated … ago" from the studio organisation's last sync.
- [ ] Time Machine row matches `tmutil status`.
