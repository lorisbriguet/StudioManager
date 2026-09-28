# Full application audit — 2026-09-28

**Scope:** the whole application at `main` (7ec4cb5), which is v2.0.1 plus the unreleased v2.1.0 work: 51,400 lines of TypeScript across 320 files, 2,500 lines of Rust, the Tauri configuration, the docs site and the release tooling.

**Method:** four independent reading passes — correctness and data, security and platform, interface and accessibility, tests and tooling — plus deterministic tooling run separately. A previous audit of this codebase produced six "P1" findings that turned out to be false, so every finding below carries a concrete failure scenario, and the most serious ones in each pass were re-verified by hand before being written down. Findings that could not be confirmed are marked as such rather than promoted.

**Deterministic results:** 0 npm vulnerabilities, 0 Rust vulnerabilities (7 unmaintained-crate warnings, all Linux-only GTK dependencies), clippy clean across all targets including tests, 652 frontend and 41 Rust tests passing, TypeScript `strict` with `noUnusedLocals` and `noUnusedParameters`, design-system greps at zero on every rule, EN and FR translation keys in parity.

---

## P1 — fix before the next release

### 1. The published invoice screenshot shows the owner's real contact and banking details

`docs/screenshots/invoice.png`, linked from `docs/index.html:249` and the README, is live on the public documentation site. It was captured in presentation mode, so the *client* is fictional, but presentation mode deliberately preserves the owner's own business profile. The image therefore shows a home address, mobile number, email, Swiss business identification and affiliate numbers, bank name, full IBAN and BIC, and a scannable QR payment slip encoding the same details.

Published since 14 September. The exposure is moderate rather than catastrophic — an IBAN and address appear on every invoice sent to a client — but a public website is a different audience, and it invites direct-debit attempts, address harvesting and spam.

**Fix:** retake all four screenshots from the demo app, whose personas carry a fictional profile. Check the other three images for the same problem while doing it.

### 2. Redo after an undone delete can destroy a different record

Three delete flows share one shape: undo re-creates the record and knows its new id, then redo discards that id and re-finds the record by a non-unique field.

| File | Matched on | Default value that collides |
|---|---|---|
| `src/db/hooks/useProjectTables.ts:53-59` | table name | "Untitled" |
| `src/db/hooks/useWiki.ts:134-143` | title and folder | "Untitled" |
| `src/db/hooks/useResources.ts:123-130` | name and url | any duplicate |

**Failure:** delete a table named "Untitled", undo, and redo. `find` returns the first match, which may be a different "Untitled" table, and deleting it cascades its rows away permanently. Undo history does not survive to bring them back.

This is the same defect an earlier audit fixed for invoices by capturing the new id; the fix was never applied to these three. `useDeleteQuote` has the same pattern but references are unique there, so it is currently safe and should still be corrected.

**Fix:** capture `newId` in the closure during `execute` and delete that id in `redo`, exactly as `useIncome.ts` already does.

### 3. The Swiss QR payment slip fails silently, and a failure poisons the rest of the session

`src/components/invoice/QRBillSvgRenderer.tsx:102-129`. The paint callback wraps the whole drawing in `try/catch`, logs, and returns null. An invoice whose payment slip fails to draw is therefore exported, saved and sent with no slip and no warning anywhere in the interface — for a Swiss invoice, that is the part the client actually pays from.

Two aggravating factors, both verified by reading the block:

- Nothing executes this code in tests. The golden PDF snapshots record the callback's presence only, never its output, which the snapshot work deliberately noted as a blind spot.
- The library's `isSpaceSufficient` check is monkey-patched to `() => true` and restored on the line *after* `attachTo`. If `attachTo` throws, the restore is skipped and the patch persists for the remainder of the session, so later renders skip the space check too.

**Fix:** move the restore into a `finally`, surface the failure to the user rather than only the log, and add one test that renders the slip with a real painter double and asserts it drew something.

### 4. Nothing runs the tests except a human

`.github/workflows/` contains one workflow, the weekly dependency audit. No workflow runs vitest, `tsc` or eslint on push or pull request. The 652 tests protect the codebase only for as long as whoever is releasing remembers to run them, and `RELEASING.md` is the only thing that says they must.

**Fix:** one workflow running the three gates on push to `main`. It is roughly fifteen lines.

### 5. A dashboard widget corrupts the client cache the Clients page reads

`src/components/dashboard/widgets.tsx:192-196` runs `SELECT id, name FROM clients` under the query key `["clients"]`, which `src/db/hooks/useClients.ts:31` also uses for full client rows. TanStack Query caches by key, so after the dashboard renders, that key holds rows with only two columns.

**Failure:** open the dashboard, then the Clients page. The page renders from the poisoned cache first, showing blank names, languages and statuses, until its own refetch resolves and repaints. Any other consumer reading the same cache synchronously sees the truncated rows.

**Fix:** give the widget its own key, or reuse `useClients()` and select the two fields from it.

---

## P2 — real, narrower

1. **A deleted client address comes back.** `src/db/index.ts:245-264` backfills `client_addresses` from the legacy columns on `clients` on *every* startup and organisation switch, guarded only by whether that client has any address at all. Delete a client's last address and it reappears on the next launch, with any edits lost. Fix by clearing the source columns once the backfill has run.
2. **The QR slip can name a different address than the invoice header.** `src/components/invoice/qr-bill.ts:68-73` builds the debtor block from the client's default address while the header renders the resolved billing address, so an invoice addressed to a branch can carry a payment slip naming the head office.
3. **Personal data remains in the public git history.** The migration script an earlier audit deleted still holds bank details, business identification, phone and address in commits reachable from `origin/main`. Removing it needs a history rewrite and a force push, or making the repository private.
4. **Money arithmetic has no test that varies its inputs.** Subtotal, discount and total are computed independently in the invoice and quote forms with no test that changes quantities, rates or discount and checks the result. The trustee export's three financial PDFs have no correctness coverage at all, and the exchange-rate freeze logic — which exists because of two documented past bugs — is untested.
5. **Two translation gaps.** The "AND"/"OR" selector in the saved-filter builder (`src/components/SavedFilterBar.tsx:277-278`) has no translation key at all and shows English on every list page. Two other screens carry hardcoded English strings in the French interface.
6. **Dashboard widget layout is not per organisation**, unlike every other piece of per-organisation interface state, so the two businesses share one dashboard arrangement.
7. **Three hand-rolled modals** (the workload column editor, the save-template dialog, the receipt preview) bypass the shared `Modal` component and lose Escape-to-close and focus trapping. The workload table's column header menus have no keyboard path at all.
8. **Receipt filenames do not sanitise the extension** taken from the source path, unlike the rest of the filename.
9. **Swiss franc formatting is written out in seven places** with small differences between them; a shared formatter would prevent the next drift.

---

## P3 — housekeeping

`open_in_finder` shells out rather than using the scoped filesystem plugin (unreachable in a single-user app, but it sidesteps the allowlist); restore silently drops receipt and PDF files that fail to copy; one unicode character is still used as an icon; the project status badge duplicates `statusColors`; the workload table's sortable row is not memoised; no list anywhere is virtualised, which is structural rather than urgent at current row counts; the design-system document has drifted from the code on one dark-mode colour; `SNAFU/` holds four superseded plan documents; `noUncheckedIndexedAccess` is off, which is the class of looseness that let a translation lookup ship broken earlier this week.

---

## Clean bill

Examined closely and found sound: the organisation registry and its atomic save; the one-time data upgrade with its snapshot, rollback and path rewriting; organisation switching order and the guards around it; per-organisation backup naming, rotation and restore isolation; SQL parameterisation throughout `src/db/queries/`, including the allowlisted table interpolation; the `execute_batch` statement cap; the AppleScript runner's argument handling; the Tauri capability set and its filesystem scope; the content security policy; the updater chain and the demo build's deliberately dead endpoint; undo and redo id capture for invoices, quotes and income; the golden PDF snapshot gate; and the design-system compliance greps.

---

## Suggested order

1. Retake the screenshots (an afternoon, removes a live exposure).
2. The three redo fixes and the address backfill (a few lines each, all data-loss).
3. The QR slip: `finally`, a visible failure, one test.
4. The CI workflow.
5. The cache key, then the P2 list in whatever order suits.
