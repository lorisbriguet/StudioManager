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

## V1.11.0 — Planned

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
