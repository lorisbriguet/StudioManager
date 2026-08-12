# Activities: Entities with User-Defined FR/EN Names

**Date:** 2026-08-12
**Status:** Approved

## Problem

Activities are free-text snapshots. `invoices.activity` and `quotes.activity`
are plain `TEXT` columns (`001_initial_schema.sql:92,130`); the selectable
list lives as a JSON string array in `business_profile.default_activity`.
Consequences observed in real data:

- "Revenue by Activity" groups by raw string (`src/db/queries/finance.ts:122`,
  `GROUP BY activity`, no trim, case-sensitive). The user's data contains
  `Graphic Design` (4×), `Graphic Design ` (trailing space, 1×) and
  `Graphisme` (36×) — three chart rows for one real activity.
- The activity text is printed on invoice/quote PDFs
  (`InvoicePDF.tsx:373`, `QuotePDF.tsx:317`) and should follow the invoice
  language, so the user types French names on FR invoices and English names
  on EN invoices — guaranteeing string divergence.
- Renaming an activity in the profile never updates historical invoices.

## Decision summary

- Activities become entities with user-editable French and English names
  (two-column editor in Settings — the i18n is user-made).
- Historical invoices are **not rewritten**: their stored text stays as-is;
  the chart merges them by resolving text against activity names.
- New invoices additionally store `activity_id`, making them rename-proof.

## Design

### 1. Data model — migration 006

`src-tauri/migrations/006_activities.sql`, registered as version 6 in
`src-tauri/src/lib.rs`:

```sql
CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_fr TEXT NOT NULL,
    name_en TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE invoices ADD COLUMN activity_id INTEGER;
ALTER TABLE quotes ADD COLUMN activity_id INTEGER;
```

No foreign-key constraint (SQLite `ALTER TABLE` limitation and deletion
semantics below make a plain nullable integer sufficient).

### 2. Seeding

App-side, on first read (in the activities query layer): if `activities` is
empty, parse `business_profile.default_activity` — a JSON string array
(e.g. `'["Graphisme","Media Interaction Design"]'`) or, for old profiles, a
plain string — and insert each distinct trimmed entry with
`name_fr = name_en = value`, `sort_order` = list position. The user fills in
the other language in Settings afterwards. `default_activity` is no longer
read or written anywhere else after this seed path.

Seed parsing is a pure exported function (`parseDefaultActivities(raw:
string): string[]`) so it is unit-testable.

### 3. Queries and hooks

New `src/db/queries/activities.ts`:

- `getActivities(): Promise<Activity[]>` — ordered by `sort_order`, runs the
  seed if the table is empty
- `createActivity(name_fr, name_en)` — trims both; `sort_order` = max + 1
- `updateActivity(id, { name_fr, name_en })` — trims
- `deleteActivity(id)`

`Activity` type: `{ id: number; name_fr: string; name_en: string;
sort_order: number }` in `src/types/activity.ts`.

New `src/db/hooks/useActivities.ts` with TanStack Query hooks following the
existing hook patterns (query key in `src/lib/queryKeys.ts`).

### 4. Settings UI

In `src/pages/ProfilePage.tsx` (Invoice Defaults section), replace the
single-input activity list with a two-column editor backed by the
`activities` table:

- One row per activity: FR name input | EN name input | remove button
- An add row (both names; empty EN defaults to the FR value on save,
  and vice versa)
- New i18n keys in `src/i18n/ui.ts` for the column headers and labels
  (e.g. `activity_name_fr`, `activity_name_en`)

No drag-reorder (YAGNI — creation order is kept via `sort_order`).

### 5. Invoice and quote forms

`InvoiceFormPage.tsx` (and the quote form path):

- The activity `<select>` lists activities from `useActivities`, labeled in
  the **invoice's language** (`language === "FR" ? name_fr : name_en`)
- Selected value is the activity id; on save the form writes both:
  - `activity_id` = the id
  - `activity` = the language-appropriate name, trimmed (text snapshot —
    keeps PDFs, exports, and all existing consumers unchanged)
- Editing an existing record whose stored text matches no current activity
  shows that text as an extra selectable option (unchanged from today's
  behavior for out-of-list values); choosing it keeps `activity_id` NULL
- Default for new invoices: first activity by `sort_order`
- Changing the invoice language with an activity selected refreshes the
  snapshot text on save (snapshot is always derived from id + language at
  save time)

### 6. Revenue by Activity — deduplication

`src/db/queries/finance.ts` revenue-by-activity query returns per-invoice
resolution instead of raw-string groups:

- Resolution key per invoice: `activity_id` if set, else the id of an
  activity whose `LOWER(TRIM(name_fr))` or `LOWER(TRIM(name_en))` equals
  `LOWER(TRIM(invoices.activity))`, else the normalized text itself
- Grouping and summing happen over the resolution key (SQL join on the
  name match; final label choice in TS)
- Row label: the activity's name in the current app UI language; unmatched
  legacy text renders as its raw trimmed string (never silently dropped);
  empty/NULL stays the existing `N/A` bucket
- The widget (`widgets.tsx` RevenueByActivity) keeps index-based colors

The resolution/aggregation from query rows to chart rows is a pure exported
function so it is unit-testable with fixture rows.

### 7. Deletion semantics

Deleting an activity leaves invoices untouched. A dangling `activity_id`
(no matching activities row) falls back to text resolution, so history
still appears in the chart under its stored text.

### 8. Testing

- Unit tests (vitest, `src/__tests__/`): `parseDefaultActivities` (JSON
  array, plain string, empty, malformed), and the chart resolution function
  (id match, FR-name match, EN-name match, trailing-space merge,
  unmatched text preserved, N/A bucket)
- Full suite + lint + build green before merge

## Out of scope (YAGNI)

- Rewriting historical invoice/quote rows or regenerating PDFs
- Activity merge tooling in the UI
- Drag-and-drop reordering of activities
- Additional languages beyond FR/EN (matches the app's existing two-language
  model, e.g. `expense_categories.name_fr/name_en`)
