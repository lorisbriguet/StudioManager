# StudioManager — Audit Fixes: Manual Test Plan

This is a hands-on checklist to verify every fix from the audit. Work through it top to bottom, ticking the boxes. Each section is independent, so you can spread it over several sessions.

**Before you start:** make a backup of your real data (Settings → Backup → Create backup now) AND copy that backup folder somewhere safe outside the app. Several tests below deliberately delete and restore data.

Automated checks already passed before this plan was written: TypeScript clean, all 173 unit tests green, Rust build clean.

---

## 1. Backup and Restore

- [ ] 1.1 Go to Settings → Backup and create a backup. Open the backup folder in Finder: it should contain **32 CSV files** (one per table: clients, projects, tasks, subtasks, invoices, invoice_line_items, quotes, quote_line_items, expenses, income, time_entries, wiki_articles, wiki_article_tags, wiki_folders, custom_lists, custom_list_items, client_contacts, client_addresses, business_profile, expense_categories, invoice_templates, workload_templates, resources, saved_filters, dashboard_presets, notifications, project_tables, project_table_rows, resource_projects, resource_tags, workload_rows, recurring_invoice_templates).
- [ ] 1.2 Before backing up, add a client note (or invoice note) with **several lines of text** (press Enter a few times, write on multiple lines). Create a fresh backup afterwards.
- [ ] 1.3 Restore that backup. You should see a **success toast** that reports **0 "values defaulted"** and mentions that a **safety backup** was created automatically first (a folder named `backup-<timestamp>` — check it exists).
- [ ] 1.4 After restoring, spot-check that everything is intact: clients, projects, tasks, invoices, **income entries**, **time entries**, **wiki articles**, and **custom lists** (these last four were previously lost on restore).
- [ ] 1.5 Open the multi-line note from step 1.2 — it must be exactly as you typed it, line breaks included. Also check a record where you deliberately left a field **empty**: it must still be empty after restore (no "null" text, no default value filled in).
- [ ] 1.6 Create an empty folder in Finder and try to restore from it. You must get a **clear error message**, and **none of your data should be wiped**. The error should say that no changes were made.
- [ ] 1.7 (Optional, more thorough) Copy a backup folder, open one of its CSV files and mangle it (delete half the lines, save). Try restoring from the mangled copy: same expectation — clear error, no data lost.

## 2. Invoices — QR-bill

- [ ] 2.1 Open a **CHF** invoice and generate the PDF. The Swiss QR payment part must be present at the bottom and look correct (your IBAN, the client, the amount).
- [ ] 2.2 Create or open a **EUR** invoice and generate the PDF. There must be **no QR section at all** — not an empty box, simply absent.
- [ ] 2.3 Repeat 2.2 with a USD or GBP invoice.
- [ ] 2.4 Generate a **payment reminder PDF** for a foreign-currency invoice: also no QR part.
- [ ] 2.5 Open the invoice **template editor**. Its preview should still show the CHF example with the QR part (the preview is always CHF).

## 3. Invoices — Deletion and numbering

- [ ] 3.1 Right-click a **sent**, **paid**, or **overdue** invoice: there must be **no Delete option** in the context menu. Select several such invoices: the bulk action bar must not offer Delete either. (If deletion is somehow triggered anyway, a toast should explain why it is blocked.)
- [ ] 3.2 Cancelling a sent invoice still works (cancel is allowed; delete is not).
- [ ] 3.3 Delete a **draft** invoice: it works, and a toast with an **Undo** button appears. Click Undo — the draft comes back complete.
- [ ] 3.4 With drafts numbered e.g. 2026-014 and 2026-015, delete 2026-014. Invoice 2026-015 must **keep its number** (no renumbering).
- [ ] 3.5 With a gap in the sequence (from step 3.4), create a new invoice: its number must be **highest + 1** (e.g. 2026-016), never reusing the gap.

## 4. Invoices — Edits don't corrupt old data

- [ ] 4.1 Open an **old EUR invoice**, change **only the note**, and save. Reopen it: the exchange rate, the CHF equivalent, the discount, and the due date must all be **exactly as before**. (Optional: verify in the database with a SQLite viewer — columns `exchange_rate`, `chf_equivalent`, `discount`, `due_date`.)
- [ ] 4.2 Repeat 4.1 but reach the edit form via **Preview → Edit** shortly after viewing the preview (this "warm cache" path had a specific bug that was fixed).
- [ ] 4.3 In an old EUR invoice, switch the currency EUR → USD → back to EUR, then save. The **original historical EUR rate** must be restored, not today's rate.
- [ ] 4.4 Toggle a client's discount setting on or off. Open one of that client's **old invoices**: its totals must be unchanged (client settings never rewrite history).
- [ ] 4.5 Set default payment terms in your Profile (e.g. 20 days). Create a new invoice: the due date should be issue date + 20 days.

## 5. Exchange rate when offline

- [ ] 5.1 Turn off Wi-Fi (and unplug Ethernet). Create a **EUR** invoice. You must get an **error toast saying the rate is unavailable**. The CHF equivalent shows **0** and the rate field is **manually editable**. Nothing is silently saved at face value (1 EUR = 1 CHF).
- [ ] 5.2 Enter a rate by hand and save — that works. Reconnect to the internet afterwards.

## 6. Rounding

- [ ] 6.1 Create an invoice line: quantity **3**, unit price **21.90**. The line total must show **65.70** exactly (not 65.69 or 65.7000000001), both on screen and in the PDF.

## 7. Data freshness

- [ ] 7.1 Mark an invoice as **paid**. Switch to Finances and the dashboard immediately: the numbers must already reflect the payment (previously they could lag up to 5 minutes).
- [ ] 7.2 Edit an invoice's line items, save, and open its preview right away: the preview shows the **new** line items.

## 8. Failures are visible, never silent

- [ ] 8.1 In Settings, point the backup location at a folder that does not exist (or one the app is not allowed to write to). The next backup attempt must show a **visible error toast**. If the folder is outside the app's allowed locations, the message is distinct and **names the allowed locations** (including cloud drives).
- [ ] 8.2 In macOS System Settings → Privacy & Security → Calendars, revoke StudioManager's calendar access. Trigger a calendar sync: you get **one summary error toast** per sync (not a flood, not silence). Re-enable access afterwards.
- [ ] 8.3 Database startup failure shows a full-screen fatal error instead of a blank window. **Skipped — cannot be triggered safely by hand.** (Verified in code review.)

## 9. Deleting things — confirmation and undo

- [ ] 9.1 Right-click a test client and choose Delete. The confirmation dialog must **name all related data** that will go with it (projects, invoices, quotes, tasks, etc.).
- [ ] 9.2 Confirm the delete, then press **Cmd+Z**. **Everything** must come back: the client, its projects, invoices **with their line items**, quotes, tasks **with subtasks**, contacts, addresses, time entries, recurring templates, project tables, and resource links. Check each.
- [ ] 9.3 Delete a task that has subtasks, then undo: the subtasks are restored too.
- [ ] 9.4 Delete a single row in each of these areas and confirm an **undo-style toast** appears each time: Clients, Projects, Tasks, Invoices (drafts), Quotes, Expenses, Income.

## 10. Timer

- [ ] 10.1 Start a timer, then **quit the app completely** (Cmd+Q). Wait a minute or two. Relaunch: the timer is **still running** and the elapsed time **includes the time the app was closed**.
- [ ] 10.2 Stop it: the saved time entry covers the full duration, gap included.
- [ ] 10.3 If saving a time entry ever fails, the timer keeps running and an error toast appears. **Hard to trigger by hand — skip unless it happens naturally; just know a failed save must never silently discard your tracked time.**

## 11. Undo/redo and the Wiki editor

- [ ] 11.1 In a Wiki article, type some text, then press **Cmd+Z**: only the **text** is undone. It must never undo an app action (like a delete elsewhere) while you're typing in the editor.
- [ ] 11.2 Press **Cmd+Shift+Z** in the editor: redo works (this was broken before).
- [ ] 11.3 If an app-level undo ever fails, you get an error toast and can **retry** the undo — the action isn't lost.

## 12. Keyboard shortcuts

- [ ] 12.1 **Cmd+Shift+T** opens the Quick Timer.
- [ ] 12.2 Close a tab, then press **Cmd+Shift+Y**: the last closed tab reopens (new shortcut — this used to do nothing).
- [ ] 12.3 **Escape** closes the command palette.

## 13. Unsaved changes protection

Open an invoice form and make a change **without saving** ("dirty" form). Then try each of these — **every one** must show a Stay / Leave prompt:

- [ ] 13.1 Cmd+W (close tab)
- [ ] 13.2 Cmd+T (new tab)
- [ ] 13.3 Ctrl+Tab (next tab)
- [ ] 13.4 Cmd+1…9 (jump to tab)
- [ ] 13.5 Clicking another tab
- [ ] 13.6 Clicking the tab's close X
- [ ] 13.7 Clicking "+" (new tab button)
- [ ] 13.8 Navigating via the Cmd+K command palette
- [ ] 13.9 Sidebar navigation with arrow keys
- [ ] 13.10 The back arrow
- [ ] 13.11 The form's own Cancel button
- [ ] 13.12 On a dirty **quote** form: clicking Preview

Also check:

- [ ] 13.13 Closing a **background** tab (not the one with the dirty form) does **not** prompt.
- [ ] 13.14 A clean (saved/untouched) form navigates freely with no prompt.
- [ ] 13.15 Editing a client on the **client detail page** and navigating away also prompts.

## 14. Dates, aging, and recurring invoices

- [ ] 14.1 The invoice **aging widget** buckets by your local date, and an unpaid **USD** invoice appears at its **CHF equivalent**, not its face value.
- [ ] 14.2 Create a task due **Jan 31** (and try Mar 31 or May 31): the calendar event lands on **exactly** that date, not the day before or after.
- [ ] 14.3 Recurring invoices catch-up: set (or simulate) a monthly recurring template whose next-due date is **3 months in the past**, then launch the app. It must generate **3 drafts in that single launch**, each dated to its own period. The anchor day survives short months: a template anchored on **Jan 31** falls due on **Feb 28**, then back on **Mar 31** (not Mar 28).
  - **Note:** catch-up drafts are dated in the past, so they will show as overdue soon after you send them. Edit their dates before sending if that's not what you want.
- [ ] 14.4 An entry created near **midnight** shows the correct **local** day in lists (not the previous/next day).

## 15. File access and security

- [ ] 15.1 The app can only read and write inside: its own app-data folder, **Documents**, **Downloads**, **Desktop**, and **~/Library/CloudStorage** (cloud drives). Backing up to a folder in Documents works; picking a folder elsewhere (e.g. directly in your home folder) is refused with a clear message.
  - **Note for you to veto:** CloudStorage access was added beyond the original four locations because your data lives on Synology Drive. A tighter scope (just the Synology mount, not all cloud drives) is possible if you prefer — say so.
- [ ] 15.2 Existing expense **receipts** stored in the app-data folder still preview correctly.
- [ ] 15.3 "Reveal in Finder"-type actions on a file that no longer exists show a **visible error**, not nothing. Likewise, a receipt whose stored location is **outside the allowed folders** must show a visible error when you try to preview it — never fail silently.
- [ ] 15.4 Add or change **tags on a wiki article** and save — still works (the saving mechanism changed internally).

## 16. General regression sweep

Nothing here was intentionally changed, but confirm the everyday flows still work end to end:

- [ ] 16.1 Create an invoice → edit it → send it → mark it paid.
- [ ] 16.2 Create a quote → convert it to an invoice.
- [ ] 16.3 Add an expense with a receipt and run OCR. Test specifically with **a HEIC photo** and **a file with an apostrophe in its name** (e.g. `reçu d'achat.pdf`) — file-name handling was fixed.
- [ ] 16.4 Run the trustee export.
- [ ] 16.5 Open presentation mode.
- [ ] 16.6 Backup rotation: with "keep N backups" set (e.g. 3), create more than N backups and confirm the **oldest ones are actually deleted** (pruning silently failed before due to a missing permission).

---

## Known deferred items (phase 2)

Not bugs in this release — logged for a future cleanup pass:

- 19 lint findings in 9 files (NamedTable, ProjectDetailContent, WorkloadColumnEditor, WorkloadTable, formulaEval, invoicePdfStore, CalendarPage, InvoicePreviewPage, ProfilePage).
- React Compiler lint rule families still disabled.
- Invoice/quote code duplication to be consolidated.
- A shared queryKeys factory for data caching.
- ensureSchema consolidation.
- Accessibility and small UX items.
- i18n stragglers, including mixed-language undo labels outside useClients.
- Save-then-preview flow for quotes.
- Shared DataTable / PageHeader components.

---

# Phase 2 — UI/UX

Hands-on checks for the phase-2 UI/UX pass. Automated checks already passed before this section was written: TypeScript clean, all 219 unit tests green, ESLint zero findings.

Some checks ask you to switch language (Settings → Language) or theme (Settings → Appearance) — switch back when done.

## 17. Dark mode — workload tags

- [ ] 17.1 Switch to dark mode and open a project's workload table (or any table with colored tags). Every tag must be clearly legible — no dark text on a dark chip, no washed-out chips.
- [ ] 17.2 If you have old rows whose tags were saved with the **brown** or **pink** colors (removed from the palette), they must still render — brown shows as **orange**, pink shows as **red**. No blank or black chips.

## 18. Keyboard-only session

Put the mouse aside for this section.

- [ ] 18.1 Open a list page (e.g. Invoices) and press Tab repeatedly: every button you land on shows a **visible focus ring**. Nothing focusable is invisible-when-focused.
- [ ] 18.2 Context menus still open by **right-click only** (there is no keyboard shortcut to open them — this is a known limitation, see the deferred list). But once a menu is open with the mouse, it is fully keyboard-operable: **arrow keys** move the highlight, **Home/End** jump to first/last item, **Enter** activates, **Escape** closes and returns focus.
- [ ] 18.3 Open an invoice form with a few line items. Each row has **up/down arrow buttons**: tab to one and press Enter — the row moves, and the order survives saving.
- [ ] 18.4 Tab into the tab bar, land on a tab's **X** button, press Enter: the tab closes.
- [ ] 18.5 Open any modal (e.g. New Expense). **Tab cycles only inside the modal** (it never escapes to the page behind), **Escape closes it**, and after closing, focus **returns to the button that opened it**.

## 19. Loading skeletons

To see loading states you may need a first launch of the day or a large dataset; alternatively quit and relaunch the app and look fast.

- [ ] 19.1 Each of the 7 list pages — **Clients, Projects, Invoices, Quotes, Expenses, Income, Resources** — shows a **table-shaped shimmer** while loading: the page header is already visible, the rows shimmer. No spinner, no flash of a spinner before the table.
- [ ] 19.2 Turn on **Reduce Motion** (macOS System Settings → Accessibility → Display). The skeletons still appear but **do not shimmer** (static placeholder). Turn Reduce Motion back off.

## 20. Empty states

- [ ] 20.1 On a list page with data, apply a filter or search that matches nothing: the empty message must be the **"no results for this filter"** variant, not the "you have no data yet" one.
- [ ] 20.2 On a truly empty list (use test mode to get one safely), the empty state shows a **New X button that works** — clicking it opens the same creation flow as the header button.
- [ ] 20.3 The **Tasks page has no empty-state block by design** — an empty Tasks page is not a bug.

## 21. Busy states — nothing double-fires

- [ ] 21.1 Download (or email) an invoice PDF: a **loading toast** appears. Double-click the action rapidly — only **one** PDF/email results; the second click does nothing.
- [ ] 21.2 On the invoice preview page, the export button shows a **spinner** while generating.
- [ ] 21.3 On a machine (or fresh profile) that has never run OCR: drop a receipt on Expenses. A message about **downloading the OCR language data** appears the first time instead of a silent stall.

## 22. Projects page — cards, bulk actions, saved filters

- [ ] 22.1 Hover a project card: a **checkbox** appears. Check one, then **Shift-click** another card's checkbox: the whole **range** between them gets selected.
- [ ] 22.2 With several cards selected, use the bulk bar to **change status** — all update. Then bulk **delete** test projects: an **Undo toast** appears, and Undo restores every one of them.
- [ ] 22.3 Build a filter, save it as a named filter, switch away and back (or relaunch): loading the saved filter restores **exactly** the same conditions.

## 23. Inline form validation

Do this once in **EN** and spot-check a couple of forms in **FR** — the inline messages must be translated (and note: FR strings in this app intentionally avoid accented letters).

For each of these forms — **Clients, Invoice, Quote, Expenses, Income, Resources, and the Quote-to-Project wizard's step 2**:

- [ ] 23.1 Submit the form **empty**: inline error messages appear under the offending fields and the fields get the **danger border** — no browser popup, no toast-only error.
- [ ] 23.2 Start typing in an errored field: the error **clears as you type** (on change), not only on the next submit.
- [ ] 23.3 Leave a required field empty and **click out of it** (blur): it validates immediately.
- [ ] 23.4 Invoice-specific: offline (Wi-Fi off), create a **EUR** invoice so the CHF equivalent is 0 — saving is **blocked with an inline error** on the rate field, not saved at a bogus rate. Reconnect afterwards.
- [ ] 23.5 Resources-specific: entering a bare domain like `example.com` (no https://) is **accepted** as a valid URL.

## 24. Workload tables — interaction pass

The workload table internals were touched; confirm everything behaves as before.

- [ ] 24.1 Edit a cell of **each column type** (text, number, select/tag, date, checkbox, formula if present): editing, committing with Enter, and cancelling with Escape all work.
- [ ] 24.2 **Resize a column** by dragging its edge — the width sticks.
- [ ] 24.3 **Apply a template** to a table, and **save** the current table as a template — both round-trip.
- [ ] 24.4 **Reorder rows** by drag — order sticks after reload.
- [ ] 24.5 Project table (NamedTable) column editor: open a column's settings, **link or unlink a custom list**, then click **outside** the editor to close it. Reopen it: the change **persisted**. (This was a fixed bug — the click-outside used to discard the change.)

## 25. Tab bar

- [ ] 25.1 **Middle-click** a background tab: it closes.
- [ ] 25.2 Click a background tab's **X**: it closes **without switching** you to it first.
- [ ] 25.3 With the keyboard, Tab reaches both the tab itself and its X button (see 18.4).

## 26. Toggle switches announce their names (optional)

- [ ] 26.1 (Optional — VoiceOver) Turn on VoiceOver (Cmd+F5) and land on a toggle in Settings: VoiceOver announces the **setting's name** and its on/off state, not just "switch". Spot-check two or three toggles.

## 27. Invoice preview — cancelled/TBD invoices

- [ ] 27.1 Open the preview of a **cancelled** invoice (and one with a TBD/unnumbered state if you have one): once loaded, the preview renders **with the invoice template applied** — no unstyled or stale render. (This was a fixed staleness bug.)

---

## Phase 2 deferred/known items

Not bugs in this pass — logged deliberately:

- **FullCalendar internal buttons suppress focus rings** — pre-existing `!important` rules inside the calendar library's styling; the rest of the app's focus rings are unaffected.
- **Icon-only shared-Button inconsistency (x3)** — the invoice form's back arrow, the quote form's back arrow, and the project detail page's delete button use the shared `Button` icon-only, which the design system reserves for raw buttons. All three are labeled and work; purely cosmetic.
- **Consumer-less i18n keys** — `supplier_required`, `amount_required`, `add_line_item` exist in both languages but have no consumer yet (verified by grep). Remove or wire up in a later pass.
- **Language picker shows translated names, not endonyms** (e.g. "French" in the EN UI rather than "Français") — product call, revisit if wanted.
- **DataTable component, invoice/quote dedup, queryKeys factory, ensureSchema consolidation** — backlog unchanged from phase 1.
