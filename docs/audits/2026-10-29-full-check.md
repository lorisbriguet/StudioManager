# Full check — 2026-10-29

**Scope:** everything merged since 2026-10-28 10:47 (`7328555` → `ee584af` on `main`): the wiki vault and MCP wiki links (v2.3.0), the Agents page ([PR #1](https://github.com/lorisbriguet/StudioManager/pull/1)), the wiki UI fixes (#3), studio upkeep with the Synology and Bambu connectors (#4), the menu bar panel and day routines (#5, #6), the UI component library with the whole app moved onto it (#2), the npm audit patch (#8), plus the open draft [PR #7](https://github.com/lorisbriguet/StudioManager/pull/7) (quieter "needs you" notifications, one row per session). Previous audit: [2026-09-28](2026-09-28-full-audit.md).

**Method:** eight independent reading passes by separate agents, each briefed with the exact scope and asked for a concrete failure scenario per finding — three on the interface (design-system conformance against [DESIGN-SYSTEM.md](../../DESIGN-SYSTEM.md), accessibility and i18n, refactor regressions in #2) and five on security and the backend (the agents module, the menu bar and routines, upkeep and connectors, the MCP server and agent access, the Tauri shell and DB layer). The two high findings were re-verified by hand. Findings the agents could not confirm were dropped.

**Deterministic results** on `main` + #7: tsc clean, eslint clean, vitest 1342 tests in 173 files, cargo 282 tests, npm audit 0 (after #8), clippy two warnings (MSRV, `slice::from_ref`), EN and FR translation tables identical (1586 keys each).

**Fixes in flight:** every interface finding (sections A–C, 43 items) is being fixed by a dedicated session on branch `worktree-ui-fixes` (draft PR "Full check 2026-10-29: UI fixes"). D.1 and D.2 are fixed in #7. Everything else is open.

Feature docs: [Agents](../agents.md) · [Menu bar](../menu-bar.md) · [Agent access](../agent-access.md) · specs for the [agents window](../superpowers/specs/2026-10-28-agents-window-design.md), the [menu bar](../superpowers/specs/2026-10-28-menu-bar-design.md) and [studio upkeep](../superpowers/specs/2026-10-28-studio-upkeep-design.md) · [RELEASING.md](../../RELEASING.md).

---

## P1 — fix before the next release

| # | Where | What | Fix |
|---|---|---|---|
| A.1 | `src/components/ui/DatePicker.tsx:345,352` | Enter on unparseable text (`31.02.2026`) marks the field red but does not stop the event; `Form.tsx:157` submits with the previous date. Recurring invoice, paid date, expense/income/project dates. **Verified.** | `preventDefault` on Enter when `settle()` is undefined; a field error that blocks submit |
| F.1 | `src/components/agents/Conversation.tsx:69`, `src-tauri/src/lib.rs` | Agent replies are `react-markdown` with no `a` override and no click interception; no `on_navigation` on the windows. A link the agent copied from a README takes the main webview off `tauri://localhost` to the attacker's page (CSP gone, can imitate the app, no way back). **Verified.** | Render `a` through plugin-shell `open()` after `preventDefault`; `.on_navigation(\|u\| u.scheme() == "tauri")` on both windows |
| D.3 | `src-tauri/src/agents/pty.rs:470-475` | Single-line messages are typed as keystrokes: a leading `!` enters Claude Code's bash mode, `/` runs a slash command — "!important fix" runs a shell command in the agent's folder, "/clear" wipes its context. | Always bracketed paste (`\x1b[200~…\x1b[201~`) |
| E.1 / F.3 | `src-tauri/src/agents/routines/mod.rs:94-123`, `capabilities/default.json` | Any webview can save a command routine (`/bin/sh -c …`) and run it in two IPC calls; `default.json` still says "the webview cannot execute shell commands". Same origin today, so a real boundary only against XSS. | Native confirm when a command routine's program/args/cwd changes; fix the description |
| E.2 | `routines/schedule.rs:39-47`, `store.rs:322-333`, `run.rs:163-168` | A failed routine's lock-screen notification and `routine-runs.json` carry the last output line (≤300 chars): tokens from a `curl -v` land on the lock screen and in a plaintext file. | Notify "{title} failed" only; keep the line in the panel |
| H.1 | `connectors/synology.rs:289-304`, `src/lib/upkeep/connections.ts:34-44` | The NAS password is POSTed to whatever `connections.host`/`cert_fingerprint` say; those rows are plain SQLite (backed up, restorable). A tampered backup redirects the next 6-hourly sync's credentials. | Keep host and pin in the Keychain blob; ask for the password again when the row differs |
| A.2 | `pages/ExpensesPage.tsx:609`, `IncomePage:506`, `ProjectsPage:498` | FormModal submits on Enter with no `submitting` flag while `onSave` awaits the next reference: key-repeat creates N expenses with the same reference. | Local `saving` → `submitting` |
| A.3 | `db/hooks/useInvoiceTemplates.ts:57` (+ `InvoicesPage:547`, `ProfilePage:217`) | Template delete lost its confirm; Undo re-inserts the template only while `invoices/quotes.template_id` are `ON DELETE SET NULL`: 40 invoices silently on the default template. | Snapshot dependants, or keep the confirm |
| A.7 / A.8 | `useWiki.ts:131`, `NamedTable.tsx:134,184`, `WorkloadTemplateManager.tsx:62,93` | Article, table and workload-template deletes lost their confirms; Undo re-creates with new ids (order, timestamps, `projects.workload_template_id` lost); column-delete Undo restores a stale array (delete A, add B, Undo → B gone). | `snapshotRows/pushRestore` with the same ids; compute undo at undo time |
| H.3 | `src/lib/upkeep/renewals.ts:16-19`, `SubscriptionForm.tsx:85` | A past "renews on" (monthly, 2024) inserts 33 renewal rows and 33 "add to expenses?" questions at the next check. | Roll a past date forward in the form, or cap/confirm catch-up |
| H.2 | `upkeep/SubscriptionsTab.tsx:131`, `MachineExpenseRow.tsx:67`, `PrefilledExpenseModal.tsx:35` | Renewal amount is prefilled into an expense without currency (`expenses` has none): "USD 15.00" booked as CHF 15.00. | Show the currency; convert or block non-base currencies |
| D.1 / D.2 | `agents/model.rs`, `agents/poller.rs` (PR #7) | Dedupe could hide a live waiting background job behind a newer busy resume and drop its job id; the notification gate dropped a second prompt inside the cooldown. | **Fixed in #7** (`99b7407`), with tests |

## P2 — this week

**Interface (A–C; all on the ui-fixes branch)**
- A.4 `SettingsPage.tsx:557,750` — calendar and backup lists load `onFocus`; `Select` is a `<button>` now, which WebKit does not focus on click → empty until closed once. Load on open.
- A.5 `lib/queryClient.ts:25`, `notify.ts:71` — hooks dropped their own error toasts; the backstop dedupes per label for 30 s, so a second different failure is silent and the row reverts. Dedupe on label+details.
- A.6 `named-table/ColumnEditorPopover.tsx:50` — Esc now saves a mistyped rename. `onClose={(ret) => ret ? onCancel() : onCommit()}`.
- A.12 `upkeep/PrefilledExpenseModal.tsx` — the merge dropped the renewal dialog title; four `upkeep_*` keys orphaned.
- B.1 `agents/AgentDetail.tsx:321` — icon-only `Button` for Send; `IconButton icon={ICONS.send}`. B.2 `agents/AgentList.tsx:26` — status dots on text tokens; add `--color-info`, share classes with `menubar/DayTab.tsx` via `statusColors.ts`.
- B.5–B.11 — accent solid as link colour in `.tiptap-editor` (`index.css:642`); undocumented `hover:text-accent-hover` only defined for light (`ClientDetailPage.tsx:334,716`); three DESIGN-SYSTEM.md lines the code contradicts (`:1079` NavItem colour, `:1212` `MENU_PANEL`, `:520` `hover:text-accent`) and the slate Default Dark accent undocumented (`:75,138`); hand-built composer frame with `!` overrides (`AgentDetail.tsx:256-319`); hand-rolled rows in `QuickTimerModal.tsx:102-140`; raw buttons in `UpdateChecker.tsx:85-103`, `ExpenseCategoryManager.tsx:217-226`.
- C.1 `index.html:2`, `app-store.ts:342` — `<html lang>` never switches to French. C.2 `NamedTable.tsx:249`, C.3 `TasksPage.tsx:340` — hard-coded English. C.4 `NamedTable.tsx:259` — drag handle that drags nothing. C.5 `SortableSubtaskRow.tsx:35` — handle invisible to keyboard focus. C.6 `agents/Conversation.tsx:55`, `PromptAnswer.tsx:101` — no live region for streamed replies and the needs-you prompt. C.7 incomplete ARIA tabs in `menubar/MenuBarApp.tsx:54-68`, `WikiSidePanel.tsx:45`, `ui/TabItem.tsx:43-54`.

**Backend and security**
- D.4 `agents/actions.rs:167,223`, `cli.rs:19` — 10 s `CLI_TIMEOUT` on `--bg`/`--resume` reports failure while the job runs; `switch_model` then shows a "blocked" copy and a retry duplicates. Longer timeout; re-list and match by name on timeout.
- E.3 `menubar/mod.rs:176-185` — panel without `visible_on_all_workspaces`: from a fullscreen app or another Space the icon switches Spaces or shows nothing.
- E.4 `menubar/mod.rs:42-59,187-197,258-260` — `show()+set_focus()` activates the app; the 600 ms grace heuristic steals focus back from Finder, and on a slow Mac the #6 bug returns. Non-activating panel (tauri-nspanel) or Accessory policy while main is hidden.
- F.2 `lib.rs:596` `open_in_finder` — a directory goes to `open <dir>`, which launches an `.app`; `folder_path` is settable by the MCP `link_folder` without a bundle check. `open -R`; refuse bundle extensions.
- G.1 `mcp/src/guard.rs:55-65` — the enable/money/per-org gate is a same-user JSON the AI app can rewrite; [agent-access.md](../agent-access.md) calls unticked orgs "invisible". Document it as a consent switch.
- G.2 `agent_access.rs:500`, `src/hooks/useDbChangedListener.ts:18` — `PRAGMA data_version` moves on the app's own commits too: every edit → `db-changed` → `invalidateQueries()` refetches everything. Emit on `agent-log.jsonl` mtime instead.
- G.3 `mcp/src/write.rs:715,752` — `[[x.md]]` resolution stats files under every `folder_path` inside `BEGIN IMMEDIATE`: an offline Synology folder makes the app's writes fail "database is locked". Resolve before the transaction.
- G.4 `write.rs:883-895` — `add_decision` dedup breaks after a get→put round trip (loose vs tight list form). Dedup on `<strong>{day}</strong> {text}`.
- H.4 `connectors/tls.rs:88-93`, `SynologyForm.tsx:89-96` — TOFU pin from whoever answered first, bypasses hostname and expiry forever. Show the DSM path to compare; re-verify on Reconnect.
- H.5 `connectors/mod.rs:188-201` — `updated_secret` written back unconditionally; a finishing background sync overwrites Reconnect's new password + OTP. Compare-and-swap.

## P3 — housekeeping

- Window gating (D.6, E.9, F.4, G.–, H.10): `capabilities/menubar.json` limits plugins to `core:default` but every app command (`execute_batch`, `routines_save`, `agents_term_write`, `connection_*`) is callable from the panel; `core:event:default` lets it emit `menubar:navigate` with any path (`useMenuBarNavigate.ts:13`). Same origin today; close with an AppManifest when the panel grows (noted in [IDEAS.md](../../IDEAS.md)).
- Agents: D.5 `pty.rs:576-596` term_write/resize accept temporary terminal ids; D.7 `cli.rs:153-162` `env_clear` drops `CLAUDE_*`/`ANTHROPIC_*`/proxy vars; D.8 `cli.rs:281,313` missing `claude` re-runs the 10 s login shell per settings open; D.9 `poller.rs:193-200` `locate()` 4× per agent per pass; D.10 `uploads.rs:35-47` mime trusted from the webview; D.11 `actions.rs:56-61` corrupt state file silently reset; D.12 banners carry Org › Client › Project to the lock screen.
- Routines: E.5 `store.rs:300-305` unreadable runs file disables the once-per-day guard; E.6 `record_run` failure retried silently for 2 h; E.7 Cmd+Q orphans a running command (no `ExitRequested` handler); E.8 `env_clear` undocumented in [menu-bar.md](../menu-bar.md); E.10 `menubar/DayTab.tsx:27-31,167` swallows "Agents are switched off" and "Not found".
- Shell: F.5 `tauri.conf.json:28` `connect-src` allows `github.com` unused.
- MCP: G.5 "lossless" round trip flattens h4+, tables, images, blockquotes, task lists; G.6 `link_folder` accepts any absolute path (`/Users` claims every folder); G.7 no size cap on content, `find_article` loads every article; G.8 log rewrite loses lines with two servers, same-second backups collide; G.9 registered sidecar path breaks when the app moves, never verified; G.10 app `execute_batch` uses deferred `BEGIN` (`BUSY_SNAPSHOT`); G.11 server stores `javascript:` hrefs (defused by the viewer and CSP); G.12 [agent-access.md](../agent-access.md) says 26 tools, there are 27.
- Upkeep: H.6 `rust-version = "1.77.2"` is fiction (reqwest 0.13.4 needs 1.85; `bambu.rs:353` uses `is_none_or`); H.7 no response size cap in `synology.rs:425`, `bambu.rs:447`; H.8 Escape during first Connect orphans a row and a Keychain secret; H.9 machine delete leaves `machines/<id>/` files, Undo loses history; H.11 port 70000 reaches the backend.
- Interface lows: B.3 eight icons bypass the icon map; B.4 agent status classes retyped per file; B.12–B.15 off-scale text, divider token on a control, missing `ui/index.ts` exports, raw `String(e)` in four alerts; C.8–C.14 money formatting without `Intl`, `42%` in French, untranslated sonner region, danger EmptyState without `role=alert`, `aria-pressed`, composer `aria-label`, context-menu-only actions in the wiki explorer.

## Tests to add first

1. DatePicker inside a FormModal: invalid text + Enter must not submit (A.1).
2. `pushRestore` round trip on real sqlite: delete with children and FK SET NULL, undo restores ids, links and timestamps (A.3, A.7, A.8).
3. FormModal double-submit: key-repeat Enter with an async `onSubmit` yields one mutation (A.2).
4. `send_message("!ls")` and `"/clear"` are written as bracketed paste; `hub.write` to a temporary terminal is refused (D.3, D.5).
5. Scheduler `check` as a pure function: unreadable runs file, `ALREADY_RUNNING`, wake-jump arithmetic (E.5).
6. `tls::pinned_http_client` end to end against a local TLS listener: unpinned → `untrusted_cert:<fp>`, pinned → OK, other cert → refused (H.4).
7. MCP round trip per editor node type: `to_html(html_to_markdown(x)) ≈ x` (G.4, G.5).
8. `read_version`/`check_for_changes` with a second in-process connection (G.2).

## Clean bill

No shell anywhere in the agents module except the fixed `/bin/zsh|bash` lookup; argv-only spawns with validated ids, names, models and task; prompt answering re-verifies the prompt fingerprint before a single Enter and defeats fake prompts printed by an agent. Routines: argv-only exec with absolute program and cwd validated at save and run, SIGKILL on the process group, atomic writes, DST-safe scheduling, wake detection. CSP without `unsafe-inline` scripts or remote image hosts, no asset protocol, updater on HTTPS with a pinned minisign key, secrets Keychain-only with redacted errors, TLS system-trusted or exactly pinned. Every SQL statement parameter-bound with whitelisted identifiers in the app, the upkeep queries and the MCP server; the server has no DELETE/ALTER/DROP (a test greps for it), scopes every write to one project, refuses writes in test and presentation mode and backs up before its first write. Interface: the shared Modal, Popover, Dropdown and form components have correct roles, focus traps and focus return; no raw colours, overlays or off-scale text outside `ui/`; EN and FR in parity; the menubar window follows theme and language.
