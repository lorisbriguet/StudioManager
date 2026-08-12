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

### Do now (safe batch)
- [ ] `npm audit fix` — 14 vulnerabilities (11 high), all dev/transitive, fixes available
- [ ] `npm update` — ~35 minor/patch bumps within current majors (incl. happy-dom CVE fixes, all Tauri plugins, React 19.2.8, TanStack Query 5.101, tiptap 3.30)
- [ ] `cargo update` + rusqlite 0.31 → latest minor (bundled SQLite CVE fixes)
- [ ] lucide-react 0.577 → 1.x (check renamed icons)
- [ ] @testing-library/jest-dom 6 → 7 (dev-only)

### Plan as own branch
- [ ] Vite 7 → 8 (Rolldown bundler, ~10-30x faster prod builds) + @vitejs/plugin-react 6 — verify vitest compatibility first
- [ ] Replace tesseract.js with Apple Vision OCR (`VNRecognizeTextRequest`) via a Tauri command — better receipt photo accuracy, no 15 MB language downloads, macOS-only app anyway

### Deferred — revisit later
- [ ] TypeScript 5.9 → 7.x (Go-native compiler, ~10x builds) — BLOCKED until TS 7.1 ships its stable API and typescript-eslint supports it
- [ ] FullCalendar 6 → 7 — new temporal-polyfill peer dep, package restructure, custom CSS breaks; upgrade only when v7 features are wanted
- [ ] TanStack Table 8 → 9 — real API migration (`useTable`, opt-in features, readonly data); benefit is bundle size, no current pain

## Bug fixes — reported (2026-08-12)

- [ ] Charges sociales (CS) not rendered in the Finances data visualization
- [ ] Editing paid date: Enter key doesn't trigger save — only clicking the save button works. Do an app-wide sweep: every inline edit / small form should submit on Enter
- [ ] Invoice export from preview with "mark as sent and export": exported file still has a draft name, and the preview window soft-locks afterwards

## UX/UI improvements (2026-08-12)

- [ ] "Detected from receipt" indicators — tint OCR-prefilled fields (supplier/amount/dates) with a badge + one-click clear, so wrong extractions don't look hand-typed
- [ ] Supplier merge tool in Settings — pick canonical name, relink expenses (dedupe "Adobe"/"Adobe Cloud"/"Adobe Systems…", "Fairtiq"/"FairtiQ", Figma variants); improves autofill + fuzzy matching
- [ ] Untranslated-activity nudge — badge in Settings editor (and on first EN-client invoice) where name_fr === name_en
- [ ] Stable chart colors per activity — derive color from activity id instead of row index so colors don't shift with ranking
- [ ] Dashboard year switcher — widgets hardcode current year (January cliff); add year selector or "last 12 months" toggle
- [ ] YoY deltas on dashboard KPIs — "+12% vs last year" badges
- [ ] One-click "mark paid today" on invoice/expense rows
- [ ] Undo toast for expense/income deletion (extend the client-delete undo pattern)

## Security hardening (2026-08-12)

- [ ] Retire arbitrary osascript execution — replace Mail sharing, Calendar sync, and PDF/HEIC extraction with dedicated Rust Tauri commands (fixed scripts, path args only), then drop `shell:allow-execute` from capabilities. Overlaps with the Apple Vision OCR item
- [ ] Notarize the app — add APPLE_ID / API-key notarization to the release flow so users stop bypassing Gatekeeper
- [ ] Automate dependency auditing — scheduled GitHub Action for `npm audit` + `cargo audit` (or Dependabot) so vulnerabilities surface as notifications

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
