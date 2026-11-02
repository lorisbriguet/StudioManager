# Network page — handover

Date: 2026-11-02. Written by the session that brainstormed the feature with Loris, for the session that builds it.

## Where things stand

- **Design (approved by Loris 2026-11-02):** [2026-11-02-network-page-design.md](../specs/2026-11-02-network-page-design.md).
- **Plan (8 tasks):** [2026-11-02-network-page.md](2026-11-02-network-page.md). Nothing is built yet.
- **Mockup Loris chose (option A, grouped by machine):** `docs/superpowers/mockups/2026-11-02-network-page.html`
  (open it in a browser; the click-to-select script of the brainstorm tool is not included, ignore its errors). Its
  numbers were illustrative.
- **Branch / worktree:** `worktree-dashboard-pages-spec`, at
  `/Users/loris.briguet/Documents/GitHub/StudioManager/.claude/worktrees/dashboard-pages-spec`, pushed to `origin`.
  `main` was clean at 3.2.0 (`96d0ed6`) when the branch started.
- **Execution method chosen by Loris:** subagent-driven (`superpowers:subagent-driven-development`): a fresh
  implementer per task, a fresh reviewer before the next task, a whole-branch review at the end.

## Wait for Loris's go

**Build nothing until Loris says go.** Read and check first; questions to Loris are fine. Loris was near his usage
limit when this was written.

## What to read first

1. The design and the plan above, in full.
2. [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md): the UI rules are strict (reuse first, flag anything new to Loris,
   tokens only, wording rules, EN + FR).
3. Related designs: [studio upkeep](../specs/2026-10-28-studio-upkeep-design.md) (machines, connections),
   [organisations](../specs/2026-09-22-organisations-design.md) (one database per organisation, "use equipment
   from"), [Paperless inbox](../specs/2026-11-01-paperless-inbox-design.md) (the latest feature built the same way,
   with its [plan](2026-11-01-paperless-inbox.md)).
4. The code the plan names, to check every claim before Task 1. The plan's file paths and function names were
   verified on 2026-11-02 against `main` at 3.2.0.

## Facts from the brainstorm the documents rely on

- Loris has two organisations: a studio one that owns the machines and the Synology connection, and a personal one
  whose `prefs.equipmentFrom` points at the studio one (Settings › Upkeep).
- Loris chose that a borrowing organisation **never** uses the lender's connection secrets; it shows the lender's
  last readings with their age (design §6).
- Today the readings and disks queries read the open organisation's own database (`getDb()`), so in Personal
  Projects a borrowed NAS shows no disks. Plan Task 2 fixes it.
- Loris's studio, for Task 8: a Synology NAS reached over Tailscale with a publicly trusted certificate, hosting
  DSM, Paperless, Pi-hole, Uptime Kuma, Forgejo, FreshRSS and Homepage; a Mac mini reached with Screen Sharing
  (`vnc://`) from the MacBook and Jump Desktop from the iPad; Time Machine from the MacBook Pro to the NAS, running
  its first full backup on 2026-11-02. **Addresses and ids are private and never go in this public repo:** they are
  in Claude's memory note `nas-setup` on Loris's Mac and in the Studio Network wiki in StudioManager.
- The Time Machine plist on Loris's Mac had no `SnapshotDates` during that first backup, and `RESULT = 26` from an
  earlier attempt while `tmutil status` said `Running = 1`: the plan's Task 7 cases come from that.

## Watch out

- **Database version 9 → 10 in Task 7.** The installed StudioManager's MCP tools refuse a newer database until a
  release ships. Run Task 7 last and tell Loris before the dev build opens his real data.
- **Task 8 needs Loris at the Mac** (real NAS sync, opening the remote links, both organisations).
- Code lives in `~/Documents/GitHub` (not in Synology Drive). Never undo a test mutation with `git checkout`; never
  chain commit/push after a test command piped into `grep`; commit only after the tests pass.
- Loris's preferences: no emojis; show rendered mockups (never ASCII) when offering layout options; short, plain
  updates.
