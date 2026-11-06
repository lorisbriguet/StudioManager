# Paperless invoice inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the supplier invoices Paperless received by email as an "À saisir" inbox under Expenses, and turn each into an expense (PDF attached) in one confirmed step, without duplicates in either direction.

**Architecture:** A new connection kind `paperless` in the existing connections system: a Rust module (`connectors/paperless.rs`) talks to the Paperless REST API with the token from the Keychain and exposes four Tauri commands (inbox, download, thumbnail, mark-linked). The frontend lists inbox items, opens the Expenses page's existing prefilled form (which already guesses the category from the supplier's history and copies `prefill.receiptPath` into `receipts/`), and records each link/dismissal in a new `paperless_links` table. The nightly MacBook script skips linked expenses.

**Tech Stack:** Tauri v2, Rust (reqwest blocking, rusqlite migrations), React + TypeScript, TanStack Query, Vitest, `cargo test`.

**Spec:** [docs/superpowers/specs/2026-11-01-paperless-inbox-design.md](../specs/2026-11-01-paperless-inbox-design.md)

## Global Constraints

- The Paperless token lives only in the Keychain (`keychain::account(org, id)`); never in the DB, logs, errors or the frontend. Every error passes through `redact`.
- Requests send `Authorization: Token <token>` and `Accept: application/json` — **no** `; version=N` (the current server answers 406 to `version=5`).
- Build HTTP clients with `http_client()` (publicly trusted cert); keep `cert_fingerprint` support unused but intact.
- Nothing is booked without Loris saving the expense form. Agents/MCP get no new write access.
- Inbox filter: tag **`À saisir`** present, tag **`StudioManager`** absent, no `paperless_links` row. Newest first.
- Write-back after linking: add tags `StudioManager`, `<year>`, `<category name_fr>`; title `<reference> <supplier>`; remove `À saisir`.
- Refresh: on Expenses page mount, every 30 minutes while the app is open, and via a refresh button.
- UI copy in both `EN` and `FR` in `src/i18n/ui.ts`.
- Migrations: new file `src-tauri/migrations/009_paperless.sql`, registered as version 9 in `src-tauri/src/migrate.rs`.

## Review Focus

1. **NAS unreachable (no Tailscale, at a show):** the inbox shows the last known items with an "offline" note; no error toast, no crash. → Task 5 test `shows offline state without throwing`.
2. **Token revoked / 401:** the connection is marked failing like other kinds and the inbox is empty with a "reconnect" hint; the token never appears in the message. → Task 2 test `unauthorized_is_redacted_and_readable`.
3. **PDF download fails after the form is saved:** the expense still exists, the link is recorded with `expense_id`, and a "receipt missing — retry" action appears. → Task 5 test `download failure keeps the expense and offers retry`.
4. **Correspondent missing or new supplier:** the form opens with an empty or new supplier and the first category; nothing breaks. → Task 4 test `matchSupplier returns the raw name for an unknown supplier`.
5. **Same document dismissed then linked, or linked twice (double click):** the unique (`connection_id`, `paperless_doc_id`) key holds; a second link updates instead of failing. → Task 3 test `linking twice keeps one row`.

---

### Task 1: Schema — `paperless` connection kind and `paperless_links`

**Files:**
- Create: `src-tauri/migrations/009_paperless.sql`
- Modify: `src-tauri/src/migrate.rs` (register version 9; add test)
- Modify: `src/types/upkeep.ts:1` (`ConnectionKind` adds `"paperless"`)

**Interfaces:**
- Produces: table `paperless_links(id INTEGER PK, connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE, paperless_doc_id INTEGER NOT NULL, expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL, state TEXT NOT NULL CHECK (state IN ('linked','dismissed')), created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(connection_id, paperless_doc_id))`; `connections.kind` CHECK allows `'paperless'`.

- [ ] **Step 1: Write the failing test** in `migrate.rs` tests, same style as `migrates_to_008_adds_machine_linked_at`:

```rust
#[test]
fn migrates_to_009_adds_paperless() {
    let path = temp_db("m009");
    migrate_db(&path).unwrap();
    assert!(table_exists(&path, "paperless_links"));
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute("INSERT INTO connections (kind, label) VALUES ('paperless', 'P')", []).unwrap();
    assert!(conn.execute("INSERT INTO connections (kind, label) VALUES ('nope', 'X')", []).is_err());
}
```

- [ ] **Step 2: Run** `cd src-tauri && cargo test migrates_to_009` — Expected: FAIL (no table).
- [ ] **Step 3: Write `009_paperless.sql`**: rebuild `connections` with the widened CHECK (create `connections_new` with identical columns, copy rows, drop, rename; recreate any indexes/foreign keys that reference it — check `007_upkeep.sql` and `008`), then create `paperless_links`. Register `SqlMigration { version: 9, sql: include_str!("../migrations/009_paperless.sql") }`.
- [ ] **Step 4: Run** `cargo test migrate` — Expected: all migration tests PASS (including 007/008 and plugin-recognition).
- [ ] **Step 5: Commit** `feat(paperless): schema for paperless connections and links`

### Task 2: Rust connector and commands

**Files:**
- Create: `src-tauri/src/connectors/paperless.rs`
- Create: `src-tauri/src/connectors/fixtures/paperless_documents.json`, `paperless_tags.json`
- Modify: `src-tauri/src/connectors/mod.rs` (`pub mod paperless;`, `"paperless" => paperless::build(config, secret)` in `build_connector`)
- Modify: `src-tauri/src/lib.rs:731-734` (register the four commands)

**Interfaces:**
- Consumes: `keychain::{account, Keychain, SecretStore}`, `redact`, `http_client`, `guard`, `blocking` from `mod.rs`.
- Produces (Tauri commands, all `(app, org: String, id: i64, config: JsonValue, …) -> Result<_, String>`, config `{host, port}`):
  - `paperless_inbox(...) -> Vec<InboxDoc>` where `InboxDoc { id: i64, title: String, correspondent: Option<String>, created: String /* YYYY-MM-DD */, original_file_name: Option<String> }`
  - `paperless_download(..., doc_id: i64) -> String` — writes the original file to the app cache dir `paperless/<doc_id>.<ext>` and returns that absolute path.
  - `paperless_thumbnail(..., doc_id: i64) -> String` — `data:image/webp;base64,…`.
  - `paperless_mark_linked(..., doc_id: i64, title: String, tags: Vec<String>) -> ()` — creates missing tags by name, sets title and tags, removes `À saisir`.
- `Connector` impl: `test()` → `GET /api/documents/?page_size=1`, returns one `DeviceInfo { device_id: "paperless", name: Some(host), model: None }`; `sync()` → `SyncResult { devices: vec![] }` (keeps the existing failing/last_ok bookkeeping working).

- [ ] **Step 1: Write failing tests** (in `paperless.rs`, fixtures-driven with a fake transport like `synology.rs`):
  - `parse_inbox_skips_studiomanager_tagged` — fixture with 3 docs, one tagged `StudioManager` → 2 `InboxDoc`s, correspondent names resolved from `paperless_correspondents`.
  - `request_has_token_header_and_no_api_version` — captured request headers contain `Authorization: Token t0k` and `Accept: application/json` exactly.
  - `unauthorized_is_redacted_and_readable` — 401 → error `"Paperless refused the token (401). Reconnect it in Settings."` and `!err.contains("t0k")`.
  - `mark_linked_creates_missing_tags_and_removes_inbox_tag` — asserts the PATCH body `{"title":"F-26-070 Sunrise","tags":[…ids…]}` without the `À saisir` id.
- [ ] **Step 2: Run** `cargo test paperless` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `paperless.rs`: base URL `https://{host}:{port}`; inbox query `/api/documents/?tags__name__iexact=%C3%80%20saisir&ordering=-created&page_size=100` plus one `/api/correspondents/?page_size=1000` and `/api/tags/?page_size=1000` lookup; downloads via `/api/documents/{id}/download/?original=true`, thumbs via `/api/documents/{id}/thumb/`; bodies through `read_limited` (50 MB cap for PDFs). Map reqwest errors with `without_url()`.
- [ ] **Step 4: Run** `cargo test` — Expected: PASS, existing connector tests untouched.
- [ ] **Step 5: Commit** `feat(paperless): connector and inbox commands`

### Task 3: Links queries and connection form

**Files:**
- Create: `src/db/queries/paperlessLinks.ts`
- Create: `src/components/upkeep/PaperlessForm.tsx`
- Modify: `src/components/upkeep/connectionForms.ts` (register `paperless: PaperlessForm`, add to `CONNECTION_KINDS`)
- Modify: `src/i18n/ui.ts` (`upkeep_connection_kind_paperless`: EN "Paperless", FR "Paperless"; form labels)
- Test: `src/__tests__/paperlessLinks.test.ts`, `src/__tests__/paperlessForm.test.tsx`

**Interfaces:**
- Produces:
  - `getPaperlessLinks(connectionId: number): Promise<Map<number, { state: "linked" | "dismissed"; expense_id: number | null }>>`
  - `linkPaperlessDoc(connectionId: number, docId: number, expenseId: number): Promise<void>` (upsert → `state='linked'`)
  - `dismissPaperlessDoc(connectionId: number, docId: number): Promise<void>` / `undismissPaperlessDoc(...)`
  - `PaperlessForm` (props `ConnectionFormProps`): fields host (default `<nas>.<tailnet>.ts.net`), port (default `8443`), token (password input); "Connect" creates the connection via `useConnectionSetup`, saves the token with `saveConnectionSecret`, runs `connection_test`.

- [ ] **Step 1: Write failing tests**: `linking twice keeps one row` (second call updates; `getPaperlessLinks` size 1, state `linked`); `dismiss then link ends linked`; form test `shows host, port and token and never renders the token back after save` (mirror `bambuForm.test.tsx` mocks).
- [ ] **Step 2: Run** `npx vitest run paperless` — Expected: FAIL.
- [ ] **Step 3: Implement** with `INSERT … ON CONFLICT(connection_id, paperless_doc_id) DO UPDATE`; form modelled on `BambuForm.tsx` (token instead of email/password).
- [ ] **Step 4: Run** `npx vitest run paperless connectionsCard` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(paperless): links table queries and connection form`

### Task 4: Inbox data layer

**Files:**
- Create: `src/lib/paperless/inbox.ts`
- Create: `src/db/hooks/usePaperlessInbox.ts`
- Test: `src/__tests__/paperlessInbox.test.ts`

**Interfaces:**
- Consumes: Task 2 commands, Task 3 queries, `getDistinctSuppliers()`.
- Produces:
  - `type InboxItem = { connectionId: number; docId: number; title: string; supplier: string | null; date: string; state: "new" | "dismissed" }`
  - `matchSupplier(name: string | null, known: string[]): string | null` — case/space-insensitive match to an existing supplier, else the raw trimmed name, `null` for empty.
  - `usePaperlessInbox(): { items: InboxItem[]; offline: boolean; error: string | null; refresh(): void }` — TanStack Query, `refetchInterval: 30 * 60_000`, keeps previous data on error (`placeholderData: keepPreviousData`), `offline=true` when the command error is a transport error, `error` set for auth errors.

- [ ] **Step 1: Write failing tests**: `matchSupplier maps "sunrise " to "Sunrise"`; `matchSupplier returns the raw name for an unknown supplier`; `linked docs are excluded and dismissed docs flagged` (mock `invoke` + `getPaperlessLinks`); `keeps last items when the command fails with a transport error`.
- [ ] **Step 2: Run** `npx vitest run paperlessInbox` — Expected: FAIL.
- [ ] **Step 3: Implement.** No Paperless connection → `items: []`, no fetch.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(paperless): inbox data layer`

### Task 5: "À saisir" inbox on the Expenses page

**Files:**
- Create: `src/components/expenses/PaperlessInbox.tsx`
- Modify: `src/pages/ExpensesPage.tsx` (tab/section with count badge; reuse `setPrefill`/`setShowForm`; after save call `linkPaperlessDoc` + `paperless_mark_linked`)
- Modify: `src/i18n/ui.ts` (EN/FR: "To file"/"À saisir", "Create expense"/"Créer la dépense", "Dismiss"/"Ignorer", "Open in Paperless"/"Ouvrir dans Paperless", "Offline — showing last known invoices"/"Hors ligne — dernières factures connues", "Receipt missing — retry"/"Justificatif manquant — réessayer")
- Test: `src/__tests__/paperlessInboxView.test.tsx`

**Interfaces:**
- Consumes: `usePaperlessInbox`, `paperless_download`, `paperless_thumbnail`, `paperless_mark_linked`, `linkPaperlessDoc`, `dismissPaperlessDoc`, the page's existing `prefill` state (`ExtractedExpenseData & { receiptPath?: string }`) and save handler (which already copies `prefill.receiptPath` into `receipts/` and guesses the category via `pastSuppliers`).
- Produces: badge hidden at 0; "Create expense" → `paperless_download` → `setPrefill({ supplier: matchSupplier(...), invoice_date: item.date, receiptPath })` → `setShowForm(true)`; on save success with the new expense id → `linkPaperlessDoc` then `paperless_mark_linked(docId, \`${reference} ${supplier}\`, ["StudioManager", year, categoryNameFr])`.

- [ ] **Step 1: Write failing tests**: `badge shows the count and hides at zero`; `create expense opens the form prefilled with supplier and date`; `saving links the doc and writes back title and tags`; `dismiss removes the item and it can be restored from the dismissed filter`; `shows offline state without throwing`; `download failure keeps the expense and offers retry` (download rejects → form still opens without receipt, after save the row shows the retry action, link recorded).
- [ ] **Step 2: Run** `npx vitest run paperlessInboxView` — Expected: FAIL.
- [ ] **Step 3: Implement** the component (thumbnail lazy-loaded per row, "Open in Paperless" opens `https://{host}:{port}/documents/{id}/details` with the opener plugin) and wire it into `ExpensesPage`.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(paperless): invoice inbox on the Expenses page`

### Task 6: Nightly script skips linked expenses, end-to-end check

**Files (outside this repo):**
- Modify: `~/.local/share/paperless-sync/sync.py` (`expenses()` query)

**Interfaces:**
- Consumes: `paperless_links.expense_id` in the org DB (`orgs/9qr85u/studiomanager.db`).

- [ ] **Step 1:** Add to the `expenses()` SQL `AND e.id NOT IN (SELECT expense_id FROM paperless_links WHERE expense_id IS NOT NULL)`, guarded so the query still works on a DB without the table (check `sqlite_master` first).
- [ ] **Step 2: Verify** `/usr/bin/python3 ~/.local/share/paperless-sync/sync.py --dry-run` — Expected: same list as before minus linked expenses; no error on the current DB.
- [ ] **Step 3: End-to-end (manual, with Loris):** add the Paperless connection in Settings; in Paperless create a mail rule on `factures@lorisbriguet.ch` assigning tag `À saisir`; forward one supplier invoice; refresh the inbox; create the expense; check in Paperless that the document now has title `<ref> <supplier>`, tags `StudioManager`/year/category and no `À saisir`; run the script's dry run and confirm it doesn't list the new expense.
- [ ] **Step 4: Commit** the repo side is already committed; note the script change in the Studio Network wiki.
