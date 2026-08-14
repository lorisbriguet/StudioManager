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

## UX/UI improvements (2026-08-12) — Done (2026-08-14) except the nudge

- [x] "Detected from receipt" indicators — accent border + "From receipt" chip with one-click clear on OCR-prefilled fields (expense + income forms); marker clears on edit or suggestion pick
- [x] Supplier merge tool in Settings — suggested variant groups (token-subset heuristic) + manual multi-select, canonical pick, single-UPDATE relink with per-row undo
- [ ] Untranslated-activity nudge — badge in Settings editor (and on first EN-client invoice) where name_fr === name_en
- [x] Stable chart colors per activity — hash of stable key (activity id / name / category code) instead of sorted index; also fixed client/category/project-time charts
- [x] Dashboard year switcher — header dropdown feeding a DashboardYearContext consumed by all 13 year-scoped widgets
- [x] YoY deltas on dashboard KPIs — "+X% vs last year" on Invoiced/Expenses/Net, hidden when the prior year is empty
- [x] One-click "mark paid today" on invoice/expense rows — already existed via context menus; the invoice row action now has undo (drafts excluded: no revert to draft once numbered)
- [x] Undo toast for expense/income deletion — already covered by the existing undoableFromStore pattern (verified)

## Security hardening (2026-08-12)

- [x] Retire arbitrary osascript execution (2026-08-14) — Calendar sync + PDF/HEIC extraction moved to Rust commands in `src-tauri/src/apple.rs` with fixed scripts; user data passed via argv only (`on run argv` / JXA `function run(argv)`), HEIC runs `sips` directly with no shell; `shell:allow-execute` dropped from capabilities (`shell:allow-open` kept for browser URLs). Mail sharing was already a Rust command
- ~~Notarize the app~~ — dropped: requires the paid Apple Developer Program, which we're not getting. Unsigned builds keep using the right-click-open Gatekeeper bypass
- [x] Automate dependency auditing (2026-08-14) — weekly GitHub Action runs `npm audit` + `cargo audit`; two unfixable sqlx-transitive advisories ignored with reasons in `src-tauri/.cargo/audit.toml`
- [ ] Smoke-test the osascript migration in the running app before release: task with due date syncs to Calendar (timed + all-day), event deleted on task completion, purge-all works, PDF receipt drag-drop parses, HEIC photo converts + OCRs, invoice "share via Mail" opens a draft

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

### P2 — hardening/hygiene
- [ ] run_osascript: no Rust-side timeout or stdout cap; consider spawn_blocking (apple.rs)
- [ ] share_pdf_via_mail: convert to argv pattern for consistency (current escaping is sufficient for AppleScript string literals)
- [ ] Verify tiptap Link rejects javascript: URLs in stored wiki content
- [ ] categories.find() per expense row → memoized Map (ExpensesPage:82)
- [ ] CREATE INDEX on hot columns (invoices client_id/date/status, expenses date/category, tasks project/due)
- [ ] Invoice delete redo finds the restored row by reference — store the id instead (useInvoices.ts:182)
- [ ] Warn when non-CHF invoice has chf_equivalent <= 0 (currency mixing in P&L)
- [ ] Design-system sweep: ~14 rounded-md misuses; ad-hoc raw buttons in Settings/Calendar/Resources
- [ ] Dedupe detected-badge helpers + handleDroppedFile into shared hooks; split SettingsPage (1673 l.) / ExpensesPage (907 l.) / widgets.tsx (1546 l.)

### P3 — missing tests (ranked) + bundle
- [ ] Tests: useRecurringCheck workflow, backup.ts create/restore I/O, dirty-guard, tab-store, bulkPdfExport; Rust execute_batch (placeholder conversion incl. $N inside string literals, rollback)
- [ ] Bundle: single 4.1 MB chunk — lazy-load FullCalendar, tiptap, recharts, PDF stack (low urgency, desktop app)

False alarms reviewed and rejected: $LAST_INSERT_ID injection (i64-only), localStorage mode switching (webview already has execute_batch by design), javascript:/file: URLs via shell.open (plugin's default validator blocks them), supplier-merge finance invalidation (finance never aggregates by supplier).

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
