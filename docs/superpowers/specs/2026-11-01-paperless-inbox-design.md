# Paperless invoice inbox — design

Date: 2026-11-01. Status: approved by Loris (2026-11-01). Implementation plan: [2026-11-01-paperless-inbox.md](../plans/2026-11-01-paperless-inbox.md).

Related: [studio upkeep design](2026-10-28-studio-upkeep-design.md) (the connections system this extends), [agent access / MCP design](2026-10-27-agent-access-mcp-design.md) (why agents can't create expenses).

## Why

Loris now runs Paperless-ngx on the studio NAS. Two flows exist or are planned:

1. **StudioManager → Paperless (exists):** a nightly script on the MacBook (`~/.local/share/paperless-sync/sync.py`) uploads every expense receipt to Paperless with supplier, date, reference and tags `StudioManager` / year / category. It remembers what it sent in a local `state.json`.
2. **Email → Paperless (planned):** supplier invoices emailed to an Infomaniak alias (e.g. `factures@lorisbriguet.ch`) are fetched by Paperless's mail import and filed automatically.

Today, an invoice that arrives by email ends up in Paperless but **not** in StudioManager, so the accounting is incomplete unless Loris re-enters it by hand. This feature closes that loop: StudioManager shows the invoices Paperless received that aren't expenses yet, and turns each one into a proper expense in one confirmation, with the PDF attached.

## Goals

- An **inbox of supplier invoices** in StudioManager, fed from Paperless.
- Turning an inbox item into an **expense in one step**: supplier, date, amount and category pre-filled, Loris confirms or corrects, the PDF becomes the expense's receipt.
- **No duplicates in either direction:** an expense created from Paperless is never uploaded back to Paperless by the nightly script, and an expense that came from StudioManager never shows up in the inbox.
- **Dismiss** an item that isn't an expense (newsletter PDF, duplicate, private bill) so it stops appearing.
- Works over Tailscale (`https://<nas>.<tailnet>.ts.net:8443`) from anywhere.

## Non-goals

- Reading the mailbox itself. Paperless does the mail import; StudioManager only talks to Paperless.
- Full two-way editing (changing an expense in StudioManager does not rewrite the Paperless document's metadata, and vice versa).
- Income/client invoices. Supplier invoices (expenses) only.
- Running on the NAS. StudioManager stays a desktop app; the inbox refreshes when the app runs.

## Anti-goals

- **An expense created without Loris confirming it.** Amounts and categories are accounting data; nothing is booked silently.
- **Agents creating expenses.** The MCP keeps money read-only (see the agent access design). The inbox is a UI action only.
- **The Paperless token or any secret in the database, logs or errors.** Same rule as the other connections: Keychain only, errors redacted.

## How it works

### 1. A new connection kind: `paperless`

Extends the existing connections system (`src-tauri/src/connectors/`, `connections` table).

- `connections.kind` gains `'paperless'` (migration: rebuild the `CHECK` constraint, as SQLite requires).
- Fields used: `label`, `host` (`<nas>.<tailnet>.ts.net`), `port` (`8443`). The **API token** is the secret, stored in the Keychain like the Synology password. No `cert_fingerprint` needed: the certificate is publicly trusted (Let's Encrypt via Tailscale); the existing pinning stays available for self-signed setups.
- Settings › Connections: "Paperless" option with host, port, token field, and **Test** (calls `GET /api/documents/?page_size=1`).
- One Paperless connection per organisation (Studio). Personal org: none.

### 2. What counts as an inbox item

A Paperless document is in the inbox when all hold:

- it does **not** have the tag `StudioManager` (those came from StudioManager);
- it has the tag that marks supplier invoices from mail (**`Facture fournisseur`** document type, or a dedicated tag `À saisir` set by the Paperless mail rule — see *Left to the builder*);
- it is not already linked to an expense (see §4);
- it hasn't been dismissed.

StudioManager fetches them with the Paperless REST API (`/api/documents/?...`), newest first, on app start, every 30 minutes while open, and on demand (refresh button).

### 3. The inbox screen

Under **Expenses**, a tab or section "**À saisir (N)**" (count badge, hidden at 0).

Each item shows: thumbnail (`/api/documents/{id}/thumb/`), Paperless title, correspondent (= supplier guess), created date, and a link "Open in Paperless".

**"Create expense"** opens the existing expense form, pre-filled:

| Field | Source | Notes |
|---|---|---|
| Supplier | Paperless correspondent name | matched case-insensitively against existing suppliers (`getDistinctSuppliers`) so "sunrise" maps to "Sunrise" |
| Invoice date | Paperless `created` date | |
| Amount | Paperless custom field `Montant` if set, else empty | Paperless doesn't read amounts by itself; empty is fine, Loris types it |
| Category | the category most often used for this supplier in past expenses | empty if the supplier is new |
| Reference | next expense reference (`getNextExpenseReference`) | as today |
| Receipt | the PDF downloaded from `/api/documents/{id}/download/` (original) | saved into the org's `receipts/` with the existing naming (`attachReceipt` rules) |

On save: expense created, receipt attached, link recorded (§4). The item leaves the inbox.

**"Dismiss"**: hides the item permanently (recorded locally, §4). Undo via a "Dismissed" filter.

### 4. Linking and de-duplication

New table `paperless_links` (per org database):

| Column | Meaning |
|---|---|
| `paperless_doc_id` INTEGER | the Paperless document id |
| `connection_id` INTEGER | which Paperless |
| `expense_id` INTEGER NULL | set when turned into an expense |
| `state` TEXT | `linked` or `dismissed` |
| `created_at` | |

Unique on (`connection_id`, `paperless_doc_id`).

After creating the expense, StudioManager also **writes back to Paperless**: adds the tag `StudioManager`, the year tag, the category tag, and sets the title to `<reference> <supplier>`, matching what the nightly script produces. This keeps Paperless consistent and makes the document look "from StudioManager" for every other tool.

**The nightly script must skip these expenses.** Two options; the builder picks (see below):

- (a) the script reads `paperless_links` from the org database and skips expenses with a link; or
- (b) StudioManager writes the expense id into the script's `state.json` (fragile, couples the app to a script).

(a) is the expected choice. Longer term the nightly upload could move into StudioManager itself as part of this connection; out of scope here.

### 5. Errors and offline

- NAS unreachable (no Tailscale, at a show): inbox shows the last known count with "offline", no error popup.
- Token revoked: connection marked failing like other connections (`last_error`, `failing_since`), notification once.
- PDF download fails: the expense is still created, with a visible "receipt missing — retry" action.

## Constraints

- Tauri v2 app, TypeScript frontend, Rust connectors; follow the existing connector pattern (secret in Keychain, `redact`, fixtures for tests).
- SQLite migrations in the existing migration system; the `CHECK` change needs a table rebuild.
- Paperless-ngx API v5+ (current release); token auth header `Authorization: Token <token>`; send `Accept: application/json` without pinning an old API version (pinning `version=5` returns 406 on the current server — found while building the sync script).
- Data stays local: nothing leaves the Mac except calls to the user's own Paperless.

## Decided

- Paperless is the only source; StudioManager never reads email. (Loris, 2026-11-01)
- One-click confirmation, never automatic booking. (Loris, 2026-11-01)
- Supplier emails reach Paperless through an Infomaniak alias. (Loris, 2026-11-01)

## My calls (Claude) — check these

- Inbox lives under Expenses, not on the dashboard.
- Category guessed from the supplier's history; amount left empty unless a Paperless custom field provides it.
- Write-back of tags/title to Paperless after linking.
- Refresh every 30 minutes while the app is open.

## Left to the builder

- Exact Paperless filter: document type `Facture fournisseur` vs a dedicated `À saisir` tag set by the mail rule. Prefer the tag (clearer intent, survives re-typing).
- Thumbnail caching.
- Whether "Dismiss" also tags the document in Paperless (`Ignoré`) so other tools see it.
- Test fixtures for the Paperless API (same approach as `connectors/fixtures`, captured from the real server where possible).
