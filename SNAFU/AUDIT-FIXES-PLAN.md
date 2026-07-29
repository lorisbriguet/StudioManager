# Audit Fixes — Critical / High / Medium Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all Critical, High, and Medium findings from the 2026-07-20 full audit (data integrity, invoice correctness, silent failures, security scope, date/time bugs, timer/undo robustness), verified by tests.

**Architecture:** Surgical fixes to existing modules — no refactors of the invoice/quote duplication, no queryKeys migration, no ensureSchema consolidation (deferred). New code follows existing patterns: raw SQL in `src/db/queries/`, React Query hooks in `src/db/hooks/`, pure helpers in `src/lib/` with vitest tests using the existing Tauri mocks.

**Tech Stack:** Tauri v2 (Rust), React 19 + TypeScript strict, TanStack Query, Zustand, SQLite, vitest + happy-dom (mocks already configured in `vitest.config.ts`).

**User decisions (locked):**
1. Invoice deletion NEVER renumbers other invoices — gaps in the sequence are accepted. Additionally: only DRAFT invoices can be deleted; sent/paid/overdue invoices can only be cancelled (prevents any reference reuse).
2. Quick Timer keeps Cmd+Shift+T; reopen-closed-tab moves to Cmd+Shift+Y.
3. Tauri `fs:scope` narrows to `$APPDATA/**`, `$DOCUMENT/**`, `$DOWNLOAD/**`, `$DESKTOP/**`.
4. QR-bill is CHF-only: non-CHF invoices must render NO QR code section at all.

**Environment constraints (IMPORTANT for executors):**
- Project root: `/Users/loris.briguet/Library/CloudStorage/SynologyDrive-02_SD/03_Projects/2026/StudioManager`
- The project lives on a Synology cloud drive: file access can be slow; `git` commands can hang for minutes. **Do NOT run git commands.** No per-step commits — the user will commit manually at the end.
- Run targeted tests only (`npx vitest run src/__tests__/<file>.test.ts`), never the full suite mid-task. Full suite + `npx tsc --noEmit` run once in the final task.
- Do not run `npm run tauri dev` or any build; the human runs the app at the end.
- **Always Read a file before editing it.** Line numbers below come from the audit and may drift as tasks land — treat them as pointers, not gospel.
- All new user-visible strings must be added to BOTH the EN and FR sections of `src/i18n/ui.ts` and used via `useT()` (see `DESIGN-SYSTEM.md`).

---

## Group A — Backup/Restore (Critical C1, C2, C3, M-restore-FK)

### Task 1: Quote-aware CSV parser + serializer round-trip

**Files:**
- Modify: `src/lib/backup.ts` (export at ~:63-70, `parseCsv` at ~:208-215)
- Create: `src/__tests__/backupCsv.test.ts`

Problem: export quotes fields containing `\n`, but `parseCsv` does `csv.split("\n")` *before* unquoting, so one multi-line `notes` field corrupts every following row.

- [ ] **Step 1: Write failing tests** — extract/export a pure `serializeCsv(rows: Record<string, unknown>[], columns: string[]): string` and `parseCsv(csv: string): { columns: string[]; rows: (string | null)[][] }` (export them from `backup.ts`). NULL sentinel scheme (this is the contract Task 2 builds on): SQL `null`/`undefined` serializes as an *unquoted* empty field and parses back to `null`; a real empty string serializes as the *quoted* empty field `""` and parses back to `""`. Tests must cover: value with `\n`, value with `"` (escaped as `""`), value with `,`, the null-vs-empty-string distinction round-tripping both ways, unicode, and a full serialize→parse round-trip equality over 3 rows × 5 columns.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/backupCsv.test.ts` — expect FAIL (multi-line case).
- [ ] **Step 3: Implement** a character-walking RFC-4180 parser (state machine: in-quotes / out-of-quotes; `""` → literal quote; newlines inside quotes are data; accept both `\n` and `\r\n`). Keep the existing quoting rules on serialize (quote when value contains `,`, `"`, `\n`, or `\r`).
- [ ] **Step 4: Run the test file** — expect PASS.
- [ ] **Step 5: Verify no other caller of the old parse behavior breaks** (grep `parseCsv` usages in `src/`).

### Task 2: Restore must not convert empty strings to NULL

**Files:**
- Modify: `src/lib/backup.ts` (restore mapping at ~:326-337)
- Test: extend `src/__tests__/backupCsv.test.ts`

Problem: restore maps CSV `""` → `null`; schema is full of `TEXT NOT NULL DEFAULT ''` columns (e.g. `client_contacts.first_name`), so those rows throw and are silently skipped.

- [ ] **Step 1:** The null-vs-empty sentinel scheme is already implemented by Task 1 (unquoted empty = `null`, quoted `""` = empty string). This task fixes the RESTORE side to use it correctly. Read the restore mapping code first.
- [ ] **Step 2: Write failing test:** restore-mapping of a parsed row containing both a quoted-empty and an unquoted-empty field yields `""` and `null` respectively (today both become `null`).
- [ ] **Step 3: Implement nullability-aware value mapping — resolved UP-FRONT, not retry-on-failure** (the whole restore later runs inside ONE `TransactionBatch` (Task 3), which aborts atomically on the first failed statement — per-row retry/skip inside it is impossible). Before building the insert batch for each table, query `SELECT name, "notnull", dflt_value FROM pragma_table_info('<table>')`; for any column with `notnull = 1`, substitute an incoming `null` with the column's declared default (parse `dflt_value` when it is a simple literal like `''`, `0`, or a quoted string; if `dflt_value` is NULL/missing or a non-literal expression such as `(datetime('now'))`, substitute by type affinity instead: `''` for TEXT, `0` for INTEGER/REAL — never insert the raw expression text) — this also transparently handles OLD backups where every empty field parses as `null`. Count substitutions and report them in the completion toast (add i18n keys `restore_values_defaulted` EN/FR); never silently skip a row.
- [ ] **Step 4: Run test file** — PASS.

### Task 3: Back up ALL tables; restore in FK-safe order inside a real transaction

**Files:**
- Modify: `src/lib/backup.ts` (`TABLES` at ~:35-49, restore at ~:301-345)
- Reference: `src-tauri/migrations/001_initial_schema.sql`, `005_consolidate_schema.sql`, and `src/db/index.ts` `ensureSchema` (tables also created at runtime!)
- Test: extend `src/__tests__/backupCsv.test.ts` (table-list completeness check)

Problem: only 13 tables backed up — `income`, `time_entries`, `client_addresses`, `recurring_invoice_templates`, `invoice_templates`, `resources`, `resource_projects`, wiki tables, `custom_lists`, `project_tables`, `project_table_rows`, `saved_filters`, etc. are lost on restore. Also `PRAGMA foreign_keys OFF/ON` via the pooled plugin connection may hit different connections (documented in `src/db/index.ts:22-27`).

- [ ] **Step 1: Enumerate every user-data table**: Read `001_initial_schema.sql`, `002-005` migrations, AND `ensureSchema` in `src/db/index.ts` (it creates tables at runtime). Build the complete list, ordered parents-before-children (clients → client_contacts/client_addresses → projects → tasks → subtasks/time_entries → invoices → invoice_line_items → quotes → quote_line_items → income/expenses/resources/resource_projects/recurring_invoice_templates/invoice_templates/custom_lists/project_tables → project_table_rows → wiki/saved_filters/notifications/settings…). Exclude purely-derived/ephemeral tables only if genuinely regenerable — when in doubt, include.
- [ ] **Step 2: Write failing test:** import `TABLES` and assert it contains at least ALL of: `income`, `time_entries`, `client_addresses`, `recurring_invoice_templates`, `invoice_templates`, `resources`, `resource_projects`, `resource_tags`, `custom_lists`, `custom_list_items`, `project_tables`, `project_table_rows`, `saved_filters`, `wiki_folders`, `wiki_articles`, `wiki_article_tags`, `dashboard_presets`, `workload_templates` (plus the existing 13). The test is the enforcement mechanism — pin the full list; verify each exact table name against `ensureSchema`/migrations while enumerating in Step 1 (names above come from the audit and must be corrected to the real schema names if they differ).
- [ ] **Step 3: Update `TABLES`** (export order = restore order, parent-first). Update the delete-before-restore loop to iterate the REVERSED list (children first).
- [ ] **Step 4: Wrap restore in `TransactionBatch`** (see `src/db/index.ts:28-42` and usage in `src/db/queries/customLists.ts`) so delete+insert is atomic on ONE connection, with `PRAGMA defer_foreign_keys = ON` as the first statement of the batch (valid inside a transaction; avoids the pooled-connection pragma bug). Remove the old `PRAGMA foreign_keys OFF/ON` calls.
- [ ] **Step 5: Run test file** — PASS. Also grep for any UI listing backup contents (Settings) that hardcodes the old table count.

---

## Group B — Invoice integrity (Critical: QR currency, renumbering; High: edit-recompute, rate fallback, rounding, stale finance)

### Task 4: QR-bill renders ONLY for CHF invoices

**Files:**
- Modify: `src/components/invoice/InvoicePDF.tsx` (QR section at ~:279)
- Check also: `src/components/invoice/QRBillSvgRenderer.tsx`, `src/components/invoice/qr-bill.ts`, `src/pages/InvoicePreviewPage.tsx`, `src/components/invoice/TemplateEditor.tsx` (any other render site)
- Test: extend `src/__tests__/qrBill.test.ts`

- [ ] **Step 1: Write failing test** for a new exported guard `shouldRenderQrBill(invoice: {currency: string}, profile: {iban?: string|null}, showQrBill: boolean): boolean` in `qr-bill.ts`: true only when `currency === "CHF"` AND iban present AND toggle on; false for EUR/USD/GBP even with iban+toggle.
- [ ] **Step 2: Implement the guard**; replace the inline condition at every QR render site (grep for the QR component name across `src/`). The non-CHF PDF must show no QR section, no payment-part placeholder, and page layout must still be valid (read surrounding layout code).
- [ ] **Step 3: Run** `npx vitest run src/__tests__/qrBill.test.ts` — PASS.

### Task 5: Invoice deletion — drafts only, never renumber, no reference reuse

**Files:**
- Modify: `src/db/queries/invoices.ts` (`deleteInvoice` ~:166-177, `reindexInvoiceReferences` ~:178-194)
- Modify: `src/pages/InvoicesPage.tsx` (context-menu + bulk delete), `src/db/hooks/useInvoices.ts` (delete mutation guard)
- Modify: `src/i18n/ui.ts` (keys EN+FR: `invoice_delete_only_drafts`)
- Test: create `src/__tests__/invoiceDelete.test.ts` (pure-logic level; DB layer is mocked via `src/__mocks__/tauri-sql.ts` — read that mock first to see what's testable; if SQL-level assertion isn't feasible, assert `deleteInvoice` issues no UPDATE on other rows by inspecting the mock's executed-SQL log)

**User decision:** only `draft` invoices are deletable. Sent/paid/overdue invoices must be cancelled instead (VOID overlay already exists). This removes both renumbering AND tail-reference reuse (deleting the highest-numbered sent invoice can never free its number, because it can't be deleted).

- [ ] **Step 1: Read** `deleteInvoice`, `reindexInvoiceReferences`, and `src/lib/referenceGenerator.ts`. Confirm new references come from MAX+1 (or the year's max), not COUNT — if COUNT-based, change to MAX-based so gaps don't cause duplicate references. This is essential once gaps exist.
- [ ] **Step 2:** Remove the `reindexInvoiceReferences` call from `deleteInvoice`. Delete the function if it has no other callers (grep). Quotes: read `src/db/queries/quotes.ts` — if a sibling reindex exists, remove it too (quote deletion rules stay otherwise unchanged; quotes are not accounting documents).
- [ ] **Step 3: Enforce draft-only deletion** at BOTH layers: `deleteInvoice` throws if the invoice's status is not `draft` or `cancelled`-from-draft — read the status model first; the rule is "an invoice that ever had a real (non-DRAFT-) reference cannot be deleted", which is cheap to check via the reference prefix. UI: InvoicesPage hides/disables Delete in the context menu and bulk bar for non-deletable invoices and shows `toast.error(t.invoice_delete_only_drafts)` if attempted.
- [ ] **Step 4:** Write/adjust tests: (a) reference generation returns max+1 with a gapped sequence (2026-001, 2026-003 → next is 2026-004); (b) `deleteInvoice` rejects an invoice with a real reference.
- [ ] **Step 5: Run the new test file** — PASS. Note for Task 13 Step 6: the undoable-delete toast for invoices applies to draft deletions only.

### Task 6: Editing an invoice/quote preserves stored financials

**Files:**
- Modify: `src/pages/InvoiceFormPage.tsx` (~:115-119 load, ~:212-238 derive effects, ~:258 due date)
- Modify: `src/pages/QuoteFormPage.tsx` (discount, ~:147-150)

Problems: (a) edit-load triggers the `[currency]` effect which overwrites the stored historical `exchange_rate`/`chf_equivalent` with today's rate; (b) `discountRate` is re-derived from the client's CURRENT `has_discount` instead of the invoice's stored `discount_rate`; (c) `save()` recomputes `due_date = invoice_date + 30` ignoring stored `payment_terms_days`.

- [ ] **Step 1: Read both form pages fully** (they are ~730/460 lines). Map the effect chain: load → setCurrency → effect fetches rate → overwrites.
- [ ] **Step 2: Fix (a):** introduce a ref/flag distinguishing "currency set by form load" from "currency changed by user" (e.g. `hydratingRef` set true during load, cleared after; the `[currency]` effect early-returns while hydrating). When editing an existing invoice, `exchangeRate` and `chfEquivalent` initialize from the stored row and are only recomputed if the USER changes currency or explicitly clears the manual override.
- [ ] **Step 3: Fix (b):** when editing, initialize `discountRate` from the loaded invoice's stored `discount_rate`; only derive from `selectedClient.has_discount` when creating new OR when the user changes the client. Same in `QuoteFormPage`.
- [ ] **Step 4: Fix (c):** on edit, keep the loaded `due_date` unless the user changes `invoice_date` or payment terms; on create, honor `payment_terms_days` from profile/client instead of hardcoded 30 (read the code to see which field exists).
- [ ] **Step 5:** Manual-verification notes for the final test plan (no component test required here — document exact repro: edit an old EUR invoice's note → save → rate/total/due date unchanged in DB).

### Task 7: Exchange-rate failure is loud, never a silent 1.0

**Files:**
- Modify: `src/lib/exchangeRate.ts` (~:29-43)
- Modify callers: `src/pages/InvoiceFormPage.tsx`, `src/pages/QuoteFormPage.tsx`, any other `getExchangeRate` caller (grep)
- Modify: `src/i18n/ui.ts` (new keys EN+FR: `exchange_rate_unavailable`)
- Test: create `src/__tests__/exchangeRate.test.ts`

- [ ] **Step 1: Write failing test:** `getExchangeRate` returns `null` on fetch failure and on malformed/non-finite/≤0 rate values (mock `fetch`); returns the number on success.
- [ ] **Step 2: Implement:** change signature to `Promise<number | null>`; validate `Number.isFinite(rate) && rate > 0`; remove the `?? 1` fallback.
- [ ] **Step 3: Callers:** on `null`, show `toast.error(t.exchange_rate_unavailable)`, set the manual-override mode ON so the user must enter/confirm the rate (the rate input already exists — read the form). Never write `chf_equivalent` computed from a silent fallback.
- [ ] **Step 4: Run test file** — PASS.

### Task 8: Money rounding at every computation boundary

**Files:**
- Modify: `src/lib/lineItems.ts` (amount math ~:87)
- Modify: `src/pages/InvoiceFormPage.tsx` (subtotal/discount/total ~:213-215, chf_equivalent ~:236), `src/pages/QuoteFormPage.tsx` (same), `src/hooks/useRecurringCheck.ts` (generated drafts)
- Test: extend `src/__tests__/lineItems.test.ts`

- [ ] **Step 1: Write failing tests:** export `round2(n: number): number` from `lineItems.ts` (`Math.round((n + Number.EPSILON) * 100) / 100`). Cases: `3 × 21.90 = 65.7` exactly; `round2(100.10 * 0.9) = 90.09`; `round2(0.1 + 0.2) = 0.3`; line-item `amount = round2(rate * quantity)`.
- [ ] **Step 2: Implement** and apply `round2` to: line-item amount, subtotal, discountAmount, total, chf_equivalent (grep both form pages + recurring generation for every arithmetic write into these fields).
- [ ] **Step 3: Run** `npx vitest run src/__tests__/lineItems.test.ts` — PASS.

### Task 9: Cache invalidation — finance + line items

**Files:**
- Modify: `src/db/hooks/useInvoices.ts`, `useQuotes.ts`, `useExpenses.ts`, `useIncome.ts`, `useTimeEntries.ts` (if finance uses it — check `src/db/hooks/useFinance.ts` key usage first)
- Test: none (mechanical; verified in final manual plan)

- [ ] **Step 1: Read** `src/db/hooks/useFinance.ts` — list every query key prefix it uses (audit says `["finance", ...]`).
- [ ] **Step 2:** In every mutation `onSuccess` of invoice/quote/expense/income (and time entries if finance reads them), add `queryClient.invalidateQueries({ queryKey: ["finance"] })` alongside existing invalidations. Follow the file's existing invalidation style exactly.
- [ ] **Step 3:** Line items: in `useUpdateInvoice` (and quote sibling) `onSuccess`, additionally invalidate `["invoice-line-items", id]` / `["quote-line-items", id]` (read `useInvoices.ts:40`, `useQuotes.ts:30` for exact keys).
- [ ] **Step 4:** Grep for other consumers of stale keys (`invoice-line-items`, `quote-line-items`) to confirm key spelling.

---

## Group C — Silent failures, DB robustness, security

### Task 10: Failures become visible (backup / calendar sync / recurring / getDb)

**Files:**
- Create: `src/lib/notifyError.ts`
- Modify: `src/hooks/useAutoBackup.ts` (~:38-56), `src/lib/appleCalendar.ts` (catch sites ~:223-298), `src/hooks/useRecurringCheck.ts` (~:115), `src/db/index.ts` (`getDb` ~:55-59)
- Modify: `src/i18n/ui.ts` (keys EN+FR: `backup_failed`, `calendar_sync_failed`, `recurring_generation_failed`, `db_init_failed`)
- Check: `src/components/ErrorFallback.tsx`, how `sonner`/toast is imported elsewhere

- [ ] **Step 1: Create `notifyError(userMessage: string, err: unknown): void`** — calls `toast.error(userMessage)` AND `logError(...)` (import pattern: read `src/lib/log.ts` and an existing toast usage first). Note: `appleCalendar.ts` and hooks are non-React modules/hooks — toast (sonner) works outside components; verify how `toast` is imported elsewhere in `src/lib`.
- [ ] **Step 2: Auto-backup:** failure path calls `notifyError(t-string for backup_failed, e)`. i18n inside a hook: use the translation store the way other hooks do (read how `useAutoBackup` currently gets strings; if it has no i18n access, read `src/i18n` for the non-hook accessor other libs use — follow the existing pattern, do not invent one).
- [ ] **Step 3: Calendar sync:** every catch that currently only `logError`s gets `notifyError` — but debounce: sync runs per-event; wrap so at most ONE toast per sync run (collect errors, single summary toast).
- [ ] **Step 4: Recurring check:** failure → `notifyError`.
- [ ] **Step 5: `getDb`:** remove catch-and-continue — rethrow after logging so the app does NOT run on a half-migrated schema. Verify `src/main.tsx`/`App.tsx` error boundary (`ErrorFallback.tsx`) catches it and shows a readable fatal message; if the failure happens outside the React tree, surface via a dedicated pre-render guard (read `main.tsx` first).
- [ ] **Step 6:** `npx tsc --noEmit` on the touched files' project (single run) — no new errors.

### Task 11: Rust batch pragmas + wiki transaction

**Files:**
- Modify: `src-tauri/src/lib.rs` (`execute_batch` ~:22-76)
- Modify: `src/db/queries/wiki.ts` (`setWikiArticleTags` ~:202-214)

- [ ] **Step 1: `execute_batch`:** after opening the rusqlite connection, before BEGIN: `conn.pragma_update(None, "foreign_keys", true)?;` and `conn.busy_timeout(std::time::Duration::from_millis(5000))?;` — do NOT use `conn.execute("PRAGMA busy_timeout=5000")` (it returns a result row and errors with `ExecuteReturnedResults` on some rusqlite versions).
- [ ] **Step 2: Check interaction with Task 3:** restore batch uses `PRAGMA defer_foreign_keys = ON` inside the transaction — verify it is still honored with `foreign_keys=ON` (it is; defer_foreign_keys defers enforcement to COMMIT within the transaction). Restore table order from Task 3 must satisfy FKs at commit.
- [ ] **Step 3: `setWikiArticleTags`:** replace raw `BEGIN`/`COMMIT` on the pooled connection with `TransactionBatch` (mirror `src/db/queries/customLists.ts:64`'s pattern).
- [ ] **Step 4:** `cargo check` is likely slow on this drive but run it once: `cd src-tauri && cargo check 2>&1 | tail -20`. Expect success. If it exceeds ~5 min, note it for the final build step instead.

### Task 12: Security — narrow fs scope + validate `open_in_finder`

**Files:**
- Modify: `src-tauri/capabilities/default.json` (~:23-26 fs scope)
- Modify: `src-tauri/src/lib.rs` (`open_in_finder` ~:295-311)
- Check: `src/lib/backup.ts` + Settings backup-path picker (folder dialog) for scope implications

- [ ] **Step 1: fs scope:** replace `"$HOME/**/*"` with `["$APPDATA/**", "$DOCUMENT/**", "$DOWNLOAD/**", "$DESKTOP/**"]` (keep the same permission identifiers). Read the capability file fully first — mirror the existing allow-syntax.
- [ ] **Step 2: Backup path:** read how the backup folder is chosen/stored (SettingsPage + backup.ts). If backups write via the fs plugin to a stored path, a path outside the new scope will now fail — ensure that failure surfaces via Task 10's `notifyError` with a message telling the user to re-pick the folder (add i18n keys `backup_path_not_allowed` EN+FR if a distinct message is feasible cheaply; otherwise the generic backup_failed covers it).
- [ ] **Step 2b: Audit ALL other stored-path fs usage for scope collateral:** grep every `@tauri-apps/plugin-fs` import/call site in `src/`. Stored absolute paths that may now fall outside scope: `receipt_path` on expenses/income (receipts picked from anywhere under `$HOME`), `projects.folder_path`, logo/attachment paths. For each read/write of a stored path, ensure the failure path routes through `notifyError` (no silent breakage). Note: files WRITTEN by the app itself live under APPDATA (in scope); the risk is user-picked historical paths. List any remaining risky call sites in the task report.
- [ ] **Step 3: `open_in_finder`:** in Rust, before spawning: `let canonical = std::fs::canonicalize(&path)` — on error return `Err("path not found")`; require `canonical.is_absolute()`; then spawn `Command::new("open").arg("-R").arg(canonical)` (reveal-in-Finder; canonical absolute path cannot start with `-`). Keep the command's existing return type/signature.
- [ ] **Step 4:** Grep frontend callers of `open_in_finder` (`NotificationsPage.tsx:46,53`, others) — confirm they pass absolute paths and handle the rejected promise (add `.catch` → toast if missing).
- [ ] **Step 5:** Leave the `osascript` capability as-is (needed for calendar sync + PDF text extraction; document with a one-line comment in the capability file: "required for EventKit/AppleScript sync — validator cannot be narrowed for dynamic scripts").

### Task 13: `deleteClient` — confirmation, complete cascade, honest undo

**Files:**
- Modify: `src/db/queries/clients.ts` (`deleteClient` ~:66-81)
- Modify: `src/db/hooks/useClients.ts` (undo push ~:84-108)
- Modify: `src/pages/ClientsPage.tsx` (context-menu delete ~:199), `src/pages/ClientDetailPage.tsx` (if it deletes)
- Modify: `src/db/hooks/useTasks.ts` (task undo ~:194-212)
- Reference pattern: `src/db/hooks/useProjects.ts:83-113` (correct snapshot undo)
- Modify: `src/i18n/ui.ts` (confirm_delete_client key EN+FR if missing)

- [ ] **Step 1: Read** `deleteClient`, the project-delete snapshot pattern, and the undo store (`src/stores/undo-store.ts` or similar — find it).
- [ ] **Step 2: Complete the cascade:** add missing deletes — `time_entries` (via the client's projects/tasks — read the schema for the FK columns), `recurring_invoice_templates` (client_id), `project_tables` + `project_table_rows` (via projects), `resource_projects` (via projects). Use `TransactionBatch` so the whole cascade is atomic.
- [ ] **Step 3: Honest undo:** before deleting, snapshot EVERYTHING the cascade removes (client, contacts, addresses, projects, tasks, subtasks, invoices + line items, quotes + line items, recurring templates, time entries, project tables + rows, resource links — note: `workload_rows` is legacy, migrated into `tasks` by `ensureSchema`; check whether it still holds live data before including it) following the project-delete pattern; undo restores the full snapshot via `TransactionBatch` with original IDs. If full restoration of any table proves infeasible after reading the code, STOP and report back rather than shipping a partial undo again.
- [ ] **Step 4: Confirmation:** client delete (context menu AND detail page) requires `ask(t.confirm_delete_client)` (same mechanism as bulk delete, e.g. `ExpensesPage.tsx:109`).
- [ ] **Step 5: Task undo:** snapshot subtasks in `useTasks.ts` delete-undo (same pattern, much smaller).
- [ ] **Step 6: Undo discoverability:** single-row deletes on Clients/Projects/Invoices/Quotes/Expenses/Income/Tasks pages use the `undoable()` toast helper (`src/lib/undo.ts`) so the user sees "deleted — Cmd+Z to undo" style feedback. Read `undo.ts` first; reuse, don't rebuild. Undo toast labels: move the hardcoded English labels (`useClients.ts:92`, `App.tsx` "Undo:") into i18n keys EN+FR.

---

## Group D — Date/time correctness

### Task 14: Local-date helper; kill UTC-day bugs; aging fixes

**Files:**
- Create: `src/utils/localDate.ts` + `src/__tests__/localDate.test.ts`
- Modify: `src/db/queries/invoices.ts` (overdue ~:144, aging ~:11-27), `src/db/queries/recurring.ts` (~:55), `src/utils/formatDate.ts` (~:7-9)

- [ ] **Step 1: Write failing tests** for `todayLocalISO(): string` (returns `YYYY-MM-DD` in LOCAL time — construct expected via `new Date()` getFullYear/Month/Date, not toISOString) and `parseLocalDate(s: string): Date`.
- [ ] **Step 2: Implement**; replace every `new Date().toISOString().split("T")[0]` used for "today" comparisons (grep the whole `src/` for this pattern) with `todayLocalISO()`.
- [ ] **Step 3: Aging query:** pass `todayLocalISO()` as a bound parameter instead of `julianday('now')` day-diffs (or `julianday(?, 'start of day')`), AND switch `SUM(total)` to the same `chf_equivalent` CASE expression used by the other finance queries (read a sibling query in `finance.ts` and copy the exact CASE).
- [ ] **Step 4: `formatDisplayDate`:** for full datetime strings (`YYYY-MM-DD HH:MM:SS`), append `Z` before parsing (mirror `formatDisplayDateTime`'s documented approach in the same file); bare `YYYY-MM-DD` date strings keep date-only parsing (no TZ shift).
- [ ] **Step 5: Run** `npx vitest run src/__tests__/localDate.test.ts` — PASS.

### Task 15: AppleScript event date construction

**Files:**
- Modify: `src/lib/appleCalendar.ts` (~:105-123)

- [ ] **Step 1:** In both script builders, set `day of d to 1` FIRST, then year, then month, then day (prevents the Jan-31 + month=Feb overflow).
- [ ] **Step 2:** Re-read the generated AppleScript string end-to-end for both create and update paths to confirm ordering; no test possible (osascript) — add repro note to the final manual test plan.

### Task 16: Recurring invoices — full catch-up + anchor-day months

**Files:**
- Modify: `src/hooks/useRecurringCheck.ts` (catch-up loop, `DRAFT-${Date.now()}` ~:49), the `addMonths`/`advanceDate` helper (find it — may live in the hook or a lib)
- Test: create `src/__tests__/recurringDates.test.ts`

- [ ] **Step 1: Write failing tests** for an extracted pure helper `advanceDate(dateISO: string, interval: "monthly"|"quarterly"|"biannual"|"annual", anchorDay: number): string`: Jan 31 monthly (anchor 31) → Feb 28 → Mar 31 (no drift); Jan 15 quarterly → Apr 15; leap year Feb 29 annual (anchor 29) → next Feb 28.
- [ ] **Step 2: Implement** anchor-day clamping (each step targets `min(anchor, daysInTargetMonth)`). **Anchor source (verified against schema):** `recurring_invoice_templates` has NO `start_date` column (columns: `base_invoice_id, client_id, frequency, next_due, active, created_at, updated_at` — see `ensureSchema` in `src/db/index.ts:342-353`). Do NOT derive the anchor from `next_due` — it mutates on every advance, so after one clamped step (Jan 31 → Feb 28) the anchor would decay to 28 permanently. The immutable anchor is the base invoice's `invoice_date` day-of-month, fetched via `base_invoice_id`. If the base invoice can be deleted (check FK/ON DELETE), fall back to the template's `created_at` day-of-month and note it.
- [ ] **Step 3: Catch-up loop:** replace single-step advance with `while (next_due <= todayLocalISO()) { generate draft for that period; next_due = advanceDate(...) }` with a sane safety cap (e.g. 60 iterations) and one summary toast ("N invoices generated").
- [ ] **Step 4:** Draft reference: replace `DRAFT-${Date.now()}` with `DRAFT-${crypto.randomUUID()}` here AND in `InvoiceFormPage.tsx:300` (grep `DRAFT-` for all sites).
- [ ] **Step 5: Run test file** — PASS.

---

## Group E — Timer, undo/redo, shortcuts, unsaved changes

### Task 17: Timer survives restarts; time never silently lost

**Files:**
- Modify: `src/stores/app-store.ts` (`activeTimer` ~:142-147), `src/hooks/useTimerActions.ts` (~:28-39)

- [ ] **Step 1: Read** both files + how other zustand stores persist (dashboard/tab stores likely use `persist` middleware — copy that pattern).
- [ ] **Step 2: Persist `activeTimer`** (store `startedAt` timestamp + task/project ids; elapsed is always derived from `Date.now() - startedAt`, so restore-on-launch is automatic). If `app-store` deliberately doesn't persist, move `activeTimer` into a tiny persisted slice rather than persisting unrelated state.
- [ ] **Step 3: `stopTimer` ordering:** write the time entry to DB FIRST; only clear timer state on success; on failure keep the timer running and `notifyError`. Add `.catch` on the `toggleTimer` call chain (audit: unhandled rejection).
- [ ] **Step 4:** `npx tsc --noEmit` — clean.

### Task 18: Undo/redo hardening + contentEditable guard + Cmd+Shift+Y

**Files:**
- Modify: `src/App.tsx` (undo/redo handlers ~:74-135), `src/hooks/useTabSync.ts` (~:83-91)

- [ ] **Step 1: Read** the undo/redo handlers and the undo store.
- [ ] **Step 2: Failure-safe undo/redo:** peek (don't pop) → await execute → pop only on success; on failure `notifyError` and leave the stack intact. Replace in-place `store.stack.unshift(...)` with immutable store updates via `set`.
- [ ] **Step 3: Guard:** extend the editable-target check (currently INPUT/TEXTAREA/SELECT) with `(e.target as HTMLElement).isContentEditable || (e.target as HTMLElement).closest?.('[contenteditable="true"]')` so Wiki-editor Cmd+Z never fires app-level undo.
- [ ] **Step 4: Shortcut:** reopen-closed-tab in `useTabSync.ts` moves from Cmd+Shift+T to Cmd+Shift+Y. Verify no other binding uses Cmd+Shift+Y (grep `key ===` / `e.key` in hooks + App.tsx). Quick Timer keeps Cmd+Shift+T unchanged.

### Task 19: Unsaved-changes guard covers ALL navigation paths

**Files:**
- Read first: `src/hooks/useUnsavedChangesWarning.ts` (whole file), `src/hooks/useTabSync.ts`, `src/components/CommandPalette.tsx` (`go()` ~:49-52), `src/components/layout/TabBar.tsx`
- Modify: those four + `src/pages/ClientDetailPage.tsx`

- [ ] **Step 1: Central dirty registry:** create a tiny zustand store (or module singleton) `dirty-guard.ts`: `registerDirtyGuard(fn: () => boolean, message: string)` / `confirmIfDirty(): Promise<boolean>` (uses the same confirm mechanism `useUnsavedChangesWarning` already uses — read it; reuse its dialog).
- [ ] **Step 2:** `useUnsavedChangesWarning` registers its dirty check with the registry (keeps its existing anchor/popstate/beforeunload behavior).
- [ ] **Step 3:** Gate EVERY programmatic navigation: tab close (Cmd+W), new tab (Cmd+T), tab cycling (Ctrl+Tab, Cmd+1-9), tab clicks in TabBar, and CommandPalette `go()` — each awaits `confirmIfDirty()` before navigating.
- [ ] **Step 4:** `ClientDetailPage` adopts `useUnsavedChangesWarning` wired to its existing `dirty` flag (~:41,92).
- [ ] **Step 5:** Manual repro notes for final test plan (dirty invoice → Cmd+W → prompt appears; same via palette).

### Task 20: Command palette — Escape closes it

**Files:**
- Modify: `src/components/CommandPalette.tsx`

- [ ] **Step 1:** Add an Escape handler (onKeyDown on the palette root or a document listener active while open) calling the existing close path (same as backdrop click ~:58). Ensure it doesn't swallow Escape when palette is closed.

---

## Group F — Tooling & final verification

### Task 21: ESLint (flat config) + react-hooks

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json` (add `lint` script + devDependencies)

- [ ] **Step 1:** `npm install -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks` (this is allowed npm usage; may be slow — run with long timeout in background if needed).
- [ ] **Step 2:** Flat config: `@eslint/js` recommended + `typescript-eslint` recommended (NOT type-checked variants — too slow on this drive) + `react-hooks` recommended; ignore `dist`, `src-tauri`, `node_modules`, `SNAFU`, `docs`. Script: `"lint": "eslint src"`.
- [ ] **Step 3:** Run `npm run lint`. Fix ERRORS in files this plan touched; for the rest, report the error/warning count per rule — do NOT mass-autofix the codebase (that's phase 2 material).

### Task 22: Full verification sweep

- [ ] **Step 1:** `npx tsc --noEmit` — zero errors.
- [ ] **Step 2:** `npx vitest run` — full suite green (old + new tests).
- [ ] **Step 3:** `npm run lint` — zero errors in touched files.
- [ ] **Step 4:** `cd src-tauri && cargo check` — clean (if not already done in Task 11).
- [ ] **Step 5:** Write `SNAFU/AUDIT-FIXES-TEST-PLAN.md`: a step-by-step manual verification checklist for the user covering every fix (see plan-level acceptance criteria below), then report completion.

---

## Explicitly DEFERRED to phase 2 (design/UI/UX pass — do NOT do these now)
- Invoice/quote code merge (~800-line dedup refactor)
- `queryKeys.ts` factory adoption (271 inline keys)
- `ensureSchema` consolidation into migration 006 (only the fail-loudly part is in Task 10)
- Modal focus trap, context-menu keyboard nav, aria-labels, form label association, DnD keyboard support
- Design-system violations (workload TAG_COLORS, CalendarPage radius, hand-rolled buttons, i18n stragglers beyond keys added above)
- Skeletons, empty-state CTAs, ProjectsPage bulk/saved filters, busy states for PDF export
- `scripts/migrate-data.mjs` PII scrub

## Acceptance criteria (drive the final manual test plan)
1. Backup → wipe-sim → restore round-trips ALL tables including income/time entries, multi-line notes, and empty-string fields; restore is all-or-nothing and completes with 0 "values defaulted" for a fresh backup.
2. A EUR invoice PDF has no QR section; a CHF invoice still has a correct QR-bill.
3. Sent/paid/overdue invoices cannot be deleted (UI blocks it with an explanatory message; cancel still works); deleting a draft leaves all other references untouched; next new invoice = max+1 across a gapped sequence.
4. Editing an old foreign-currency invoice (change a note only) leaves rate/total/due date byte-identical in DB.
5. Offline invoice creation in EUR prompts for a manual rate; nothing books at rate 1 silently.
6. 3 × 21.90 line shows and STORES 65.70.
7. Marking an invoice paid updates Finances immediately (no 5-min staleness).
8. Failed auto-backup and failed calendar sync each show a toast.
9. Client delete asks for confirmation; Cmd+Z restores the client WITH its projects/invoices/tasks.
10. Timer survives app restart; failed time-entry write keeps the timer running with an error toast.
11. Cmd+Shift+Y reopens a closed tab; Cmd+Shift+T opens Quick Timer; Cmd+Z in the Wiki editor edits text only.
12. Dirty invoice form + Cmd+W / palette navigation → unsaved-changes prompt.
13. Recurring monthly template dated 3 months back generates 3 drafts on one launch; Jan 31 anchor lands on Feb 28 then Mar 31.
14. Backup to a folder in Documents works; the app cannot read outside APPDATA/Documents/Downloads/Desktop; existing expense receipts stored under APPDATA still preview, and a receipt whose stored path is outside the new scope produces a visible error, not silence.
15. The invoice-aging widget values a USD unpaid invoice at its CHF equivalent, not face value.
16. A `created_at` timestamp around midnight UTC displays as the correct local date (formatDisplayDate fix).
17. Escape closes the command palette.
18. Saving wiki article tags works (transaction change did not break it).
