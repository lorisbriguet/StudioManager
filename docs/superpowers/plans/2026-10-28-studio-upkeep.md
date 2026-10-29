# Studio Upkeep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Upkeep page (machines, recurring upkeep, consumables, subscriptions) whose reminders reach Apple
Calendar (with alerts) and the dashboard, with optional Synology DSM and Bambu Lab cloud connections.

**Architecture:** New per-org tables in migration 007. Pure scheduling logic in `src/lib/upkeep/` (unit
tested), SQLite queries and React Query hooks following the Resources/Expenses pattern, one page with four
tabs. Calendar alerts are added to the existing AppleScript bridge in `apple.rs`. Connections run in Rust
(`src-tauri/src/connectors/`) behind a trait, secrets in the macOS Keychain; the frontend schedules syncs and
stores readings.

**Tech Stack:** Tauri v2, Rust (rusqlite, new: `reqwest` with rustls, `keyring`), React + TypeScript,
TanStack Query, Zustand, Vitest, lucide-react.

**Spec:** [2026-10-28-studio-upkeep-design.md](../specs/2026-10-28-studio-upkeep-design.md) (read it with
this plan; section numbers below are the spec's). UI reference: the mockups linked in the spec, and
[DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md).

## Global Constraints

- macOS only; no network call unless the user added that connection (spec §4).
- Secrets only in the Keychain: service `ch.studiomanager.app`, account `<org id>:<connection id>`. Never in
  SQLite, backups, exports, logs, error messages, the MCP server.
- Every user-visible string through `useT()`, EN and FR keys in `src/i18n/ui.ts` (`i18nParity` test must pass).
- DESIGN-SYSTEM.md rules: tokens only, shared `Button`/`Badge`/`Input`/`Select`/`Modal`/`Card`/`Toggle`,
  lucide icons at the listed sizes, statuses via `src/lib/statusColors.ts`.
- New tables go in `src-tauri/migrations/007_upkeep.sql`, never in `ensureSchema()`.
- Every new table is listed in `TABLES` in `src/lib/backup.ts`, parents before children.
- Dates are local `YYYY-MM-DD` via `src/utils/localDate.ts` (`parseLocalDate`, `toLocalISO`).
- Any check that writes notifications captures `useOrgStore.getState().activeId` first and bails if it
  changed before writing (pattern in `src/hooks/useOverdueCheck.ts`).
- Test and presentation modes (`src/lib/modes.ts`): no connection sync, no upkeep notifications.
- Defaults pinned by the spec: due-soon window 14 days, warranty window 60 days, renewal alert 7 days
  before, connection failure notice after 3 days, sync on start + every 6 h, calendar event moves only
  when a usage forecast shifts ≥ 2 days, snooze choices 1/3/7 days.

## Review Focus

1. **App closed across several due dates or renewals.** On next start: one overdue notification per item
   (not per missed cycle), one pending renewal question per missed renewal, `renews_on` lands in the future.
   Tests: Task 5 `rollRenewals catches up three missed months`, Task 7 `overdue notifies once after a long
   gap`.
2. **Organisation switched while a check or sync runs.** Nothing is written into the newly opened org.
   Tests: Task 7 `skips writes when org changed`, Task 12 `sync result dropped after org switch`.
3. **Calendar unavailable** (sync off, Calendar permission denied, calendar renamed). Saving an item still
   works, the error is shown once, `calendar_event_id` stays null and is retried on the next edit. Test:
   Task 6 `save succeeds when calendar create fails`.
4. **Printer counter lower than the stored reading** (counter reset, wrong baseline typed, cloud history
   trimmed). Hours left never exceed `usage_every`, never go negative, no forecast date from negative use.
   Test: Task 2 `usage reading below last done is treated as zero use`.
5. **Month-end and leap-day intervals.** Done on Jan 31, every 1 month → Feb 28 → Mar 31; Feb 29 + 1 year
   → Feb 28. Test: Task 2 `addInterval keeps anchor day across short months`.

---

## File map

| Path | Responsibility |
|---|---|
| `src-tauri/migrations/007_upkeep.sql` | All new tables |
| `src/types/upkeep.ts` | Row types and enums for every new table |
| `src/lib/upkeep/schedule.ts` | Pure: next due, usage forecast, effective due, snooze, status |
| `src/lib/upkeep/renewals.ts` | Pure: subscription rollover |
| `src/lib/upkeep/notify.ts` | Pure: which notifications to emit |
| `src/lib/upkeep/templates.ts` | Built-in machine templates |
| `src/lib/upkeep/calendar.ts` | Sync one upkeep item / subscription to Apple Calendar |
| `src/lib/upkeep/connections.ts` | Frontend sync runner (calls Rust, stores readings) |
| `src/db/queries/machines.ts` | machines, machine_files, machine_projects, service_log |
| `src/db/queries/upkeepItems.ts` | upkeep_items, mark done, snooze |
| `src/db/queries/consumables.ts` | consumables, consumable_usage |
| `src/db/queries/subscriptions.ts` | subscriptions, subscription_renewals |
| `src/db/queries/connections.ts` | connections, machine_readings, machine_disks |
| `src/db/hooks/useUpkeep.ts` | All React Query hooks for the above (undo like `useResources.ts`) |
| `src/hooks/useUpkeepCheck.ts` | Start-up and periodic checks → notifications, rollovers, syncs |
| `src/pages/UpkeepPage.tsx` | Route `/upkeep`, tabs |
| `src/pages/MachinePage.tsx` | Route `/upkeep/machines/:id` full page |
| `src/components/upkeep/*` | Tabs, machine detail, forms, widget |
| `src-tauri/src/apple.rs` | Alert support on created events |
| `src-tauri/src/connectors/{mod,keychain,synology,bambu}.rs` | Connections |
| `src-tauri/mcp/src/read.rs`, `server.rs` | `list_machines`, upkeep in `whats_due` |
| `src/db/seeds/personas/*/data.sql` | Demo upkeep data |

---

### Task 1: Schema and types

**Files:**
- Create: `src-tauri/migrations/007_upkeep.sql`, `src/types/upkeep.ts`
- Modify: `src-tauri/src/migrate.rs` (add version 7, `LATEST_VERSION = 7`), `src/lib/backup.ts` (`TABLES`)
- Test: `src-tauri/src/migrate.rs` (existing `#[cfg(test)]` module), `src/__tests__/backupTables.test.ts`

**Interfaces:**
- Produces: tables below; TS types `Machine`, `MachineStatus`, `MachineFile`, `UpkeepItem`,
  `IntervalUnit`, `ServiceLogEntry`, `Consumable`, `ConsumableUsage`, `Subscription`,
  `SubscriptionRenewal`, `RenewalDecision`, `Connection`, `ConnectionKind`, `MachineReading`, `MachineDisk`,
  `DiskHealth`, `UpkeepAlert` (`'default' | 'none' | 'day_9am' | 'day_before' | 'week_before'`) in
  `src/types/upkeep.ts`, field names identical to the columns.

- [ ] **Step 1: Write the failing tests.** Rust: `migrates_to_007_creates_upkeep_tables` opens a temp DB, runs
  `migrate_db`, asserts each of the 12 tables exists and `MAX(version) = 7`. TS: `backupTables.test.ts`
  asserts every table in the list below is in `TABLES` and each appears after its parent (`machines` before
  `upkeep_items`, `service_log`, `machine_files`, `machine_projects`, `machine_readings`, `machine_disks`;
  `consumables` before `consumable_usage`; `subscriptions` before `subscription_renewals`; `connections`
  before `machines`).
- [ ] **Step 2: Run, expect FAIL.** `cd src-tauri && cargo test migrate` and `npx vitest run backupTables`.
- [ ] **Step 3: Write the migration.** Exact schema:

```sql
CREATE TABLE connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('synology','bambu_cloud')),
  label TEXT NOT NULL, host TEXT, port INTEGER, region TEXT, account TEXT,
  cert_fingerprint TEXT,
  last_sync_at TEXT, last_ok_at TEXT, last_error TEXT, failing_since TEXT, failing_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'generic', maker TEXT, model TEXT, serial TEXT, location TEXT,
  status TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('working','attention','broken','lent','retired')),
  lent_to TEXT, lent_until TEXT,
  purchase_date TEXT, supplier TEXT, price REAL, currency TEXT,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  warranty_until TEXT, warranty_notified_for TEXT, lifespan_years REAL, photo_path TEXT, notes TEXT, template_key TEXT,
  connection_id INTEGER REFERENCES connections(id) ON DELETE SET NULL, device_id TEXT, reading_baseline REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE machine_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  label TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('file','link')), path_or_url TEXT NOT NULL
);
CREATE TABLE machine_projects (
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (machine_id, project_id)
);
CREATE TABLE upkeep_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  title TEXT NOT NULL, notes TEXT,
  schedule TEXT NOT NULL CHECK (schedule IN ('interval','usage')),
  interval_n INTEGER, interval_unit TEXT CHECK (interval_unit IN ('day','week','month','year')), anchor_day INTEGER,
  usage_metric TEXT CHECK (usage_metric IN ('print_hours')), usage_every REAL,
  last_done_on TEXT, last_done_reading REAL, next_due_on TEXT, snooze_until TEXT,
  in_calendar INTEGER NOT NULL DEFAULT 1, alert TEXT NOT NULL DEFAULT 'default',
  calendar_event_id TEXT, calendar_event_date TEXT, overdue_notified_for TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE service_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  upkeep_item_id INTEGER REFERENCES upkeep_items(id) ON DELETE SET NULL,
  done_on TEXT NOT NULL, description TEXT NOT NULL, cost REAL,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL, reading REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE consumables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'pcs', stock REAL NOT NULL DEFAULT 0, reorder_level REAL NOT NULL DEFAULT 0,
  supplier TEXT, product_url TEXT, unit_price REAL, currency TEXT, low_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE consumable_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consumable_id INTEGER NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  used_on TEXT NOT NULL, amount REAL NOT NULL, cost REAL
);
CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, plan TEXT, vendor TEXT, url TEXT,
  renews_on TEXT NOT NULL, anchor_day INTEGER NOT NULL, period TEXT NOT NULL CHECK (period IN ('month','year')),
  cost REAL NOT NULL DEFAULT 0, currency TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  in_calendar INTEGER NOT NULL DEFAULT 1, alert TEXT NOT NULL DEFAULT 'week_before',
  calendar_event_id TEXT, coming_notified_for TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE subscription_renewals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  renewed_on TEXT NOT NULL, amount REAL NOT NULL, currency TEXT,
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','added','skipped')),
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL, notified INTEGER NOT NULL DEFAULT 0,
  UNIQUE (subscription_id, renewed_on)
);
CREATE TABLE machine_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  metric TEXT NOT NULL, value REAL NOT NULL, read_at TEXT NOT NULL
);
CREATE INDEX idx_machine_readings ON machine_readings(machine_id, metric, read_at);
CREATE TABLE machine_disks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  slot TEXT NOT NULL, model TEXT, serial TEXT NOT NULL, size_bytes INTEGER, power_on_hours INTEGER,
  health TEXT NOT NULL CHECK (health IN ('healthy','warning','failing')), notified_health TEXT,
  bad_sectors INTEGER, temperature REAL, first_seen TEXT NOT NULL, last_read_at TEXT NOT NULL,
  UNIQUE (machine_id, serial)
);
```

  `alert` values: `'default'` (use the Settings default), `'none'`, `'day_9am'`, `'day_before'`,
  `'week_before'`. The migration text must not contain `BEGIN`/`COMMIT` (the runner wraps it).
- [ ] **Step 4: Register version 7, add the 12 tables to `TABLES`, write `src/types/upkeep.ts`.**
- [ ] **Step 5: Run both tests, expect PASS.** Also `npx tsc --noEmit`.
- [ ] **Step 6: Commit** `feat(upkeep): schema and types`.

### Task 2: Scheduling logic

**Files:**
- Modify: `src/utils/recurringDates.ts`
- Create: `src/lib/upkeep/schedule.ts`
- Test: `src/__tests__/recurringDates.test.ts` (extend), `src/__tests__/upkeepSchedule.test.ts`

**Interfaces:**
- Produces:
  - `addInterval(dateISO: string, n: number, unit: IntervalUnit, anchorDay: number): string` in
    `recurringDates.ts` (existing `advanceDate` keeps working; it may call `addInterval`).
  - In `schedule.ts`:
    - `nextIntervalDue(item: Pick<UpkeepItem,'interval_n'|'interval_unit'|'anchor_day'>, fromISO: string): string`
    - `usageLeft(every: number, current: number, lastDone: number | null): number` (clamped to `[0, every]`)
    - `dailyUse(readings: {value: number; read_at: string}[], todayISO: string): number | null` (last 30 days;
      null when < 2 readings or no positive use)
    - `forecastUsageDue(left: number, perDay: number | null, todayISO: string): string | null`
    - `effectiveDue(item: UpkeepItem): string | null` (`snooze_until` wins over `next_due_on` while it's in the
      future or the item is still not done)
    - `dueState(item: UpkeepItem, todayISO: string, soonDays: number): 'overdue' | 'soon' | 'later' | 'none'`
    - `shouldMoveEvent(oldISO: string | null, newISO: string | null, schedule: 'interval' | 'usage'): boolean`
      (interval: any change; usage: |Δ| ≥ 2 days or null↔date)

- [ ] **Step 1: Write failing tests.** Including:
  - `addInterval keeps anchor day across short months`: `('2026-01-31',1,'month',31)` → `2026-02-28`; then
    `('2026-02-28',1,'month',31)` → `2026-03-31`; `('2028-02-29',1,'year',29)` → `2029-02-28`;
    `('2026-10-28',2,'week',28)` → `2026-11-11`; `('2026-10-28',10,'day',28)` → `2026-11-07`.
  - `usageLeft(200, 412, 230)` → `18`; `usage reading below last done is treated as zero use`:
    `usageLeft(200, 100, 230)` → `200`; `usageLeft(200, 900, 230)` → `0`.
  - `dailyUse` with readings 100 (30 days ago) and 160 (today) → `2`; one reading → `null`; flat → `null`.
  - `forecastUsageDue(18, 2, '2026-10-28')` → `'2026-11-06'`; `forecastUsageDue(18, null, …)` → `null`.
  - `effectiveDue` returns `snooze_until` when set and later than `next_due_on`.
  - `dueState`: due yesterday → `overdue`; in 14 days → `soon`; in 15 → `later`; no date → `none`.
  - `shouldMoveEvent('2026-11-06','2026-11-07','usage')` → `false`; `…'2026-11-08','usage'` → `true`;
    any change for `interval` → `true`.
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run upkeepSchedule recurringDates`
- [ ] **Step 3: Implement.** `forecastUsageDue` = today + `Math.ceil(left / perDay)` days.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(upkeep): scheduling logic`.

### Task 3: Machines and upkeep items data layer

**Files:**
- Create: `src/db/queries/machines.ts`, `src/db/queries/upkeepItems.ts`, `src/db/hooks/useUpkeep.ts`
- Test: `src/__tests__/upkeepQueries.test.ts` (mock DB pattern of `resourceTags.test.ts`)

**Interfaces:**
- Consumes: Task 1 types, Task 2 `nextIntervalDue`, `forecastUsageDue`.
- Produces (queries):
  - `getMachines(): Promise<Machine[]>`, `getMachine(id)`, `createMachine(data: MachineInput, items: UpkeepItemInput[]): Promise<number>`
    (machine + its template items in one `execute_batch`), `updateMachine(id, Partial<MachineInput>)`,
    `deleteMachine(id)`, `setMachineProjects(id, projectIds: number[])`, `getMachineFiles(id)`,
    `addMachineFile(id, f)`, `removeMachineFile(fileId)`, `getServiceLog(machineId)`,
    `addServiceLog(entry: Omit<ServiceLogEntry,'id'|'created_at'>)`, `getMachinesByProject(projectId)`.
  - `getUpkeepItems(machineId?: number)`, `getActiveUpkeepItems()` (not archived, machine not retired),
    `createUpkeepItem(data: UpkeepItemInput)`, `updateUpkeepItem(id, Partial<UpkeepItemInput>)`,
    `archiveUpkeepItem(id)`, `markUpkeepDone(id, doneOnISO: string, reading: number | null, note?: string): Promise<UpkeepItem>`
    (writes `service_log`, sets `last_done_on`/`last_done_reading`, recomputes `next_due_on`, clears
    `snooze_until` and `overdue_notified_for`, one batch), `snoozeUpkeep(id, days: 1 | 3 | 7, todayISO)`.
  - Hooks in `useUpkeep.ts` with query keys `["machines"]`, `["upkeep-items"]`, `["service-log", id]`; create,
    update, delete push undo entries like `useCreateResource`; every mutation invalidates `["upkeep-items"]`
    and `["machines"]`.
- [ ] **Step 1: Failing tests:** `markUpkeepDone on interval item writes log and moves next due`
  (item every 3 months, done 2026-10-28 → `next_due_on = 2027-01-28`); `markUpkeepDone on
  usage item stores reading`; `snooze sets snooze_until and clears overdue_notified_for`;
  `createMachine inserts template items`. Assert on `executedStatements`.
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run upkeepQueries`
- [ ] **Step 3: Implement queries and hooks.** Use `validateFields` for dynamic updates as `updateResource`
  does. Attached files are copied into the org data folder the way receipts are (`receipt_path` handling in
  expenses).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(upkeep): machines and upkeep items data layer`.

### Task 4: Consumables data layer

**Files:**
- Create: `src/db/queries/consumables.ts`; Modify: `src/db/hooks/useUpkeep.ts`
- Test: `src/__tests__/consumables.test.ts`

**Interfaces:**
- Produces: `getConsumables()` (sorted by `stock / NULLIF(reorder_level,0)` ascending), `createConsumable`,
  `updateConsumable`, `deleteConsumable`, `logConsumableUsage(id, amount, projectId | null, usedOnISO)`
  (cost = amount × current `unit_price`, stock −= amount, floor 0), `restockConsumable(id, amount)` (stock +=
  amount; resets `low_notified` to 0 when stock > reorder level), `getProjectMaterialCost(projectId):
  Promise<{ name: string; amount: number; unit: string; cost: number }[]>`, `isLow(c: Consumable): boolean`
  (`stock < reorder_level`).
- Restock never creates an expense itself; the UI (Task 10) opens the expense form prefilled.
- [ ] **Step 1: Failing tests:** `logUsage reduces stock and stores cost at current price`; `stock never
  below zero`; `restock above level resets low_notified`; `restock still below level keeps low_notified`.
- [ ] **Step 2–4: FAIL → implement → PASS.** `npx vitest run consumables`
- [ ] **Step 5: Commit** `feat(upkeep): consumables data layer`.

### Task 5: Subscriptions and renewals

**Files:**
- Create: `src/lib/upkeep/renewals.ts`, `src/db/queries/subscriptions.ts`; Modify: `src/db/hooks/useUpkeep.ts`
- Test: `src/__tests__/subscriptionRenewals.test.ts`

**Interfaces:**
- Consumes: `addInterval`.
- Produces:
  - `rollRenewals(sub: Subscription, todayISO: string): { renewedOn: string[]; nextRenewsOn: string }`
    (pure; active only; every `renews_on` ≤ today is one renewal; cancelled → none).
  - Queries: `getSubscriptions()`, `createSubscription`, `updateSubscription`, `cancelSubscription`,
    `applyRenewals(sub, todayISO): Promise<number>` (inserts one `subscription_renewals` row per
    `renewedOn` with `INSERT OR IGNORE`, updates `renews_on`, returns rows added),
    `getPendingRenewals(): Promise<(SubscriptionRenewal & { name: string })[]>`,
    `decideRenewal(id, decision: 'added' | 'skipped', expenseId?: number)`, `yearlyTotal(subs): Map<currency, number>`
    (month × 12, cancelled excluded).
- [ ] **Step 1: Failing tests:** `rollRenewals none before date`; `rollRenewals on the day renews once`;
  `rollRenewals catches up three missed months` (monthly, renews 2026-07-31, today 2026-10-28 →
  `['2026-07-31','2026-08-31','2026-09-30']`, next `2026-10-31`); `cancelled never renews`; `applyRenewals is
  idempotent` (second call adds 0); `yearlyTotal keeps currencies apart`.
- [ ] **Step 2–4: FAIL → implement → PASS.** `npx vitest run subscriptionRenewals`
- [ ] **Step 5: Commit** `feat(upkeep): subscriptions and renewals`.

### Task 6: Calendar alerts and upkeep events

**Files:**
- Modify: `src-tauri/src/apple.rs` (all-day + timed scripts take an alert offset), `src/lib/appleCalendar.ts`
- Create: `src/lib/upkeep/calendar.ts`
- Test: `src-tauri/src/apple.rs` tests, `src/__tests__/upkeepCalendar.test.ts`

**Interfaces:**
- Produces:
  - `calendar_create_event(..., alert_minutes: Option<i64>)`: when `Some(m)`, the script adds a display alarm
    with `trigger interval` = `m` (minutes relative to the event start; negative = before). Argv only, as now.
  - TS: `CalendarEvent.alertMinutes?: number | null`.
  - `alertMinutes(alert: UpkeepAlert, settingsDefault: Exclude<UpkeepAlert, 'default'>): number | null`
    (`'default'` resolves to `settingsDefault`):
    `day_9am` → `540`, `day_before` → `-900` (9:00 the day before), `week_before` → `-9540`, `none` → `null`.
  - `syncItemEvent(item: UpkeepItem, machine: Machine): Promise<Pick<UpkeepItem,'calendar_event_id'|'calendar_event_date'>>`:
    removes the event when calendar sync is off, the item is archived, `in_calendar` is 0, the machine is
    retired or there's no effective date; otherwise creates/moves when `shouldMoveEvent(item.calendar_event_date,
    effectiveDue(item), item.schedule)`. Title `"<item title> · <machine name>"`. On failure: `notifyError`
    once, returns ids unchanged (null on create).
  - `syncSubscriptionEvent(sub: Subscription)`: same for renewals, title `"<name> renews"`.
  - Hooks from Tasks 3 and 5 call these after every create/update/done/snooze/archive/delete and on machine
    status change; `deleteMachine` deletes all its items' events first.
- [ ] **Step 1: Failing tests.** Rust: `allday_script_has_alarm_branch` (script contains `display alarm`,
  argv count 7). TS: `alertMinutes maps every option`; `removes event when machine retired`;
  `does not move usage event for 1-day shift`; `save succeeds when calendar create fails` (mock invoke rejects
  → returns `calendar_event_id: null`, `notifyError` called once).
- [ ] **Step 2: Run, expect FAIL.** `cd src-tauri && cargo test apple` and `npx vitest run upkeepCalendar`
- [ ] **Step 3: Implement.** Verify the AppleScript alarm syntax against Calendar on a real Mac (spec §12)
  before finishing; `updateCalendarEvent` passes `alertMinutes` through.
- [ ] **Step 4: Run, expect PASS**, plus `npx vitest run appleCalendarSync` (no regression for tasks).
- [ ] **Step 5: Commit** `feat(upkeep): calendar alerts and upkeep events`.

### Task 7: Checks and notifications

**Files:**
- Create: `src/lib/upkeep/notify.ts`, `src/hooks/useUpkeepCheck.ts`
- Modify: the component that mounts `useOverdueCheck` (mount `useUpkeepCheck` next to it), `src/i18n/ui.ts`
- Test: `src/__tests__/upkeepNotify.test.ts`, `src/__tests__/upkeepCheck.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–5 queries, `createNotification`.
- Produces:
  - `planNotifications(input: { items: UpkeepItem[]; machines: Machine[]; consumables: Consumable[];
    subs: Subscription[]; pendingRenewals: SubscriptionRenewal[]; disks: MachineDisk[];
    connections: Connection[]; todayISO: string; windows: { warrantyDays: number; renewalDays: number } }):
    PlannedNotice[]` where `PlannedNotice = { cause: 'overdue' | 'low_stock' | 'disk' | 'warranty' |
    'renewal_coming' | 'renewal_happened' | 'connection'; refId: number; marker: string; title: string;
    message: string; link: string }`. `marker` is what gets stored so the same notice never repeats
    (spec §7 table): overdue → effective due date into `overdue_notified_for`; low stock → `low_notified=1`;
    disk → health into `notified_health`; warranty → `warranty_until` into `warranty_notified_for`;
    renewal coming → `renews_on` into `coming_notified_for`; renewal happened → `notified=1` on that
    `subscription_renewals` row; connection → `failing_notified=1` after 3 days of `failing_since`.
  - `runUpkeepCheck(qc: QueryClient, todayISO: string): Promise<number>`: applies renewals (Task 5) and
    calls `syncSubscriptionEvent` for each rolled subscription (Task 6),
    plans notices, writes each with its marker in one batch, invalidates `["notifications"]`,
    `["upkeep-items"]`, `["subscriptions"]`. Skipped in test/presentation mode.
  - `useUpkeepCheck()`: runs on mount and on window focus at most once per hour.
- [ ] **Step 1: Failing tests:** one per row of the spec §7 table that it fires once and not twice;
  `overdue notifies once after a long gap` (due 3 cycles ago → one notice); `retired machine's items never
  notify`; `skips writes when org changed` (org id changes during the run → no `createNotification`);
  `no notices in test mode`.
- [ ] **Step 2–4: FAIL → implement → PASS.** `npx vitest run upkeepNotify upkeepCheck`
- [ ] **Step 5: Commit** `feat(upkeep): checks and notifications`.

### Task 8: Upkeep page shell, sidebar, Overview tab

**Files:**
- Create: `src/pages/UpkeepPage.tsx`, `src/components/upkeep/OverviewTab.tsx`, `src/components/upkeep/DueList.tsx`
- Modify: `src/App.tsx` (route `upkeep`, `upkeep/machines/:id`), `src/components/layout/Sidebar.tsx`
  (`{ to: "/upkeep", icon: Wrench, labelKey: "upkeep" }` after Resources, red count badge), `src/i18n/ui.ts`
- Test: `src/__tests__/upkeepOverview.test.tsx`, `src/__tests__/Sidebar.test.tsx` (extend)

**Interfaces:**
- Produces: `useUpkeepOverview(): { due: DueRow[]; lowStock: Consumable[]; endingSoon: {kind:'warranty'|'renewal'; name: string; date: string}[]; replacements: { machine: Machine; year: number }[]; overdueCount: number }`
  in `useUpkeep.ts`; `DueRow = { item: UpkeepItem; machine: Machine; due: string | null; state: ReturnType<typeof dueState>; left?: number }`.
  `DueList` (props `rows: DueRow[]`, `compact?: boolean`) is reused by the dashboard widget (Task 11).
- Tabs: Overview, Machines, Consumables, Subscriptions, kept in the URL (`?tab=`). Layout as mockup
  screen 1. Replacement year = `purchase_date` year + `ceil(lifespan_years)`; shown when ≤ next year.
- [ ] **Step 1: Failing tests:** overdue rows first then by date; mark done calls `markUpkeepDone`; snooze
  menu offers 1/3/7 days; sidebar badge shows overdue count and is hidden at 0.
- [ ] **Step 2–4: FAIL → implement → PASS.** `npx vitest run upkeepOverview Sidebar i18nParity`
- [ ] **Step 5: Commit** `feat(upkeep): page shell and overview`.

### Task 9: Machines tab, machine detail, templates

**Files:**
- Create: `src/lib/upkeep/templates.ts`, `src/components/upkeep/MachinesTab.tsx`,
  `src/components/upkeep/MachineDetail.tsx` (used by peek panel and `MachinePage`),
  `src/components/upkeep/MachineForm.tsx`, `src/components/upkeep/UpkeepItemForm.tsx`, `src/pages/MachinePage.tsx`
- Modify: `src/i18n/ui.ts`
- Test: `src/__tests__/upkeepTemplates.test.ts`, `src/__tests__/machineDetail.test.tsx`

**Interfaces:**
- Produces: `MACHINE_TEMPLATES: MachineTemplate[]`, `MachineTemplate = { key: 'nas' | 'printer_3d' |
  'printer_photo' | 'monitor' | 'camera' | 'computer' | 'generic'; icon: LucideIcon; items:
  { titleKey: UIKey; schedule: 'interval' | 'usage'; interval_n?: number; interval_unit?: IntervalUnit;
  usage_every?: number }[] }`. Content per spec §9: NAS (restore test 3 months, system update 1 month,
  backup logs 1 month, filters and fans 6 months); 3D printer (nozzle + rods 200 h, build plate 50 h, belts
  6 months); the rest chosen by the builder, at least one item each except generic.
- Machine form: picking a template lists its items with checkboxes and editable intervals before save.
- Detail sections per spec §5 and mockup screen 2: facts, schedule (with "In calendar" `Toggle`),
  readings (a slot for `ReadingsSection` from Task 12; render "No connection" until then), files & links,
  service log, linked projects. The form takes a photo (copied into the org data folder like attached files)
  and uses the existing unsaved-changes guard and undo.
  Price row: "Link expense" (picker over existing expenses) or "Create expense" (expense form prefilled with
  supplier, amount, date). "Lent out" asks for `lent_to` and `lent_until`.
- [ ] **Step 1: Failing tests:** `every template item has EN and FR text`; `usage items only on templates
  with a usage metric`; detail renders overdue badge; toggling "In calendar" calls `updateUpkeepItem`
  with `in_calendar: 0`; setting status Retired shows the "reminders stop" note.
- [ ] **Step 2–4: FAIL → implement → PASS.** `npx vitest run upkeepTemplates machineDetail i18nParity`
- [ ] **Step 5: Commit** `feat(upkeep): machines tab, detail and templates`.

### Task 10: Consumables and Subscriptions tabs

**Files:**
- Create: `src/components/upkeep/ConsumablesTab.tsx`, `src/components/upkeep/SubscriptionsTab.tsx`,
  `src/components/upkeep/ConsumableForm.tsx`, `src/components/upkeep/SubscriptionForm.tsx`
- Modify: `src/i18n/ui.ts`
- Test: `src/__tests__/consumablesTab.test.tsx`, `src/__tests__/subscriptionsTab.test.tsx`

**Interfaces:**
- Consumes: Tasks 4–5.
- Consumables tab per mockup screen 3: low-stock banner, table, "Reorder" opens `product_url` with the
  shell plugin (hidden when empty), "Log usage" (amount, optional project), "Restock" (amount, then offers
  the prefilled expense form).
- Subscriptions tab: table, yearly total per currency, pending renewals on top as rows "Renewed · add
  <amount> to expenses?" with Add (prefilled expense form; on save `decideRenewal(id,'added',expenseId)`) and
  Skip (`decideRenewal(id,'skipped')`).
- [ ] **Step 1: Failing tests:** banner counts low items; Reorder hidden without URL; Add on a pending
  renewal opens the expense form with vendor, amount and date filled; cancelling that form leaves the
  renewal pending; Skip marks it skipped.
- [ ] **Step 2–4: FAIL → implement → PASS.** `npx vitest run consumablesTab subscriptionsTab i18nParity`
- [ ] **Step 5: Commit** `feat(upkeep): consumables and subscriptions tabs`.

### Task 11: Dashboard widget, Calendar page, project block, Settings card

**Files:**
- Modify: `src/stores/dashboard-store.ts` (`WidgetType` `"upkeep"`, catalog entry category `"utility"`,
  `defaultW: 3, defaultH: 4`, in `DEFAULT_WIDGETS`/`DEFAULT_LAYOUT`), `src/components/dashboard/widgets.tsx`
  (`renderWidget` case), the Calendar page events source, `src/components/ProjectBlockLayout.tsx` (block
  `"equipment"`), `src/pages/SettingsPage.tsx` (Upkeep card), `src/stores/app-store.ts` (`upkeepAlertDefault`,
  `upkeepSoonDays` 14, `warrantyWindowDays` 60, `renewalWindowDays` 14), `src/i18n/ui.ts`
- Create: `src/components/upkeep/UpkeepWidget.tsx`, `src/components/upkeep/EquipmentBlock.tsx`
- Test: `src/__tests__/upkeepWidget.test.tsx`, `src/__tests__/equipmentBlock.test.tsx`

**Interfaces:**
- Consumes: `useUpkeepOverview`, `DueList`, `getMachinesByProject`, `getProjectMaterialCost`, `getPendingRenewals`.
- Widget sections: due (DueList compact, mark done inline), low stock, renewals within window and pending
  renewal questions. Empty → one quiet line.
- Calendar page: upkeep (teal tag colour) and renewals (indigo) as events with filter chips, as mockup 4.
- [ ] **Step 1: Failing tests:** widget lists overdue first and hides empty sections; equipment block sums
  material cost per currency; Settings card writes `upkeepAlertDefault`.
- [ ] **Step 2–4: FAIL → implement → PASS.** `npx vitest run upkeepWidget equipmentBlock i18nParity`
- [ ] **Step 5: Commit** `feat(upkeep): dashboard widget, calendar, project block, settings`.

### Task 12: Connections core (Rust + frontend runner)

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `reqwest` with `rustls-tls`, `json`; `keyring` with the macOS backend),
  `src-tauri/src/lib.rs` (register commands)
- Create: `src-tauri/src/connectors/mod.rs`, `src-tauri/src/connectors/keychain.rs`,
  `src/db/queries/connections.ts`, `src/lib/upkeep/connections.ts`, `src/components/upkeep/ConnectionsCard.tsx`,
  `src/components/upkeep/ReadingsSection.tsx` (machine detail: disks with health and age bar, print hours,
  last sync and error, "Sync now"; a "Current reading" input when the machine has a usage item and no
  connection)
- Test: Rust unit tests in `connectors/mod.rs`; `src/__tests__/connectionsRunner.test.ts`

**Interfaces:**
- Produces (Rust):
  - `trait Connector { fn test(&self) -> Result<DeviceList, String>; fn sync(&self) -> Result<SyncResult, String>; }`
  - `struct SyncResult { devices: Vec<DeviceReading> }`,
    `struct DeviceReading { device_id: String, model: Option<String>, metrics: Vec<(String, f64)>, disks: Vec<DiskReading> }`,
    `struct DiskReading { slot: String, model: Option<String>, serial: String, size_bytes: Option<i64>, power_on_hours: Option<i64>, health: String, bad_sectors: Option<i64>, temperature: Option<f64> }`.
  - Commands: `connection_save_secret(org: String, id: i64, secret: String)`,
    `connection_delete_secret(org, id)`, `connection_test(org, id, kind, config: serde_json::Value)
    -> Result<DeviceList, String>`, `connection_sync(org, id, kind, config) -> Result<SyncResult, String>`.
    Config never contains the secret; Rust reads it from the Keychain. Error strings must not contain the
    secret or tokens (test it).
- Produces (TS):
  - Queries: `getConnections`, `createConnection`, `updateConnection`, `deleteConnection` (also deletes
    the secret), `recordSync(id, ok: boolean, error?: string)` (sets `failing_since` on first failure, clears
    it and `failing_notified` on success), `storeReadings(machine: Machine, r: DeviceReading, readAtISO)`
    (inserts `machine_readings`, upserts `machine_disks` by serial keeping `first_seen`),
    `currentReading(machineId, metric): Promise<number | null>` (latest value + `reading_baseline`).
  - `runConnectionSyncs(qc, opts: { force?: boolean }): Promise<void>`: per connection, skips when synced
    < 6 h ago unless `force`; calls `connection_sync`, stores readings for each machine whose
    `(connection_id, device_id)` matches, recomputes usage items' forecasts and calls `syncItemEvent`.
    Captures the active org first and drops results if it changed. Not in test/presentation mode.
  - `useUpkeepCheck` (Task 7) calls `runConnectionSyncs` on start and every 6 h while open.
  - `ConnectionsCard` in Settings › Upkeep: list, add (per-kind form from Tasks 13/14), Test, Sync now,
    Remove; shows last sync and error.
- [ ] **Step 1: Failing tests.** Rust: `error_message_never_contains_secret`; `keychain_account_is_org_and_id`
  (`"6kun0b:3"`). TS: `failing_since set once and kept`; `success clears failing state`; `storeReadings keeps
  first_seen on upsert`; `sync result dropped after org switch`; `skips sync within 6 hours`.
- [ ] **Step 2–4: FAIL → implement → PASS.** `cd src-tauri && cargo test connectors` and
  `npx vitest run connectionsRunner`
- [ ] **Step 5: Commit** `feat(upkeep): connections core`.

### Task 13: Synology DSM connector

**Files:**
- Create: `src-tauri/src/connectors/synology.rs`, `src-tauri/src/connectors/fixtures/synology_*.json`,
  `src/components/upkeep/SynologyForm.tsx`
- Modify: `src-tauri/src/connectors/mod.rs`, `src/i18n/ui.ts`
- Test: Rust tests in `synology.rs` against fixtures

**Interfaces:**
- Consumes: Task 12 trait and types.
- Config: `{ host: string, port: number, account: string, cert_fingerprint?: string }`; secret = password
  plus DSM device token after first login (stored as one JSON blob in the Keychain).
- Behaviour per spec §8: HTTPS only; when the certificate isn't trusted by the system, `connection_test`
  returns `Err("untrusted_cert:<sha256 fingerprint>")`; the form shows it and on confirm stores
  `cert_fingerprint`; requests then accept exactly that certificate. 2-step code: `Err("otp_required")` →
  form asks for the code, retries with it, stores the device token. Readings: one `DeviceReading` with
  `device_id` = NAS serial, disks mapped to `DiskReading` (`health`: DSM normal → `healthy`, warning/
  degraded → `warning`, failing/crashed → `failing`).
- First, capture real DSM responses for login, system info and storage load (spec §12) and save them,
  scrubbed of serials and tokens, as fixtures.
- [ ] **Step 1: Failing tests:** `parses_storage_fixture_into_disks` (count, slots, health mapping);
  `maps_dsm_status_values`; `untrusted_cert_error_carries_fingerprint`; `otp_required_detected`.
- [ ] **Step 2–4: FAIL → implement → PASS.** `cd src-tauri && cargo test synology`
- [ ] **Step 5: Manual check** against a real NAS: add the connection, link a machine, Sync now shows
  disks on the machine detail. Note the DSM version tested in the commit message.
- [ ] **Step 6: Commit** `feat(upkeep): Synology DSM connector`.

### Task 14: Bambu Lab cloud connector

**Files:**
- Create: `src-tauri/src/connectors/bambu.rs`, `src-tauri/src/connectors/fixtures/bambu_*.json`,
  `src/components/upkeep/BambuForm.tsx`
- Modify: `src-tauri/src/connectors/mod.rs`, `src/i18n/ui.ts`
- Test: Rust tests in `bambu.rs` against fixtures

**Interfaces:**
- Consumes: Task 12.
- Config: `{ region: 'global' | 'china', account: string }`; secret = token (password used once at sign-in,
  never stored). Email code: `Err("code_required")` → form asks, retries.
- Readings: one `DeviceReading` per bound printer, `device_id` = printer serial, metric
  `print_hours` = sum of finished task durations since `connections.created_at`, in hours. Linking a machine
  asks for `reading_baseline` (the printer's own counter today) and shows a one-line explanation.
- Any parse or HTTP error → `Err` with a user-readable message; the UI keeps manual entry working
  (spec §8, "unofficial API").
- [ ] **Step 1: Failing tests:** `sums_finished_task_durations` (cancelled/failed tasks excluded, only after
  the start date); `lists_bound_printers`; `unexpected_shape_is_error_not_panic`; `code_required_detected`.
- [ ] **Step 2–4: FAIL → implement → PASS.** `cd src-tauri && cargo test bambu`
- [ ] **Step 5: Manual check** with a real account (P2S): link, sync, hours appear, usage item shows
  "h left" and a forecast date.
- [ ] **Step 6: Commit** `feat(upkeep): Bambu Lab cloud connector`.

### Task 15: Demo data, agent access, docs

**Files:**
- Modify: `src/db/seeds/personas/designer/data.sql`, `src/db/seeds/personas/music/data.sql`,
  `src-tauri/mcp/src/read.rs`, `src-tauri/mcp/src/server.rs`, `README.md`, `docs/GUIDE.md`, `IDEAS.md`,
  [the spec](../specs/2026-10-28-studio-upkeep-design.md) (status line)
- Test: `src/__tests__/presentationSeed.test.ts` (extend), MCP tests in `read.rs`

**Interfaces:**
- MCP: `DueItem.kind` gains `"upkeep"` (title `"<item> · <machine>"`, project/client empty); new tool
  `list_machines(org)` → `[{ id, name, kind, status, location, next_upkeep: { title, due } | null }]`.
  Read-only, behind the existing agent access switch, no secrets, no readings history.
- Seeds: 4 machines (NAS, 3D printer, monitor, camera lent out), items covering overdue / soon / later /
  usage, 3 consumables (one low), 3 subscriptions (one with a pending renewal), fake readings and disks
  (one `warning`), no connections.
- Docs: README "Studio upkeep" feature section; GUIDE tour step; IDEAS entry for later connectors (LAN-only
  Bambu, Prusa, UniFi). Markdown files link to each other with relative links.
- [ ] **Step 1: Failing tests:** `whats_due_includes_upkeep_items`; `retired_machine_items_not_due`;
  `list_machines_has_next_upkeep`; seed test asserts upkeep tables are non-empty for the designer persona.
- [ ] **Step 2–4: FAIL → implement → PASS.** `cd src-tauri/mcp && cargo test` and
  `npx vitest run presentationSeed`
- [ ] **Step 5: Full check:** `npm test`, `npx tsc --noEmit`, `npm run lint`, `cd src-tauri && cargo test`.
- [ ] **Step 6: Commit** `feat(upkeep): demo data, agent access, docs`.
