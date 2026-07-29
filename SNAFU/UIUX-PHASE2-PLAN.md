# UI/UX Phase 2 — Design System, i18n, Accessibility, UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every design-system violation, i18n straggler, and deferred UX/accessibility finding from the 2026-07-20 audit, plus the four user-approved UX upgrades (list-page skeletons, full inline form validation, line-item keyboard reorder, empty-state CTAs).

**Architecture:** Surgical fixes and small shared components. NO architecture refactors (DataTable, invoice/quote dedup, queryKeys, ensureSchema are recorded as future backlog — do not touch). All work follows `DESIGN-SYSTEM.md` at the project root — read it before any UI task.

**Tech Stack:** React 19 + TS strict, Tailwind v4 with CSS tokens, lucide-react, zustand, TanStack Query, vitest. ESLint now active (`npm run lint`).

**User decisions (locked):**
1. Skeleton loading states on the 7 main list pages (Clients, Projects, Tasks, Invoices, Quotes, Expenses, Income).
2. FULL inline form validation: visible labels, persistent required marks, per-field bilingual error messages; toast stays as backstop.
3. Drag-and-drop keyboard alternative: invoice/quote LINE ITEMS only (up/down buttons).
4. DataTable: NOT in this phase (recorded in memory + SNAFU backlog).

**Environment constraints (IMPORTANT for executors):**
- Project root: `/Users/loris.briguet/Library/CloudStorage/SynologyDrive-02_SD/03_Projects/2026/StudioManager`
- Slow Synology cloud drive. Do NOT run git commands. No commits — the user commits manually.
- Run targeted tests only (`npx vitest run src/__tests__/<file>`); the full suite + `npx tsc --noEmit` + `npm run lint` run once in the final task. Baseline: 173/173 tests, tsc clean, lint has exactly 19 known findings in 9 files (Task F1 clears them).
- Always Read files before editing. Line refs below are from the audit and may have drifted.
- Every new user-visible string: BOTH EN and FR sections of `src/i18n/ui.ts` (FR is deliberately accent-free — match).
- The phase-1 fixes (backup, deletion guards, dirty-guard, undo store, timer, notifyError, local dates) are LANDED and must not be disturbed. When editing a page, preserve its confirmIfDirty/undoableFromStore/notifyError wiring.
- DESIGN-SYSTEM.md rules apply to every line you write: tokens not gray classes, no `dark:` for tokenized colors, radius scale, canonical lucide icons at standard sizes, shared components, `useT()`.

---

## Group A — Design-system compliance

### Task A1: Workload tag colors onto the shared tagColors system

**Files:** `src/types/workload.ts` (~:68-83 TAG_COLORS + TAG_COLOR_NAMES), consumers (verified): `src/components/workload/WorkloadCell.tsx` (~:219), `SelectTagPicker.tsx` (~:70 AND ~:101 — two sites), `WorkloadColumnEditor.tsx` (~:299), `WorkloadTemplateManager.tsx` (~:183); reference: `src/lib/tagColors.ts` (has LIGHT/DARK palettes + getNamedTagColor).

Problem: a parallel 9-color map of raw Tailwind classes (`bg-gray-200`, `bg-amber-100`…), light-mode-only — tags are illegible in dark mode; contains the repo's only remaining gray-class violations.

- [ ] Read tagColors.ts and TAG_COLORS fully. The name sets DIFFER (verified): workload has `brown`/`pink` which tagColors' `getNamedTagColor` TS union (tagColors.ts:46) does not include. Colors are STORED as name strings in column-config JSON, and `DEFAULT_WORKLOAD_COLUMNS` in workload.ts hardcodes `"pink"` — so build a compat translation map (e.g. brown→orange, pink→red or the closest matches — enumerate your mapping) applied BEFORE calling getNamedTagColor. Do NOT migrate stored data; stored `brown`/`pink` names must keep rendering forever via the map.
- [ ] `TAG_COLOR_NAMES` (workload.ts:83) is used by SelectTagPicker:70 to assign colors to NEW tags — preserve a name list for that purpose (it may keep the legacy names, mapped at render, or switch to tagColors names for new assignments; judge and document).
- [ ] Replace TAG_COLORS usage with `getNamedTagColor(mappedName, darkMode)` style objects (read how tagColors consumers get darkMode — likely from the app store theme). Delete the TAG_COLORS class map once no consumer remains.
- [ ] Verify all 4 consumer files (plus workload.ts itself) render correctly in both themes (reason through the class→style change; check for any `text-gray-700` leftovers). Grep `bg-gray-|text-gray-|border-gray-` across src/ — expect ZERO hits after this task.
- [ ] `npx tsc --noEmit` clean.

### Task A2: Shared Button adoption + Button `lg` fix

**Files:** `src/components/ui/Button.tsx` (~:25 lg size), then sites: `src/components/QuickTimerModal.tsx` (~:159), `src/pages/ClientDetailPage.tsx` (~:93 + radius at :112), `src/components/workload/WorkloadTemplateManager.tsx` (~:96), `src/components/ProjectDetailContent.tsx` (~:490, :588, :921), `src/components/shared/LineItemsTable.tsx` (~:67), `src/components/SavedFilterBar.tsx` (~:293, :355), `src/components/NamedTable.tsx` (~:293), `src/components/workload/WorkloadTable.tsx` (~:937).

- [ ] Button.tsx: `lg` currently `px-5 py-2.5 text-sm` (same text as md — March audit item). Change to `text-base`. Grep `size="lg"` usages and eyeball none break.
- [ ] Replace each hand-rolled icon+text button with `<Button variant=... icon={<Icon size={14|16} />}>` per DESIGN-SYSTEM.md (primary for the primary actions, `link` variant for the link-style ones — judge per site by reading current styling intent). Icon-only buttons stay raw per the design system's explicit icon-only rule — do not convert those.
- [ ] SWEEP: the audit counted ~13 real violations but enumerated 11 sites — grep src/ for raw `<button>` elements containing both a lucide icon and text (the structural pattern the audit used), excluding the sanctioned dropdown-menu-item and icon-only patterns; convert any additional genuine violations found and enumerate them (acceptance criterion 2 is verified by re-running this sweep in G1).
- [ ] ClientDetailPage :93/:112: also fix `rounded-md` → correct radius via Button md.
- [ ] Verify no visual-behavior regression by matching current padding/size choices to the closest Button size. `npx tsc --noEmit`.

### Task A3: CalendarPage design-system adoption + radius stragglers

**Files:** `src/pages/CalendarPage.tsx` (quick-create popover ~:643, :680, :684, :709), `src/pages/ResourcesPage.tsx` (~:586), `src/pages/ProfilePage.tsx` (~:337).

- [ ] CalendarPage: import `Input`, `Select` from components/ui for the quick-create popover fields (or apply the sanctioned inline-editing raw pattern with correct `rounded-lg` + input tokens if the shared components genuinely don't fit the popover density — judge and justify); suggestions dropdown → `rounded-xl` + dropdown pattern (surface bg, border-header, shadow per DESIGN-SYSTEM.md).
- [ ] ResourcesPage:586 select `rounded` → `rounded-lg` + input tokens; ProfilePage:337 input `rounded` → `rounded-lg` + tokens (use shared components if the context allows).
- [ ] Grep `className="[^"]*\brounded\b` (bare rounded, 4px) across src/ — fix any other bare-rounded on inputs/selects/buttons found (enumerate). `npx tsc --noEmit`.

### Task A4: statusColors gap + unicode icon

**Files:** `src/lib/statusColors.ts`, `src/pages/ClientsPage.tsx` (~:178), `src/components/TaskDatePicker.tsx` (~:278).

- [ ] Add `clientStatusVariant(status)` to statusColors.ts (active → success, else neutral — read the client status model first); use it in ClientsPage.
- [ ] TaskDatePicker:278: standalone `→` span → lucide `MoveRight` or `ArrowRight` size 12 (pick per DESIGN-SYSTEM icon table; the `" → "` inside display LABEL strings (~:171,175) is typographic text — leave).
- [ ] `npx tsc --noEmit`.

## Group B — i18n stragglers

### Task B1: Every hardcoded user-visible string → i18n

**Files:** `src/i18n/ui.ts` (+ the files below).

Known stragglers from the audit (verify each still exists, fix, and GREP for more):
- [ ] `src/db/hooks/useInvoices.ts` ~:112 "PDF generation failed" → key.
- [ ] Placeholders/titles: `workload/SelectTagPicker.tsx:95` "Search or create...", `QuoteToProjectWizard.tsx:142` "min", `pages/ExpensesPage.tsx:386` "Preview receipt", `dashboard/widgets.tsx:1487` "Unknown widget", `SettingsPage.tsx:616` "Presentation active", `SettingsPage.tsx:800` "Auto".
- [ ] Language option labels: `ClientsPage.tsx:269-270` ("French/English") vs `SettingsPage.tsx:386-397` ("English/Francais") — one consistent i18n'd pair used in both.
- [ ] Mixed-language undo labels: grep `label:` pushes to the undo store across src/db/hooks/ (useProjects, useTasks, useInvoices, useQuotes, useExpenses, useIncome, and any others) — all hardcoded English labels → `getLabels()` keys, following the useClients.ts pattern from phase 1 (keys like undo_delete_project etc.). Enumerate every label converted.
- [ ] FR review item: `deadline` EN==FR — change FR to "echeance" (accent-free) IF the term appears as a user-visible label (check where used).
- [ ] Sweep: grep JSX for suspicious hardcoded strings (`>{"` patterns, `placeholder="[A-Z]`, `title="[A-Z]`) and fix what's genuinely user-visible (enumerate; skip technical hints the audit sanctioned: "e.g. PO-12345", format hints, font names).
- [ ] Do NOT do aria-labels here (Task C3 owns them, with keys). EN/FR parity check at the end: both sections must gain identical key sets. `npx tsc --noEmit`.

## Group C — Accessibility

### Task C1: Modal focus trap + restore

**Files:** `src/components/ui/Modal.tsx`.

- [ ] Modal.tsx ALREADY HAS (verified — do not re-implement): `role="dialog"`, `aria-modal="true"`, `aria-labelledby` wired to the title, `tabIndex={-1}`, focus-on-open, Escape-to-close. The ONLY real gaps: (a) a Tab/Shift+Tab focus trap (cycle within the dialog — small focusable-elements query loop, no new dependency), and (b) focus RESTORE to the previously-focused element on close. Implement exactly those two. (The hardcoded `aria-label="Close"` at ~:58 is owned by Task C3 — leave here.)
- [ ] Verify against a modal with inputs (ClientsPage new-client modal) and one with only buttons.
- [ ] `npx tsc --noEmit` + run `npx vitest run src/__tests__/` for any Modal-touching tests (grep first).

### Task C2: ContextMenu keyboard support + dedupe

**Files:** `src/components/ContextMenu.tsx`, `src/pages/ClientDetailPage.tsx` (~:682 inline duplicate).

- [ ] ContextMenu: `role="menu"`/`role="menuitem"`, focus moves into the menu on open, ArrowUp/Down cycling, Home/End, Enter activates, Escape closes (exists) and focus returns to the pre-open element. Disabled/danger items keep their styling.
- [ ] Replace ClientDetailPage's inline ad-hoc context menu with the shared component (read both; preserve exact items/actions incl. phase-1 confirm wiring).
- [ ] `npx tsc --noEmit`.

### Task C3: aria-labels everywhere + focus visibility + TabBar close button

**Files:** app-wide sweep + `src/index.css` + `src/components/layout/TabBar.tsx` + `src/i18n/ui.ts`.

- [ ] Global focus visibility: add a `button:focus-visible, [role="button"]:focus-visible` rule in index.css applying the same accent outline as `.focus-accent` (read that class; make the global rule NOT double-apply on elements that already use focus-accent). This covers the ~134 raw buttons systematically.
- [ ] aria-labels on ALL icon-only buttons: sweep src/ (grep for buttons whose children are only an icon). Known: calendar prev/next (CalendarPage ~:428), back arrows (ClientDetailPage ~:87, ProjectDetailPage ~:31 — note these may now be Button components from A2), close X's (ExpensesPage ~:517, IncomePage ~:451, DashboardPage ~:274), tag-remove X's (ResourcesPage ~:406/:558, SettingsPage ~:662/:1197), Sidebar nav toggles, TabBar buttons, Modal close (has one — verify), SearchBar clear (has one — verify), plus everything else found. All labels via `useT()` keys (add EN+FR; the 9 existing hardcoded aria-labels from the audit get keys too: "Drag to reorder" x4, "Close", "Clear search", "Move up"/"Move down", "Delete template").
- [ ] TabBar close target: the `<span onClick>` (~:30-35) sits INSIDE the TabItem root which is itself a `<button>` (~:16) — simply converting the span to a button creates invalid button-in-button HTML. RESTRUCTURE TabItem: outer element becomes a non-button container (either complete the ARIA tab pattern properly — `role="tablist"` on the bar + `role="tab"` with `aria-selected` on items — or use plain button-like semantics (`role="button"` + tabIndex + Enter/Space) on the container; do NOT ship a lone `role="tab"` without its tablist ancestor) containing the tab-activate area and a SIBLING real `<button>` for close (aria-label i18n'd, focusable, visible on `:focus-visible` not just hover). The middle-click close (`onAuxClick`) must move with the restructure; verify tab switching, closing, middle-click, and keyboard activation all work after.
- [ ] Enumerate every label added (file → element → key). `npx tsc --noEmit`.

## Group D — UX upgrades

### Task D1: Skeleton loading on the 7 list pages

**Files:** `src/components/ui/Skeleton.tsx` (exists), the 7 list pages; reference: ResourcesPage (already uses Skeleton).

- [ ] Read ResourcesPage's skeleton usage + each list page's loading state (PageSpinner today). Build a small shared `TableSkeleton` (rows × columns of Skeleton bars matching the table pattern: same px-4 py-2.5 rhythm) in components/ui — reuse across the 7 pages; each page passes its column shape (or a simple colCount).
- [ ] Replace each page's CURRENT loading state with TableSkeleton on: Clients, Projects, Tasks, Invoices, Quotes, Expenses, Income. (Note: IncomePage does not use PageSpinner — it renders raw `{t.loading}` text at ~:195; the others use PageSpinner. Replace whatever each page has.) Keep PageSpinner elsewhere (detail pages etc.). Respect each page's year-grouping/header layout (skeleton the table area only, keep the real page header so the title doesn't flash).
- [ ] `npx tsc --noEmit`; run any list-page tests that exist.

### Task D2: Busy states for long operations

**Files:** `src/pages/InvoicesPage.tsx` (handleDownloadPdf/handleEmailPdf ~:151-210), `src/pages/QuotesPage.tsx` (mirror), `src/pages/InvoicePreviewPage.tsx`/`QuotePreviewPage.tsx` (check for export buttons), `src/lib/pdfExtract.ts` + `src/pages/ExpensesPage.tsx` (OCR first-run).

- [ ] PDF export/email: per-invoice busy state — disable the triggering control and show a small spinner (or Button's loading pattern if one exists — read Button.tsx; add a minimal `loading` prop to Button if absent: spinner replaces icon, disabled) while the ~seconds-long generate+save runs; prevent double-fire. Apply to all PDF-generating actions on both list pages + preview pages + FinancesPage trustee export button (check its current disabled handling).
- [ ] OCR: on first run tesseract downloads ~15MB language data. In the drop-parse flow (ExpensesPage `parsing` state exists), extend the indicator text when the worker is initializing the first time (i18n key like `ocr_first_run_download` "Preparing text recognition (first run downloads language data)..."). Detect cheaply — read pdfExtract's worker init; a simple "worker not yet created → show the longer message" flag is fine.
- [ ] i18n EN+FR for new strings. `npx tsc --noEmit`.

### Task D3: Empty-state CTAs

**Files:** `src/components/ui/EmptyState.tsx` (action prop exists, unused), list pages + `src/pages/NotificationsPage.tsx` (~:76 raw text).

- [ ] Wire `action` on each list page's EmptyState: a primary Button that triggers the page's existing "new X" flow (Clients → new client modal, Invoices → navigate new invoice, etc. — read each page's create entry point). i18n the CTA labels (reuse existing "new_x" keys where present).
- [ ] NotificationsPage: adopt EmptyState (icon + message, no CTA needed).
- [ ] Search/filter-empty vs truly-empty: if a page distinguishes (search active → "no results"), only add the CTA to the truly-empty case (read each page; enumerate what you did per page).
- [ ] `npx tsc --noEmit`.

### Task D4: ProjectsPage parity — bulk selection + saved filters

**Files:** `src/pages/ProjectsPage.tsx`; references: `src/components/BulkActionBar.tsx`, `src/components/SavedFilterBar.tsx`, and a page that has both (e.g. ClientsPage or TasksPage).

- [ ] Read a reference page's selection + SavedFilterBar wiring end-to-end. Add to ProjectsPage: row checkboxes/selection state, BulkActionBar with the sensible bulk actions for projects (status change, delete with the phase-1 ask() confirm + per-item undo semantics — mirror how other pages handle bulk delete confirms), SavedFilterBar persisting the page's existing filters (read what filters ProjectsPage has: status/client/search).
- [ ] Keep ProjectsPage's existing context-menu/undo wiring intact. i18n any new strings. `npx tsc --noEmit`.

### Task D5: Line-item keyboard reorder

**Files:** `src/components/shared/LineItemsTable.tsx` (used by invoice + quote forms).

- [ ] Add up/down buttons per row (icon-only raw buttons per design system, lucide ChevronUp/ChevronDown size 14, aria-labels i18n'd `move_row_up`/`move_row_down`): swap with neighbor, disabled at first/last, calls the same reorder path the DnD uses (read how DnD reorder commits — reuse that function so undo/dirty behavior is identical). Keep DnD working.
- [ ] Buttons keyboard-focusable (they're buttons — verify focus-visible from C3 applies). `npx tsc --noEmit`.

## Group E — Full inline form validation

### Task E1: FormField pattern + Clients form (reference implementation)

**Files:** create `src/components/ui/FormField.tsx`; apply in `src/pages/ClientsPage.tsx` new/edit client form (+ its Modal), `src/i18n/ui.ts`.

- [ ] FormField: wraps a labeled control — visible `<label htmlFor>` (text-xs text-muted per typography scale), generated id wired to the child input, persistent required mark (accent asterisk), error slot below (text-xs, danger color, `role="alert"`), passes error state to the input (danger border token). Works with shared Input/Select and raw inputs. Keep it small (~60 lines); document the API in the file.
- [ ] Validation approach — NOTE the facts: `react-hook-form@^7.71.2` IS already in package.json but is used exactly once (ProfilePage.tsx useForm); everywhere else the app validates imperatively. Decision (locked): do NOT expand react-hook-form adoption (the InvoiceFormPage no-restructure constraint rules it out where it matters most); build a tiny `src/lib/validate.ts` with composable field rules (required, email, url, number>0, maxLen) returning i18n'd messages via getLabels; forms hold an `errors` record, validate on blur + on submit, clear on change. Bilingual messages (add keys EN+FR: field_required, invalid_email, invalid_url, invalid_number, etc.).
- [ ] Convert the Clients form fully: every field gets FormField (visible label, required marks on name etc.), inline errors, submit blocked with fields highlighted; keep the existing toast as backstop for non-field errors. Preserve dirty-guard wiring.
- [ ] `npx tsc --noEmit`; run any Clients tests.

### Task E2: Invoice + Quote forms

**Files:** `src/pages/InvoiceFormPage.tsx`, `src/pages/QuoteFormPage.tsx`.

- [ ] Apply FormField + validate.ts to both forms: client (required), invoice/quote date (required, valid date), line items (at least one with description+rate — inline error on the items table region), currency/rate fields (number>0 when manual), due date/valid until (valid date ≥ document date — judge sensible rules from the code). CAUTION: these files carry the phase-1 hydration/currency-effect machinery — do NOT restructure state; validation reads existing state, errors live alongside. The save() toast-validation branches become field errors (keep toast for DB failures).
- [ ] Bilingual messages; parity check. `npx tsc --noEmit`; run invoiceDelete/recurringDates tests as regression canaries.

### Task E3: Expenses, Income, Resources forms (+ sweep)

**Files:** `src/pages/ExpensesPage.tsx`, `src/pages/IncomePage.tsx`, `src/pages/ResourcesPage.tsx`; sweep other entry forms (SettingsPage category/list managers, QuickTimerModal, wizard) and apply where a form genuinely takes user input (enumerate included/excluded with reasons). **ProfilePage special case:** it is the ONE react-hook-form-managed form (useForm at ProfilePage.tsx:~49) — the manual errors-record pattern would collide with RHF state. Either wire FormField purely presentationally around RHF's own register/errors, or exclude ProfilePage with a stated reason. Judge after reading it; do not rip out RHF.
- [ ] Same pattern: FormField + inline errors (supplier/amount/date for expenses; source/amount/date income; name/url resources — url validated).
- [ ] `npx tsc --noEmit`.

## Group F — Lint zero

### Task F1: Clear the 19 known findings + disable hygiene

**Files:** `src/components/NamedTable.tsx`, `ProjectDetailContent.tsx`, `workload/WorkloadColumnEditor.tsx`, `workload/WorkloadTable.tsx` (8 exhaustive-deps warnings + no-useless-assignment), `src/lib/formulaEval.ts`, `src/lib/invoicePdfStore.ts` (control-regex pair — fix like backup.ts did), `src/pages/CalendarPage.tsx`, `src/pages/InvoicePreviewPage.tsx`, `src/pages/ProfilePage.tsx`, `src/pages/SettingsPage.tsx` (~:855 reason-less disable).

- [ ] Same rules as phase 1: minimal semantics-preserving fixes; deliberate dep omissions get a disable WITH reason; genuine stale-closure bugs get fixed and highlighted. WorkloadTable is the risky one (1200 lines, 8 warnings) — extra care, read the whole file first.
- [ ] End state: `npm run lint` exit 0, ZERO findings. `npx tsc --noEmit`.

## Group G — Final verification

### Task G1: Full sweep + design-system compliance re-audit + test-plan update

- [ ] `npx tsc --noEmit` (0), `npx vitest run` (all pass; count vs 173 baseline), `npm run lint` (exit 0).
- [ ] Design-system grep audit (the DESIGN-SYSTEM.md checklist, mechanized): zero `bg-gray-|text-gray-|border-gray-|divide-gray-` in src/; zero `dark:` color prefixes (except sanctioned semantic); zero bare `rounded"` on interactive elements; zero unicode icons in JSX; EN/FR key parity (count both sections); re-run A2's structural sweep for raw `<button>` with icon+text children (must find zero genuine violations — acceptance criterion 2).
- [ ] Append a "Phase 2 — UI/UX" section to `SNAFU/AUDIT-FIXES-TEST-PLAN.md`: manual checks for dark-mode workload tags, keyboard-only session (tab through a list page, open context menu, reorder a line item, close a tab, work a modal), skeleton appearance, empty-state CTAs, inline validation on each form (EN + FR), busy states, ProjectsPage bulk/filters, AND a dedicated WorkloadTable interaction pass (edit cells of each column type, reorder rows, apply a template, tag colors in both themes) — F1's exhaustive-deps fixes there are the phase's highest behavioral-regression risk and tests barely cover it.
- [ ] Report completion with the compliance-grep results.

## Acceptance criteria
1. Workload tags legible in dark mode; zero gray-class hits in src/.
2. All 13 hand-rolled icon+text buttons use shared Button; Button lg is text-base.
3. CalendarPage popover fields match the input pattern; no bare `rounded` on interactive elements anywhere.
4. Client status badge uses statusColors; no unicode icons in JSX.
5. Every user-visible string (incl. all undo labels and aria-labels) resolves through i18n with EN/FR parity; language labels consistent across pages.
6. Modal traps and restores focus; context menus fully keyboard-operable; every icon-only button has an i18n aria-label; raw buttons show focus rings; TabBar close is a real focusable button.
7. The 7 list pages show table skeletons while loading; empty states have working CTAs; PDF/export actions show busy state and can't double-fire; first OCR run explains the download.
8. ProjectsPage has bulk selection + saved filters on par with other list pages.
9. Line items reorder via visible up/down buttons AND DnD.
10. All main entity forms have visible labels, persistent required marks, and inline bilingual field errors on blur/submit.
11. `npm run lint` exits 0 with zero findings; tsc clean; full test suite green.
