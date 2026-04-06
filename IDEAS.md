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

## Medium Priority

- [ ] Quick-add from menu bar — Tauri system tray (log time, create expense, start timer)
- [ ] Update presentation mode seeds (many versions behind)
- [ ] Separate Tasks and meetings (create a new meeting block in projects, time track available for meetings)

## Low Priority

- [ ] Resizable side peek snap positions
- [ ] Mobile app companion
