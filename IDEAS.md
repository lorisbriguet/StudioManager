# StudioManager — Ideas & Backlog

## V1.9.0 — Done

- [x] Fix: "Keep N backups" rotation (Tauri v2 readDir compatibility)
- [x] Fix: FOREIGN KEY constraint on project delete (invoices/quotes now unlinked instead)
- [x] Time tracking UX rethink — removed LogTimePopup, TimeEntryLog, Clock button from task rows
- [x] Removed TimeTrackingPage from sidebar/routing
- [x] Time entries management in Settings (filter by date/project, inline edit, delete)
- [x] Cmd+Shift+T quick timer picker (project → task → start from anywhere)
- [x] Dashboard: save/update current layout to active preset
- [x] Invoice aging widget (0-30/31-60/61-90/90+ day overdue brackets)
- [x] Resource duplication warning on URL match
- [x] Global custom lists (Settings CRUD, import/save/unlink in column editors)
- [x] Customizable invoice/quote templates (accent color, font, logo position, margins, field visibility, column order)
- [x] Template editor in Profile with live PDF preview
- [x] Template selector on invoice/quote forms
- [x] Full UX audit — CSS tokens, i18n, accessibility, focus states, consistency

## V1.10.0 — Done (full audit hardening + UI/UX pass)

- [x] Backup/restore rebuilt: all 32 tables covered, atomic restore with automatic safety backup, corrupted/empty-backup guards
- [x] Invoice integrity: QR-bill CHF-only, draft-only deletion (no renumbering/reference reuse), edits preserve historical rates/discounts/due dates, money rounding, loud offline exchange-rate handling
- [x] Silent failures made visible (backup, calendar sync, recurring generation, DB init)
- [x] Client delete: confirmation + full-cascade undo; timer survives restarts; undo/redo hardened (WebKit redo fix); Cmd+Shift+Y reopen tab
- [x] Unsaved-changes guard on every navigation path; Escape closes command palette
- [x] Security: fs scope narrowed, open-in-Finder path validation, FK enforcement in batches
- [x] Local-date correctness (overdue/recurring/aging), calendar month-end fix, recurring multi-period catch-up with anchor days
- [x] Design-system compliance: dark-mode workload tags, shared Button adoption, radius/i18n/aria sweeps (810 EN/FR keys, 113+ aria-labels)
- [x] UX: skeletons on list pages, busy states, empty-state CTAs, ProjectsPage bulk+filters, line-item keyboard reorder, full inline form validation
- [x] ESLint (zero findings), 219 tests, RELEASING.md guidelines

## V1.12.0 — Done (expense receipt parsing)

- [x] Scoring-based expense parser (`expenseParse.ts`): multi-format amounts (CH/DE/FR/EN), label-aware invoice/due dates with month-name formats, fuzzy known-supplier matching
- [x] German OCR language pack (fra+deu+eng)
- [x] Fix: Income page date prefill read a nonexistent parser field
- [x] Real-receipt eval vs recorded data: invoice date 8% → 83%, amount 10% → 70%

## V1.12.1 — Done (activities i18n)

- [x] Activities as entities with user-editable FR/EN names (migration 006, two-column Settings editor)
- [x] Invoices/quotes store activity_id + language-appropriate text snapshot (PDFs print client language)
- [x] Revenue by Activity dedup via id/name resolution (fixes "Graphisme" / "Graphic Design" / trailing-space triple rows)
- [x] Recurring invoices keep their activity link; seed guarded against concurrent first runs

## V1.14.0 — Done (brand identity)

- [x] Sidebar brand: STUDIO→MANAGER wordmark (expanded) + compact arrow mark (collapsed), inline SVG on currentColor
- [x] New app icon — arrow mark on dark tile with flare rim; Icon Composer doc in `Icon/`, compiled via `scripts/compile-icon.sh` (Assets.car + spec-exact icns), flat set via `tauri icon`
- [x] Untranslated-activity nudge in editor and on EN invoices
- [x] Receipt parser: US dates, month-comma dates, header/id line skips

## V1.15.0 — Done (QoL + audit round 2)

- [x] Backup rotation retries on synced folders (Synology ENOTEMPTY race)
- [x] Full audit round 2: discoverability, button order, type scale, muted contrast, Settings cards, first-run guidance, Save & Preview, Cmd+N / arrow-key nav / Cmd+B sidebar toggle, undo affordance on contact/address/template deletes

## Audit — round 3 (2026-08-31)

Three-lens audit (correctness/data, security/platform, UI/a11y/perf/tests) after v1.15.0. Clean bill: SQL parameterization, osascript runner, wiki allowlist, updater chain, capabilities scope, date/money handling, design-system compliance (0 violations), modal/menu focus management.

### Fixed (2026-08-31)
- [x] PII (IBAN, IDE, phone, address) hardcoded in `scripts/migrate-data.mjs` on a PUBLIC repo — dead one-time script deleted; RELEASING.md rule updated. NOTE: still in git history; purge with `git filter-repo` if desired (destructive, needs force-push).
- [x] Undo redo fragility — income/contact/address delete redos matched by reference/name instead of the restored id (wrong row deleted if duplicates); now capture `lastInsertId` like invoices (tests: undoRedoCapture.test.tsx; tauri-sql mock now returns the real execute() result shape)
- [x] Recurring-template create/delete undo pushes had no `redo` — Cmd+Shift+Z was a silent no-op
- [x] `execute_batch` unbounded — MAX_BATCH_STATEMENTS=10k guard
- [x] Test-run noise — unmocked `lib/log` in useRecurringCheck.test.tsx

### Open backlog
- [ ] Test coverage: `lib/undo.ts`, `lib/statusColors.ts`, `db/queries/*` have no direct tests (only indirect via hooks/pages) — prioritize undo + money/date queries
- [ ] `useListNavigation`: add `getRowProps(idx)` returning `aria-selected` so keyboard focus is announced (visual ring only today)
- [ ] `pragma_table_info('${table}')` interpolation in `db/index.ts` + `lib/backup.ts` — currently allowlisted/hardcoded (not exploitable), escape or validate as defense-in-depth
- [ ] Perf: memoize row components + `getTagColor`/`statusClasses` in Invoices/Expenses/NamedTable; consider lazy-loading Settings/Finances routes
- [ ] Unify receipt-filename sanitization with backup's stronger `safeName()` (shared `lib/pathSafety.ts`)
- [ ] CSP `connect-src https://github.com` breadth — verify the in-app update check's fetch path before narrowing (naive pinning can break updates)
- [ ] Invoice PDF recomputes discount from `subtotal * discount_rate` at render — consider storing `discount_amount`

## Audit — round 4, exhaustive (2026-08-31)

Full-coverage pass: deterministic tooling (npm/cargo audit, knip, jscpd, clippy, license-checker, i18n key cross-check) + four agents reading every line of src/pages, src/components+hooks+stores+lib, src/db+src-tauri (~37k lines). Every P1 claim was re-verified by hand; six were rejected as false (discount math, pdfExtract timeout, React Query prefix invalidation ×2, toCHF zero-division, receipt path traversal).

### Clean bill
0 npm vulnerabilities · 0 RustSec vulnerabilities (17 unmaintained-crate warnings are Linux-only gtk deps) · clippy 0 warnings · licenses all permissive · 0 leaked listeners/intervals · design-system compliance 0 violations · transactions atomic (TransactionBatch everywhere it matters) · client cascade delete exemplary

### Dead weight (mechanical cleanup batch)
- [x] Unused npm deps: `@tanstack/react-table`, `@tanstack/react-virtual`, `@tauri-apps/plugin-window-state` (JS binding; Rust side stays)
- [x] Unused files: `scripts/attach-invoices.mjs`, `scripts/attach-receipts.mjs`, `scripts/eval-receipts.mjs` (keep? referenced in IDEAS receipts eval), `src/hooks/useAnimateIn.ts`, `src/lib/queryKeys.ts`
- [x] 4 dead DUPLICATE time queries in `db/queries/tasks.ts:188-289` (getTimeThisWeek etc.) — live versions are in timeEntries.ts; the dead ones even have divergent semantics (filter by task.updated_at) — delete before someone imports the wrong one
- [x] ~18 further unused exports + 9 unused types (knip 2026-08-31 output), incl. `isListInUse` stub that always returns false
- [x] 46 unused i18n keys (verify dynamic `t[expr]` access for: dark, light, annual, biannual before deleting)

### Correctness / UX (P2)
- [x] Silent-failure class: no global mutation onError and these lack local ones — Calendar event drag/resize, ClientDetail saveField + createContact, Wiki debounced article save, ProjectDetail delete, NamedTable save-as-list
- [ ] Wiki debounced save: stale-articleId hazard only ref-mitigated; add id check at fire time + onError
- [ ] Keyboard nav parity: Tasks/Projects/Clients lack the arrow-key row navigation Invoices/Expenses/Quotes/Income got in v1.15.0
- [ ] Double-submit windows: create buttons without isPending disable (Clients form, TasksPage Enter, Wiki new article, Settings test/presentation-mode buttons)
- [ ] Trustee export: per-invoice PDF failures skipped silently — report failed count; verify `exporting` flag resets on mid-chain throw
- [ ] ResourcesPage tag-loading effect: no abort on unmount (setState-after-unmount)
- [ ] IncomePage edit form renders category values raw (`c.replace(/_/g," ")`) — bypasses i18n while the row badge translates
- [ ] `createResource` inserts tags in a loop — batch it
- [ ] Missing indexes: time_entries(project_id), time_entries(date), quotes(client_id)
- [ ] SavedFilterBar portal menu lacks role/ARIA parity with ContextMenu

### Polish (P3)
- [ ] Duplication debt (4.1%): InvoicePDF↔QuotePDF 273 dup lines, InvoiceForm↔QuoteForm 265, Expenses↔Income 191 — extract shared document/form cores when next touching them
- [ ] Component bloat: NamedTable 602L, ProjectDetailContent 1000L+, SettingsPage 1700L
- [ ] Memoize per-row color/status computations (category IIFE in ExpensesPage, getTagColor, statusClasses); React.memo row components
- [ ] dirty-guard `confirming` flag → promise-based lock
- [ ] notifyError dedupe contract broken by interpolated message in useAutoBackup (latch already prevents spam)
- [ ] appleCalendar subtask sync builds task→project map by fetching all tasks — JOIN instead
- [ ] Dependency drift: ~28 patch/minor updates pending; majors (FullCalendar 7, react-table 9 → moot if dep deleted, TS 7) stay deferred

## Maintenance — dependency audit (2026-08-12)

### Do now (safe batch) — Done (2026-08-14)
- [x] `npm audit fix` — 14 vulnerabilities → 0
- [x] `npm update` — ~36 minor/patch bumps within current majors (incl. happy-dom CVE fixes, all Tauri plugins, React 19.2.8, TanStack Query 5.101, tiptap 3.30)
- [x] `cargo update` + rusqlite 0.31 → 0.32 (bundled SQLite 3.45 → 3.46.1). 0.33+ blocked: tauri-plugin-sql's sqlx pins libsqlite3-sys 0.30 and Cargo's `links` rule forbids two SQLite copies — revisit when the plugin moves past sqlx 0.8
- [x] lucide-react 0.577 → 1.31 (no renamed icons in use)
- [x] @testing-library/jest-dom 6 → 7 (dev-only)

### Plan as own branch — Done (2026-08-14)
- [x] Vite 7 → 8 (Rolldown) + @vitejs/plugin-react 6 — bundling ~6.4s → ~0.8s, vitest 4.1 compatible unchanged
- [x] Replace tesseract.js with Apple Vision OCR (`VNRecognizeTextRequest`) via the `ocr_image_text` Rust command (fixed JXA script, argv-only, fr/de/en) — HEIC read natively so the sips conversion command was removed too; live-OCR unit test on a committed fixture. Re-run the receipt eval against recorded data to quantify accuracy vs tesseract

### Deferred — revisit later
- [ ] TypeScript 5.9 → 7.x (Go-native compiler, ~10x builds) — BLOCKED until TS 7.1 ships its stable API and typescript-eslint supports it
- [ ] FullCalendar 6 → 7 — new temporal-polyfill peer dep, package restructure, custom CSS breaks; upgrade only when v7 features are wanted
- [ ] TanStack Table 8 → 9 — real API migration (`useTable`, opt-in features, readonly data); benefit is bundle size, no current pain

## Bug fixes — reported (2026-08-12) — Done (2026-08-14)

- [x] Charges sociales (CS) not rendered in the Finances data visualization — social charges now returned as per-category rows (`social_charge_categories`) and included in the expense breakdown pie
- [x] Editing paid date: Enter key doesn't trigger save. App-wide sweep done: paid-date modal, workload column editor (name + formula), client detail fields and address editor all submit on Enter
- [x] Invoice export from preview with "mark as sent and export": export now re-fetches the updated invoice (fresh reference + stored PDF) instead of the stale closure copy; mutation errors close the modal with a toast. Stored PDFs also render with template/billing address/project/reminder props so they match the preview

## UX/UI improvements (2026-08-12) — Done (nudge shipped in v1.14.0)

- [x] "Detected from receipt" indicators — accent border + "From receipt" chip with one-click clear on OCR-prefilled fields (expense + income forms); marker clears on edit or suggestion pick
- [x] Supplier merge tool in Settings — suggested variant groups (token-subset heuristic) + manual multi-select, canonical pick, single-UPDATE relink with per-row undo
- [x] Untranslated-activity nudge — badge in Settings editor (and on first EN-client invoice) where name_fr === name_en
- [x] Stable chart colors per activity — hash of stable key (activity id / name / category code) instead of sorted index; also fixed client/category/project-time charts
- [x] Dashboard year switcher — header dropdown feeding a DashboardYearContext consumed by all 13 year-scoped widgets
- [x] YoY deltas on dashboard KPIs — "+X% vs last year" on Invoiced/Expenses/Net, hidden when the prior year is empty
- [x] One-click "mark paid today" on invoice/expense rows — already existed via context menus; the invoice row action now has undo (drafts excluded: no revert to draft once numbered)
- [x] Undo toast for expense/income deletion — already covered by the existing undoableFromStore pattern (verified)

## Security hardening (2026-08-12)

- [x] Retire arbitrary osascript execution (2026-08-14) — Calendar sync + PDF/HEIC extraction moved to Rust commands in `src-tauri/src/apple.rs` with fixed scripts; user data passed via argv only (`on run argv` / JXA `function run(argv)`), HEIC runs `sips` directly with no shell; `shell:allow-execute` dropped from capabilities (`shell:allow-open` kept for browser URLs). Mail sharing was already a Rust command
- ~~Notarize the app~~ — dropped: requires the paid Apple Developer Program, which we're not getting. Unsigned builds keep using the right-click-open Gatekeeper bypass
- [x] Automate dependency auditing (2026-08-14) — weekly GitHub Action runs `npm audit` + `cargo audit`; two unfixable sqlx-transitive advisories ignored with reasons in `src-tauri/.cargo/audit.toml`
- [x] Smoke-test the osascript migration (2026-08-14): Calendar sync (timed + all-day + deletion), PDF receipt parsing, HEIC Vision OCR, Mail sharing, export dialogs, dashboard year switcher, supplier merge — all verified in the running app

## Audit — full app (2026-08-14)

Five-front audit (security, data integrity, frontend quality, performance, tests/Rust). Verdict: fundamentally healthy — zero critical findings; parameterized SQL, fixed-script argv-only osascript, path canonicalization, batch transactions and snapshot undo all confirmed solid. npm/cargo audits clean, 302+8 tests green, lint/tsc zero findings.

### P0 — correctness — Done (2026-08-14)
- [x] DB snapshots ignore SQLite WAL — snapshots now use VACUUM INTO, restore uses the SQLite online backup API (safe on a live DB), mode exits clean up -wal/-shm; proven by tmp-DB roundtrip tests incl. uncheckpointed-WAL capture (src-tauri/src/dbfiles.rs)
- [x] Supplier-merge undo is now a single TransactionBatch (restoreSupplierNames)
- [x] Recurring catch-up cap raises a toast + notification; malformed next_due skipped with a visible error; useRecurringCheck hook now tested (drafts per period, cap, corrupt-date guard)

### P1 — user-visible — Done (2026-08-14)
- [x] Draft-warning overlays now use the shared Modal (Escape/focus trap/restore); QuotePreviewPage's "mark sent & export" also got the fresh-reference fix invoices received earlier
- [x] "Receipt will be attached:" now i18n'd (receipt_will_be_attached)
- [x] Non-token colors replaced with warning/indigo/success tokens (SettingsPage mode controls, InvoicesPage recurring badge, widgets StatusDot)
- [x] Trustee export batch-fetches all line items in one query (rendering stays sequential — @react-pdf concurrent renders have wedged before)
- [x] Calendar sync batch-fetches project + task maps (no per-row lookups; tested)
- [x] Silent .catch(() => {}) now log (version, snapshot check, drag-drop listener)

### P2 — hardening/hygiene — Done (2026-08-14)
- [x] run_osascript: per-integration timeouts (kill after 15-30s), 16 MB output cap with pipe draining, commands moved to the blocking pool
- [x] share_pdf_via_mail converted to the fixed-script argv pattern (last interpolated AppleScript removed)
- [x] tiptap Link: explicit allowlist (https?:// and /wiki?) — javascript:/data:/file: can never be stored
- [x] Expense category lookups memoized as a Map
- [x] CREATE INDEX on hot columns (idempotent, ensureSchema)
- [x] Invoice delete redo tracks the restored row id
- [x] Finances page banner when counted foreign-currency invoices lack a CHF equivalent (form already blocks new ones)
- [x] Design-system: address dropzone → card radius; Settings sandbox controls kept as token-compliant custom buttons (small-button rounded-md is spec-compliant)
- [x] Shared useReceiptDrop + useDetectedFields hooks (−200 duplicated lines). File splits of SettingsPage/widgets deliberately skipped — churn outweighs benefit today

### P3 — missing tests + bundle — Done (2026-08-14)
- [x] Tests added: useRecurringCheck, backup I/O (in-memory fs: CSVs, rotation, safety backup, wipe order, empty-backup abort), dirty-guard, tab store, bulkPdfExport, Rust convert_placeholders (now skips $N inside string literals) + json_to_sql
- [x] Bundle: Calendar (274 kB) and Wiki (410 kB) lazy-loaded — main chunk 4.1 → 3.4 MB (gzip 1.31 → 1.11 MB). recharts stays (dashboard is the default route); PDF stack stays (woven through export paths — revisit only if it hurts)

### Receipt eval — Vision vs recorded data (2026-08-14, scripts/eval-receipts.mjs)
- Image receipts via Vision OCR (n=11): supplier 91%, amount 91%, date 64% — clearly better than the tesseract-era baseline (~70% amounts)
- PDF receipts via PDFKit text (n=112): supplier 59%, amount 67%, date 78% — parser headroom on older receipt layouts, not OCR
- [x] RESOLVED: 75 receipts + 22 invoice PDFs "missing" were stale absolute paths from the pre-rename bundle identifier (ch.lorisbriguet.studiomanager); the files were all present under ch.studiomanager.app. Live DB rewritten (123/123 verified resolving) and an idempotent ensureSchema migration now heals any DB restored from a pre-rename backup
- [x] Parser accuracy on older PDF receipt layouts (2026-08-14) — US MM/DD/YYYY dates (incl. trailing time), "DD Mon, YYYY", header/metadata-line skips for the supplier fallback. Remaining eval gap is ground-truth artifacts (recorded payment dates vs printed invoice dates, CHF card charges vs foreign totals, supplier nicknames) — not parser bugs

False alarms reviewed and rejected: $LAST_INSERT_ID injection (i64-only), localStorage mode switching (webview already has execute_batch by design), javascript:/file: URLs via shell.open (plugin's default validator blocks them), supplier-merge finance invalidation (finance never aggregates by supplier).

## UI design audit — round 2 (2026-08-14) — shipped in v1.15.0

Code-level review by three design lenses (visual language, layout consistency, interaction). Verdict: the token system is excellent (zero hardcoded grays, 301 token usages, full dark-mode parity, reduced-motion respected); the design debt sits in discoverability, paradigm consistency and micro-typography. A visual (screenshot) pass is still pending — needs Screen Recording permission or user-provided captures.

### Discoverability (highest impact)
- [x] Row-action menu trigger (Settings2) is invisible until hover on Invoices/Expenses/Quotes — make it persistently visible at rest (muted)
- [x] IncomePage has no row context menu at all (delete only) — bring it to parity with Expenses
- [x] Contact/address card edit affordances are hover-only — always-visible edit control

### Form paradigms & flows
- [x] Button order: inline Card forms put Save leftmost while modals put primary rightmost (macOS convention) — standardize primary-rightmost everywhere; consistent action placement on full-page forms
- [x] "Save & preview" on the invoice form to collapse the save → list → hover → menu → export flow

### Typography & tokens
- [x] Fold ad-hoc font sizes (text-[13px]/[11px]/[9px]) into the documented scale
- [x] Slightly darken --color-muted (borderline WCAG AA ~4.4:1 at the 10-11px sizes it dominates)
- [x] Document spacing rhythm + type scale in DESIGN-SYSTEM.md (py-[7px]-style one-offs exist)

### Information architecture & guidance
- [x] SettingsPage: card-based sectioning per topic (currently one undifferentiated 1,679-line column)
- [x] FinancesPage: empty state for fresh profiles + clearer chart sectioning
- [x] First-run guidance for Dashboard/Calendar/Wiki (list pages already have good EmptyState CTAs)

### Keyboard & undo
- [x] Cmd+N for new invoice/expense/income; arrow-key row navigation + keyboard path to the row menu
- [x] Undo for recurring-template delete and contact/address operations (currently permanent)

Reviewer claims rejected: "radius hierarchy inverted" (frequency ≠ inversion), "PageHeader missing on half the pages" (spot-checked false; only Dashboard/Settings are custom, defensibly), "under-elevated" (flat border-defined depth with overlay-only shadows is a deliberate, good model).

## Planned — features (pre-1.12 backlog)

### Meetings block in projects
- Separate `meetings` table: title, date, start_time, end_time, location, attendees (JSON: contact IDs + free text names), project_id, tracked_minutes
- Status: upcoming/done — auto-flip based on date
- Project block: card layout (date, time, attendees, location) in modular project layout
- Calendar: meetings auto-appear in calendar view
- Time tracking: manual timer (same as tasks) + auto-log duration (end - start) when meeting is done
- Attendees: dropdown from client contacts + free text custom names
- Auto-invoicing: "Add meetings" button on invoice form compiles all project meetings into one line item (total hours x rate)

### System tray quick-add
- Tauri system tray / menu bar icon
- Actions: start timer (project → task picker), log time, create expense
- Accessible without opening the full app window

### Project profitability view
- Per-project P&L: invoiced amount vs. time cost (hours x rate) vs. expenses
- Display in project detail or as a dashboard widget

### Update presentation mode seeds
- Refresh demo data for all features added since V1.6.0

## Low Priority

- [ ] Resizable side peek snap positions
- [ ] Mobile app companion
