# Activities i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn activities into entities with user-editable FR/EN names so invoice PDFs print the client's language and the Revenue-by-Activity chart stops splitting one activity into several rows.

**Architecture:** New `activities` table (id, name_fr, name_en, sort_order) + nullable `activity_id` on invoices/quotes. Forms store the id *and* a language-appropriate text snapshot (PDFs/exports unchanged). The chart resolves legacy text against activity names in a pure, unit-tested function. Historical rows are never rewritten.

**Tech Stack:** Tauri v2 (Rust migration registration), SQLite, React 19 + TypeScript, TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-08-12-activities-i18n-design.md`

## Global Constraints

- No new dependencies.
- Historical invoices/quotes are NOT rewritten — their stored `activity` text stays untouched.
- Text snapshots are always trimmed on save.
- Chart resolution: `activity_id` if valid → else case-insensitive trimmed match against any activity's `name_fr`/`name_en` → else the raw trimmed text as its own row (never dropped); empty text stays the `N/A` bucket.
- Empty FR name defaults to the EN value on save, and vice versa.
- Tests live in `src/__tests__/`; run one file with `npx vitest run src/__tests__/<file>` from repo root `/Users/loris.briguet/Documents/GitHub/StudioManager`.
- All user-visible strings go through `useT()` keys in `src/i18n/ui.ts` (both EN and FR blocks).

---

### Task 1: Migration 006, Activity type, activity_id plumbed through inserts

**Files:**
- Create: `src-tauri/migrations/006_activities.sql`
- Create: `src/types/activity.ts`
- Modify: `src-tauri/src/lib.rs` (migration vec, ~line 345-375)
- Modify: `src/types/invoice.ts:19` (after `activity: string;`)
- Modify: `src/types/quote.ts:10` (after `activity: string;`)
- Modify: `src/db/queries/invoices.ts` (`createInvoiceWithLineItems` INSERT, ~lines 84-97)
- Modify: `src/db/queries/quotes.ts` (`createQuoteWithLineItems` INSERT, ~lines 39-47)

**Interfaces:**
- Consumes: nothing.
- Produces: `activities` table; `export interface Activity { id: number; name_fr: string; name_en: string; sort_order: number }` in `src/types/activity.ts`; `activity_id: number | null` on `Invoice` and `Quote` types; inserts persist `data.activity_id ?? null`. Tasks 2-5 rely on all of these.

- [ ] **Step 1: Create the migration**

`src-tauri/migrations/006_activities.sql`:

```sql
-- Activities become entities with user-editable FR/EN names.
-- invoices/quotes keep their historical text snapshot in `activity`;
-- `activity_id` links new records to the entity (nullable, no FK — see spec §7).
CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_fr TEXT NOT NULL,
    name_en TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE invoices ADD COLUMN activity_id INTEGER;
ALTER TABLE quotes ADD COLUMN activity_id INTEGER;
```

- [ ] **Step 2: Register it in `src-tauri/src/lib.rs`**

Append to the `migrations` vec (after the version-5 entry):

```rust
        Migration {
            version: 6,
            description: "create_activities_table",
            sql: include_str!("../migrations/006_activities.sql"),
            kind: MigrationKind::Up,
        },
```

- [ ] **Step 3: Verify the migration SQL applies**

Run:
```bash
rm -f /tmp/mig006-test.db && sqlite3 /tmp/mig006-test.db < src-tauri/migrations/001_initial_schema.sql && sqlite3 /tmp/mig006-test.db < src-tauri/migrations/006_activities.sql && sqlite3 /tmp/mig006-test.db "INSERT INTO activities (name_fr, name_en, sort_order) VALUES ('Graphisme','Graphic Design',0); SELECT id, name_fr, name_en, sort_order FROM activities;" && sqlite3 /tmp/mig006-test.db "PRAGMA table_info(invoices);" | grep activity && sqlite3 /tmp/mig006-test.db "PRAGMA table_info(quotes);" | grep activity && rm /tmp/mig006-test.db
```
Expected: prints `1|Graphisme|Graphic Design|0`, and both `activity` and `activity_id` columns for invoices and quotes. (001 + 006 suffices to validate the SQL; versions 2-5 don't touch these columns' existence.)

- [ ] **Step 4: Create the Activity type**

`src/types/activity.ts`:

```ts
export interface Activity {
  id: number;
  name_fr: string;
  name_en: string;
  sort_order: number;
}
```

- [ ] **Step 5: Add `activity_id` to Invoice and Quote types**

In `src/types/invoice.ts`, directly after `activity: string;`:

```ts
  activity_id: number | null;
```

Same addition in `src/types/quote.ts` after its `activity: string;`.

- [ ] **Step 6: Persist `activity_id` in the create queries**

In `src/db/queries/invoices.ts` `createInvoiceWithLineItems`, add `activity_id` to the INSERT column list right after `activity`, bump the placeholder count to `$27`, and add the value right after `data.activity`:

```ts
    `INSERT INTO invoices (reference, client_id, project_id, status, language, activity, activity_id, assignment,
     invoice_date, due_date, payment_terms_days, subtotal, discount_applied, discount_rate,
     discount_label, total, paid_date, contact_id, billing_address_id, po_number, pdf_path, from_quote_id, notes,
     currency, exchange_rate, chf_equivalent, template_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
    [
      data.reference, data.client_id, data.project_id, data.status, data.language,
      data.activity, data.activity_id ?? null, data.assignment, data.invoice_date, data.due_date,
      data.payment_terms_days, data.subtotal, data.discount_applied, data.discount_rate,
      data.discount_label, data.total, data.paid_date, data.contact_id, data.billing_address_id ?? null,
      data.po_number, data.pdf_path,
      data.from_quote_id, data.notes, data.currency ?? "CHF", data.exchange_rate ?? 1.0,
      data.chf_equivalent ?? data.total, data.template_id ?? null,
    ]
```

In `src/db/queries/quotes.ts` `createQuoteWithLineItems`, same pattern (`$16` added):

```ts
    `INSERT INTO quotes (reference, client_id, project_id, status, language, activity, activity_id, assignment, quote_date, valid_until, subtotal, discount_applied, discount_rate, total, converted_to_invoice_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      data.reference, data.client_id, data.project_id, data.status, data.language,
      data.activity, data.activity_id ?? null, data.assignment, data.quote_date, data.valid_until,
      data.subtotal, data.discount_applied, data.discount_rate, data.total,
      data.converted_to_invoice_id, data.notes,
    ]
```

(The dynamic `updateInvoice`/`updateQuote` functions build SET clauses from the payload keys, so they need no changes.)

- [ ] **Step 7: Verify TypeScript compiles and existing tests pass**

Run: `npm test && npm run build`
Expected: all tests pass; `tsc` errors only if a caller constructs a full `Invoice`/`Quote` object without `activity_id` — fix such call sites by adding `activity_id: null` (the form pages are updated properly in Task 4; here only add the minimal `activity_id: null` where compilation requires it, e.g. payload literals).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/migrations/006_activities.sql src-tauri/src/lib.rs src/types/activity.ts src/types/invoice.ts src/types/quote.ts src/db/queries/invoices.ts src/db/queries/quotes.ts
git commit -m "feat: activities table migration and activity_id on invoices/quotes"
```
(If Step 7 required touching other files, add them too.)

---

### Task 2: Activities queries and hooks (with legacy seed)

**Files:**
- Create: `src/db/queries/activities.ts`
- Create: `src/db/hooks/useActivities.ts`

**Interfaces:**
- Consumes: `Activity` from `src/types/activity.ts` (Task 1); existing `getDb` from `src/db/index.ts`; existing `parseActivities` from `src/types/business-profile.ts` (already unit-tested in `src/__tests__/parseActivities.test.ts`).
- Produces: `getActivities(): Promise<Activity[]>` (seeds from `business_profile.default_activity` when the table is empty), `createActivity(name_fr, name_en): Promise<number>`, `updateActivity(id, { name_fr, name_en })`, `deleteActivity(id)`; hooks `useActivities()`, `useCreateActivity()`, `useUpdateActivity()`, `useDeleteActivity()` with query key `["activities"]`. Tasks 3-5 rely on these exact names.

- [ ] **Step 1: Create `src/db/queries/activities.ts`**

```ts
import { getDb } from "../index";
import { parseActivities } from "../../types/business-profile";
import type { Activity } from "../../types/activity";

export async function getActivities(): Promise<Activity[]> {
  const db = await getDb();
  const rows = await db.select<Activity[]>(
    "SELECT * FROM activities ORDER BY sort_order, id"
  );
  if (rows.length > 0) return rows;

  // First run: seed from the legacy business_profile.default_activity list
  // (JSON string array, or a plain string on very old profiles). The user
  // fills in the other language in Settings afterwards.
  const profile = await db.select<{ default_activity: string }[]>(
    "SELECT default_activity FROM business_profile LIMIT 1"
  );
  const names = [
    ...new Set(
      parseActivities(profile[0]?.default_activity)
        .map((n) => n.trim())
        .filter(Boolean)
    ),
  ];
  if (names.length === 0) return [];
  for (let i = 0; i < names.length; i++) {
    await db.execute(
      "INSERT INTO activities (name_fr, name_en, sort_order) VALUES ($1, $2, $3)",
      [names[i], names[i], i]
    );
  }
  return db.select<Activity[]>(
    "SELECT * FROM activities ORDER BY sort_order, id"
  );
}

export async function createActivity(
  name_fr: string,
  name_en: string
): Promise<number> {
  const db = await getDb();
  const fr = name_fr.trim();
  const en = name_en.trim();
  const [row] = await db.select<{ m: number | null }[]>(
    "SELECT MAX(sort_order) as m FROM activities"
  );
  const result = await db.execute(
    "INSERT INTO activities (name_fr, name_en, sort_order) VALUES ($1, $2, $3)",
    [fr || en, en || fr, (row?.m ?? -1) + 1]
  );
  return result.lastInsertId;
}

export async function updateActivity(
  id: number,
  data: { name_fr: string; name_en: string }
): Promise<void> {
  const db = await getDb();
  const fr = data.name_fr.trim();
  const en = data.name_en.trim();
  await db.execute(
    "UPDATE activities SET name_fr = $2, name_en = $3 WHERE id = $1",
    [id, fr || en, en || fr]
  );
}

export async function deleteActivity(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM activities WHERE id = $1", [id]);
}
```

- [ ] **Step 2: Create `src/db/hooks/useActivities.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/activities";

export function useActivities() {
  return useQuery({ queryKey: ["activities"], queryFn: q.getActivities });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name_fr, name_en }: { name_fr: string; name_en: string }) =>
      q.createActivity(name_fr, name_en),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name_fr, name_en }: { id: number; name_fr: string; name_en: string }) =>
      q.updateActivity(id, { name_fr, name_en }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => q.deleteActivity(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activities"] }),
  });
}
```

- [ ] **Step 3: Verify compile and suite**

Run: `npm test && npm run build`
Expected: green. (DB query modules follow the codebase convention of no direct unit tests — the seed's parsing logic is `parseActivities`, already covered by `src/__tests__/parseActivities.test.ts`; resolution logic gets TDD in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add src/db/queries/activities.ts src/db/hooks/useActivities.ts
git commit -m "feat: activities queries and hooks with legacy profile seed"
```

---

### Task 3: Chart resolution (TDD) and Revenue-by-Activity dedup

**Files:**
- Create: `src/lib/activityResolve.ts`
- Test: `src/__tests__/activityResolve.test.ts`
- Modify: `src/db/queries/finance.ts` (`getRevenueByActivity`, ~lines 119-127)
- Modify: `src/components/dashboard/widgets.tsx` (`RevenueByActivity`, ~lines 404-432)

**Interfaces:**
- Consumes: `Activity` (Task 1), `useActivities` (Task 2), existing `useRevenueByActivity` hook in `src/db/hooks/useFinance.ts` (unchanged — its return type flows from the query), `useAppStore` from `src/stores/app-store.ts` (`s.language` is `"EN" | "FR"`).
- Produces: `export interface ActivityRevenueRow { activity_id: number | null; activity: string; total: number }` and `export function resolveActivityRevenue(rows: ActivityRevenueRow[], activities: Activity[], lang: "FR" | "EN"): { label: string; total: number }[]` in `src/lib/activityResolve.ts`; `getRevenueByActivity` now returns `Promise<ActivityRevenueRow[]>`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/activityResolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveActivityRevenue } from "../lib/activityResolve";
import type { Activity } from "../types/activity";

const ACTS: Activity[] = [
  { id: 1, name_fr: "Graphisme", name_en: "Graphic Design", sort_order: 0 },
  { id: 2, name_fr: "Media Interaction Design", name_en: "Media Interaction Design", sort_order: 1 },
];

describe("resolveActivityRevenue", () => {
  it("merges id, FR-name, EN-name and trailing-space variants into one row", () => {
    const rows = [
      { activity_id: 1, activity: "Graphisme", total: 100 },
      { activity_id: null, activity: "Graphisme", total: 36 },
      { activity_id: null, activity: "Graphic Design", total: 4 },
      { activity_id: null, activity: "Graphic Design ", total: 1 },
    ];
    expect(resolveActivityRevenue(rows, ACTS, "EN")).toEqual([
      { label: "Graphic Design", total: 141 },
    ]);
  });

  it("labels rows in the requested language", () => {
    const rows = [{ activity_id: 1, activity: "Graphisme", total: 10 }];
    expect(resolveActivityRevenue(rows, ACTS, "FR")[0].label).toBe("Graphisme");
    expect(resolveActivityRevenue(rows, ACTS, "EN")[0].label).toBe("Graphic Design");
  });

  it("keeps unmatched legacy text as its own row", () => {
    const rows = [{ activity_id: null, activity: "Old Consulting", total: 5 }];
    expect(resolveActivityRevenue(rows, ACTS, "EN")).toEqual([
      { label: "Old Consulting", total: 5 },
    ]);
  });

  it("buckets empty activity as N/A", () => {
    const rows = [{ activity_id: null, activity: "", total: 7 }];
    expect(resolveActivityRevenue(rows, ACTS, "EN")).toEqual([
      { label: "N/A", total: 7 },
    ]);
  });

  it("falls back to text matching for dangling activity ids", () => {
    const rows = [{ activity_id: 99, activity: "Graphic Design", total: 3 }];
    expect(resolveActivityRevenue(rows, ACTS, "EN")).toEqual([
      { label: "Graphic Design", total: 3 },
    ]);
  });

  it("sorts by total descending", () => {
    const rows = [
      { activity_id: 2, activity: "Media Interaction Design", total: 5 },
      { activity_id: 1, activity: "Graphisme", total: 50 },
    ];
    expect(resolveActivityRevenue(rows, ACTS, "EN").map((r) => r.label)).toEqual([
      "Graphic Design",
      "Media Interaction Design",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/activityResolve.test.ts`
Expected: FAIL — cannot resolve `../lib/activityResolve`.

- [ ] **Step 3: Implement `src/lib/activityResolve.ts`**

```ts
import type { Activity } from "../types/activity";

/** One row per (activity_id, activity-text) pair from the revenue query. */
export interface ActivityRevenueRow {
  activity_id: number | null;
  activity: string;
  total: number;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Merge revenue rows into one chart row per real activity.
 * Resolution per row: valid activity_id -> name match (FR or EN,
 * case-insensitive, trimmed) -> raw text as its own row. Empty text is the
 * "N/A" bucket. Labels follow the requested UI language.
 */
export function resolveActivityRevenue(
  rows: ActivityRevenueRow[],
  activities: Activity[],
  lang: "FR" | "EN"
): { label: string; total: number }[] {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const byName = new Map<string, Activity>();
  for (const a of activities) {
    byName.set(norm(a.name_fr), a);
    byName.set(norm(a.name_en), a);
  }

  const groups = new Map<string, { label: string; total: number }>();
  for (const row of rows) {
    // A dangling activity_id (deleted activity) falls back to text matching.
    const act =
      (row.activity_id !== null ? byId.get(row.activity_id) : undefined) ??
      byName.get(norm(row.activity));
    const key = act ? `id:${act.id}` : `text:${norm(row.activity)}`;
    const label = act
      ? lang === "FR"
        ? act.name_fr
        : act.name_en
      : row.activity.trim() || "N/A";
    const g = groups.get(key);
    if (g) g.total += row.total;
    else groups.set(key, { label, total: row.total });
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/activityResolve.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Return per-(id, text) rows from the finance query**

In `src/db/queries/finance.ts`, add the import at the top:

```ts
import type { ActivityRevenueRow } from "../../lib/activityResolve";
```

Replace `getRevenueByActivity` with:

```ts
export async function getRevenueByActivity(
  year: number
): Promise<ActivityRevenueRow[]> {
  const db = await getDb();
  return db.select<ActivityRevenueRow[]>(
    `SELECT activity_id, COALESCE(activity, '') as activity,
     COALESCE(SUM(CASE WHEN currency != 'CHF' AND chf_equivalent > 0 THEN chf_equivalent ELSE total END), 0) as total
     FROM invoices WHERE strftime('%Y', invoice_date) = $1 AND ${COUNTED_INVOICES}
     GROUP BY activity_id, activity ORDER BY total DESC`,
    [String(year)]
  );
}
```

Keep the `RevenueByGroup` interface — `getRevenueByClient` still uses it.

- [ ] **Step 6: Resolve in the widget**

In `src/components/dashboard/widgets.tsx`, add imports (ensure `useMemo` is in the react import):

```ts
import { useAppStore } from "../../stores/app-store";
import { useActivities } from "../../db/hooks/useActivities";
import { resolveActivityRevenue } from "../../lib/activityResolve";
```

Replace the top of `RevenueByActivity` (the JSX below the `total` line stays, with `rows?` optional-chaining changed to plain `rows` since it is now always an array):

```tsx
function RevenueByActivity() {
  const year = new Date().getFullYear();
  const { data: rawRows } = useRevenueByActivity(year);
  const { data: activities } = useActivities();
  const lang = useAppStore((s) => s.language);
  const t = useT();

  const rows = useMemo(
    () => resolveActivityRevenue(rawRows ?? [], activities ?? [], lang),
    [rawRows, activities, lang]
  );
  const total = rows.reduce((s, r) => s + r.total, 0);
```

In the JSX: `rows?.map` → `rows.map`, and the empty state condition `(!rows || rows.length === 0)` → `rows.length === 0`.

- [ ] **Step 7: Verify full suite, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/activityResolve.ts src/__tests__/activityResolve.test.ts src/db/queries/finance.ts src/components/dashboard/widgets.tsx
git commit -m "feat: dedupe Revenue by Activity via activity resolution"
```

---

### Task 4: Invoice and quote forms select activity entities

**Files:**
- Modify: `src/pages/InvoiceFormPage.tsx` (activity state ~line 89, existing-load ~line 156, default ~lines 198-203, from-quote copy ~line 237, payloads ~lines 391/430, select ~lines 572-583, `profileActivities` memo ~line 54)
- Modify: `src/pages/QuoteFormPage.tsx` (same shape: memo ~line 44, state ~line 75, existing-load ~line 119, default ~lines 145-150, payloads ~lines 225/258, select ~line 378-...)

Line numbers are approximate — locate by content.

**Interfaces:**
- Consumes: `useActivities` (Task 2), `Activity` (Task 1), `activity_id` on payload types (Task 1). Both pages already derive the record's language from `selectedClient?.language ?? "FR"`.
- Produces: on save, both pages write `activity` (trimmed snapshot in the record's language) and `activity_id`.

- [ ] **Step 1: Update `InvoiceFormPage.tsx`**

1. Replace the `profileActivities` memo (and its now-unused `parseActivities` import if nothing else uses it) with:

```ts
  const { data: activityList } = useActivities();
```

Add imports:

```ts
import { useActivities } from "../db/hooks/useActivities";
import type { Activity } from "../types/activity";
```

2. Next to the `activity` state, add:

```ts
  const [activityId, setActivityId] = useState<number | null>(null);
```

3. Near the other derived values (after `selectedClient` is available), add:

```ts
  const invoiceLang: "FR" | "EN" = selectedClient?.language ?? "FR";
  const activityName = (a: Activity) => (invoiceLang === "FR" ? a.name_fr : a.name_en);
```

4. Where the existing invoice is loaded (`setActivity(existingInvoice.activity);`), add:

```ts
      setActivityId(existingInvoice.activity_id ?? null);
```

5. Where the from-quote copy sets `setActivity(quote.activity);`, add:

```ts
      setActivityId(quote.activity_id ?? null);
```

6. Replace the default-activity effect body:

```ts
  // Default activity for new invoices
  useEffect(() => {
    if (!isEdit && !activity && activityId === null && !fromQuoteId && activityList && activityList.length > 0) {
      setActivityId(activityList[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- default-fill only when activities load; adding `activity`/`activityId` would re-fill after the user clears the field
  }, [activityList, isEdit, fromQuoteId]);
```

7. Replace the activity `<Select>`:

```tsx
          <FormField label={t.activity}>
            <Select
              value={activityId !== null ? String(activityId) : activity ? "legacy" : ""}
              onChange={(e) => {
                setActivityId(e.target.value === "legacy" || e.target.value === "" ? null : Number(e.target.value));
              }}
            >
              {(activityList ?? []).map((a) => (
                <option key={a.id} value={String(a.id)}>{activityName(a)}</option>
              ))}
              {activityId === null && activity && (
                <option value="legacy">{activity}</option>
              )}
              {activityId === null && !activity && <option value="" />}
            </Select>
          </FormField>
```

8. In BOTH save payloads (create and update), replace `activity,` with:

```ts
              ...(() => {
                const selected = activityId !== null ? activityList?.find((a) => a.id === activityId) : undefined;
                return {
                  activity: (selected ? activityName(selected) : activity).trim(),
                  activity_id: selected ? selected.id : null,
                };
              })(),
```

- [ ] **Step 2: Update `QuoteFormPage.tsx` the same way**

Apply the identical eight changes to `QuoteFormPage.tsx`: same imports, same `activityId` state, same `invoiceLang`/`activityName` helpers (name the variable `quoteLang` if `invoiceLang` reads oddly, but keep the same `selectedClient?.language ?? "FR"` source used by its payload `language:` field), existing-load `setActivityId(existingQuote.activity_id ?? null)`, same default effect (this page has no `fromQuoteId` — drop that condition), same `<Select>` replacement, same payload replacement in both create and update payloads.

- [ ] **Step 3: Verify full suite, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: all green. Lint will flag the removed `parseActivities`/`useMemo` imports if left unused — clean them up.

- [ ] **Step 4: Commit**

```bash
git add src/pages/InvoiceFormPage.tsx src/pages/QuoteFormPage.tsx
git commit -m "feat: invoice/quote forms select activity entities with language snapshots"
```

---

### Task 5: Two-column activities editor in Settings + i18n keys

**Files:**
- Modify: `src/pages/ProfilePage.tsx` (state ~lines 63-64, profile effect ~line 73-77, onSubmit ~line 83, `saveActivities`/`addActivity`/`removeActivity` ~lines 93-111, Activities JSX block ~lines 295-341)
- Modify: `src/i18n/ui.ts` (EN block near `add_activity` ~line 382, FR block near its counterpart)

**Interfaces:**
- Consumes: `useActivities`, `useCreateActivity`, `useUpdateActivity`, `useDeleteActivity` (Task 2), `Activity` (Task 1).
- Produces: Settings manages the `activities` table; `business_profile.default_activity` is no longer read or written by this page.

- [ ] **Step 1: Add i18n keys**

In `src/i18n/ui.ts` EN block (next to `add_activity`):

```ts
    activity_name_fr: "Name (FR)",
    activity_name_en: "Name (EN)",
```

FR block:

```ts
    activity_name_fr: "Nom (FR)",
    activity_name_en: "Nom (EN)",
```

Remove `activity_exists` from BOTH blocks (its only consumer is deleted below).

- [ ] **Step 2: Rewire `ProfilePage.tsx` state**

1. Delete the `activities` and `newActivity` state, the `saveActivities`, `addActivity`, and `removeActivity` functions, the `setActivities(parseActivities(profile.default_activity))` line inside the profile effect, and the `default_activity: JSON.stringify(activities),` line in `onSubmit`. Remove the `parseActivities` import if now unused.
2. Add imports:

```ts
import { useActivities, useCreateActivity, useUpdateActivity, useDeleteActivity } from "../db/hooks/useActivities";
import type { Activity } from "../types/activity";
```

3. Add hooks and add-row state where the old state was:

```ts
  const { data: activityList } = useActivities();
  const createActivityMut = useCreateActivity();
  const updateActivityMut = useUpdateActivity();
  const deleteActivityMut = useDeleteActivity();
  const [newFr, setNewFr] = useState("");
  const [newEn, setNewEn] = useState("");

  const addNewActivity = () => {
    if (!newFr.trim() && !newEn.trim()) return;
    createActivityMut.mutate(
      { name_fr: newFr, name_en: newEn },
      { onSuccess: () => { setNewFr(""); setNewEn(""); } }
    );
  };
```

- [ ] **Step 3: Replace the Activities JSX block**

Replace everything inside the `{/* Activities list */}` `<div>` (label, rows list, add input row) with:

```tsx
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    {t.activities}
                  </label>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center text-xs text-muted mb-1">
                    <span>{t.activity_name_fr}</span>
                    <span>{t.activity_name_en}</span>
                    <span className="w-[14px]" />
                  </div>
                  <div className="space-y-1.5 mb-2">
                    {(activityList ?? []).map((a) => (
                      <ActivityRow
                        key={a.id}
                        activity={a}
                        onSave={(name_fr, name_en) => updateActivityMut.mutate({ id: a.id, name_fr, name_en })}
                        onDelete={() => deleteActivityMut.mutate(a.id)}
                        removeLabel={t.remove}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                    <Input
                      value={newFr}
                      onChange={(e) => setNewFr(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewActivity(); } }}
                      placeholder={t.activity_name_fr}
                    />
                    <Input
                      value={newEn}
                      onChange={(e) => setNewEn(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewActivity(); } }}
                      placeholder={t.activity_name_en}
                    />
                    <button
                      type="button"
                      onClick={addNewActivity}
                      className="p-2 text-muted hover:text-accent"
                      aria-label={t.add_activity}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
```

- [ ] **Step 4: Add the `ActivityRow` component**

At the bottom of `ProfilePage.tsx` (outside the page component):

```tsx
function ActivityRow({
  activity,
  onSave,
  onDelete,
  removeLabel,
}: {
  activity: Activity;
  onSave: (name_fr: string, name_en: string) => void;
  onDelete: () => void;
  removeLabel: string;
}) {
  const [fr, setFr] = useState(activity.name_fr);
  const [en, setEn] = useState(activity.name_en);
  useEffect(() => {
    setFr(activity.name_fr);
    setEn(activity.name_en);
  }, [activity.name_fr, activity.name_en]);

  const commit = () => {
    if (fr.trim() === activity.name_fr && en.trim() === activity.name_en) return;
    onSave(fr, en);
  };

  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
      <Input value={fr} onChange={(e) => setFr(e.target.value)} onBlur={commit} />
      <Input value={en} onChange={(e) => setEn(e.target.value)} onBlur={commit} />
      <button
        type="button"
        onClick={onDelete}
        className="text-muted hover:text-[var(--color-danger-text)]"
        aria-label={removeLabel}
      >
        <X size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Verify full suite, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: all green; lint flags any unused leftovers (`parseActivities`, `toast` if only used by removed code — keep `toast`, it is used elsewhere on the page).

- [ ] **Step 6: Manual smoke test (user-assisted)**

Ask the user to run `npm run tauri dev` and confirm: (1) Settings → Invoice Defaults shows the existing activities seeded with FR = EN, editable in two columns; (2) a new invoice for an EN client shows English activity names and prints the English name on the PDF; (3) the dashboard's Revenue by Activity now shows one "Graphic Design"/"Graphisme" row.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ProfilePage.tsx src/i18n/ui.ts
git commit -m "feat: two-column FR/EN activities editor in settings"
```
