# Agent orchestrator — design

Date: 2026-11-12 · Status: **reviewed and approved by Loris on 2026-11-12** (see
[Decisions](#open-questions)). No implementation plan yet.
Implementation plans: [part 1, capture and briefing](../plans/2026-11-12-agent-orchestrator-1-capture.md).
Mockups: [the four screens](../mockups/2026-11-12-agent-orchestrator.html) (open the file in a browser).

Built on [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md). Extends the Agents page
([design](2026-10-28-agents-window-design.md), user guide: [Agents](../../agents.md)), the menu bar panel
([design](2026-10-28-menu-bar-design.md), [guide](../../menu-bar.md)) and "Start work with agent"
([design](2026-11-05-agent-from-task-design.md)). Agents read and write StudioManager through
[Agent access](../../agent-access.md) ([design](2026-10-27-agent-access-mcp-design.md)). It brings back, in another
form, three things dropped in [the AgentBar retirement](../../retire-agentbar.md): the launcher, the results inbox
and wrap up.

Decisions marked *[call]* were made by the designer from the conversation and the code; Loris can overturn any.
Everything else was said by Loris. What he decided in review and what is still open is in
[Decisions](#open-questions).

## Why

StudioManager was made for a person managing tasks. Loris now does much of his work through agents, and the app
shows them, but he is still the only link between a task and the agent working on it. In his words, the load is
"keeping track of everything, briefing the agents, and remembering what's left open". Ideas also get lost: "I don't
always log them because of the friction of starting a new agent for an idea".

What the Mac showed on the day this was written:

- Four background agents were blocked, two of them for several days after the Mac went to sleep mid-answer. The
  morning brief said no agent was waiting.
- Most days have 5 to 15 agent sessions. Three days in a month had 50 to 100. After one of those, a single
  session had to close 165 finished agents.
- The weekly plan limit reached 100% once in three recorded weeks, about 27 hours before it reset, after four days
  of large batches. The two other weeks peaked at 59% and (projected) about 80%.

People who run many coding agents report the same limit: attention, not typing. They settle at two or three
agents followed at once, and what helps is agents that propose and stop, with the person deciding in batches.

## Goals

1. **Capture** a thought in one gesture, without choosing a project or starting an agent.
2. **Briefs written for him**: a captured thought becomes a task under the right project, with a brief an agent
   can start from.
3. **A task carries its agent**: its stage, the agent on it, the branch or pull request, and a short result.
4. **One "Needs you" list** for everything waiting on him, each entry with a recommendation.
5. **A lead that costs little**: the app watches the agents with plain code; a model is used only when judgment is
   needed.
6. **The week's plan limit holds**: a cap on running workers and a budget rule.
7. **Other hubs plug in**: a second source of work with its own store (a client's knowledge hub kept in its own
   private repo) shows in the same screens, including its timeline in the calendar.

## Non-goals

- No agent roles, no dependency graph between tasks, no agents talking to each other.
- No lead session that runs all day.
- The hub's content doesn't move into StudioManager's database. This repo is public; a hub is client material.
- No change to agents started by hand in a terminal: they stay listed and readable only.
- Agent time still doesn't become time entries.
- No phone app. Capture from the phone is in [Decisions](#open-questions).

## Anti-goals

- A lead that decides things Loris would have wanted to decide. Everything it decides alone is listed for him the
  same day.
- Notifications for each agent event. The list is the place to look; notifications stay as they are today.
- A burst of agents that uses the week's limit in two days.

## The four parts

They are built in this order. Each is useful without the next.

### 1. Capture and briefing

**Capture** (mockup, screen 1)

- A global hotkey (Control-Option-Space, the one the retired launcher used) opens a small field over whatever is on screen. Typing and Enter saves the text and closes the
  field. Esc closes it.
- Tab opens an optional project picker *[call]*. Without it, the capture has no project.
- The same field sits at the top of the menu bar panel's Agents tab *[call]*.
- Captures are stored in the active organisation's database (new `captures` table) and listed in an **Inbox** tab
  of the Agents page.
- From the phone: a reminder added to the inbox list in Apple Reminders becomes a capture (source `reminders`).
- An agent can capture too, through a new `capture` tool, so "note this for later" works from any session.
- The hotkey works only while the app is running (it already has to be, for the menu bar panel).

**Briefing**

- A new capture triggers a short **brief session** (see [The lead](#3-the-watcher-the-lead-and-needs-you)). It:
  1. files the capture under a project, as a new task or as a subtask of an open task, or leaves it in the inbox
     when no project fits;
  2. writes the **brief** from the project's wiki, decisions and open tasks: what to do, what done looks like,
     what is unclear;
  3. sets one of three outcomes: **note** (a plain task, nothing more), **needs your word** (the brief has an
     unclear point; it goes to "Needs you" under Briefs), or **ready for an agent**.
- A capture is never started as an agent directly. "Ready for an agent" is set by the brief session only when the
  brief has no unclear point and the work is inside [what the lead may do alone](#leeway) *[call]*; otherwise
  Loris sets it with one click from the Briefs entry.
- Captures are briefed in batches: at most once every 15 minutes, all new captures in one session. Loris chose
  the less costly way over briefing each capture at once.
- The original words of the capture are kept on the task.

### 2. A task carries its agent

(mockup, screen 3)

**Stage.** A task or subtask gets an optional stage beside its status:

| Stage | Meaning | Set by |
|---|---|---|
| (none) | An ordinary task, as today | |
| Briefed | Has a brief; nobody is on it | brief session, Loris |
| Ready | May be started by the watcher | brief session, Loris |
| Running | An agent is on it | the app, when it starts the agent |
| To check | The agent finished; the result waits for Loris | the app, when the agent finishes |

- Done stays the existing status. Accepting a result sets the task to done and clears the stage.
- "Idea" in the mockup's progress line is the capture before it becomes a task.
- The stage shows as a chip on task and subtask rows (Tasks page, project detail) and on the calendar event.
  While an agent on the task is waiting on Loris, the row says so.

**Link.** A new `task_agents` table records each agent started on a task or subtask: session id, short id, name,
model, branch, pull request link, start and end, and how it ended. "Start work with agent" writes a row too, so
agents started by hand from a task are linked the same way. This is the link left out of the
[agent-from-task design](2026-11-05-agent-from-task-design.md).

**Brief and result.** Two text fields on the task:

- **Brief**: written by the brief session, editable by Loris.
- **Result**: written by the agent before it stops, through a new `report_result` tool: what was done, what is
  left open, how to check it. An agent started by the watcher that stops without a result is asked once for one
  (see [Hooks](#hooks)).

The open task shows the progress line, the brief, the agents that worked on it and the last result.

### 3. The watcher, the lead and "Needs you"

**The watcher** is code in the app, not a model. It extends the polling the Agents page already does
(`claude agents --json --all`). On each pass it:

- starts an agent on the next **Ready** task, by priority then due date, while fewer than the cap are running;
- notices an agent that **finished**: runs the project's check command if one is set (see below), then raises a
  check event;
- notices an agent **blocked on a question**: raises a question event;
- notices an agent **stuck on a connection error** (the "went to sleep mid-response" case): resumes it, at most
  three times *[call]*, then lists it under "Needs you";
- notices its own sessions older than a day and idle: asks for a result note, then stops them (wrap up);
- applies the [budget rule](#budget) before every start.

It runs only while the app is open and only in the real app (never in the demo build: it checks
`crate::host::is_demo`). It is off until switched on in Settings › Agents *[call]*.

**Cap.** At most **3** workers started by the watcher run at once *[call]*; the number is a setting. Agents Loris
starts himself don't count and are never stopped by the watcher.

**Check command.** A project can store one shell command that says whether the work holds (for example its test
command) *[call]*. The watcher runs it in the agent's worktree. If it fails, the output goes back to the same
agent once; a second failure goes to "Needs you".

**The lead** is not a session that runs all day. It is a short, fresh session started by the watcher for one
event, with only that event's context:

| Event | What the session does | Model |
|---|---|---|
| New captures | Files them and writes briefs | Opus |
| A worker's question | Answers it if the answer is written in the brief, the wiki or the decisions, and says where; otherwise writes the question for Loris with a recommendation | Opus |
| A finished worker | Reads the diff when the check command passed; accepts, sends back once, or hands to Loris with a summary | Opus |

- Opus everywhere is Loris's choice: he trusts it more than Sonnet. Batching, short sessions and the budget rule
  are what keep the cost down, not a smaller model.
- Every lead session ends by writing its outcome through the tools below and stops. Nothing is kept in a session
  between events: the state is in the database.

**Needs you** (mockup, screen 2) becomes the first tab of the Agents page, with three groups:

- **Decide**: questions from workers the lead could not answer. Each has the question, the recommendation and its
  reason, one button per option, and "Answer in words". The answer is typed into the waiting agent (the existing
  message path for background agents) and saved as a decision on the project when the lead marked it as one.
- **Check**: finished work. Each has the result, the size of the change, whether the check passed, and Accept,
  Open the pull request, Send back.
- **Briefs**: captures that need his word before an agent starts.

A line per connected hub shows how many entries wait there (see [part 4](#4-hubs)).

The sidebar's Agents entry and the menu bar icon show the count. The existing "Needs you" group of agents (an
agent waiting at a prompt) stays in the "All agents" tab; an agent started by the watcher shows in the new list
instead, so nothing is listed twice.

**Leeway**

<a id="leeway"></a>

| The lead may do alone | The lead always asks |
|---|---|
| File captures and write briefs | Releases and version bumps |
| Answer a worker from what is written, naming the source | Anything a client will see |
| Restart a stuck agent; wrap up an idle one | Money (invoices, quotes, expenses) |
| Send work back to a worker once | Deleting files, branches or data |
| Merge a pull request when all of these hold: the check command passes, the change is under 100 changed lines, and nothing in the right column is touched. Allowed in every organisation, personal and studio work alike. A project that belongs to a connected hub is always left out | Security and machine settings |
| | New dependencies; database migrations |

Everything the lead decided alone is recorded with its reason and listed in the end-of-day brief, where Loris can
reopen any of it.

**Budget**

<a id="budget"></a>

The app already records the plan's five-hour and weekly percentages. Before starting a worker or a lead session,
the watcher checks:

- the weekly percentage is not ahead of the straight line from 0% at the reset to **85%** at the next reset
  (the last 15% is kept for work Loris starts himself);
- the five-hour percentage is under **80%** *[call]*.

When either fails, Ready tasks wait and the Agents page says why ("Paused: ahead of the week's pace"). Questions
and checks for work already running are still handled, so nothing is left half done. Loris can start any task by
hand regardless.

**Hooks**

A session started by the watcher gets a Stop hook *[call]*, on the model of the one the client hub already uses:

- it stops once when the session ends on a question that was not sent through the `ask` tool;
- it stops once when the session ends without `report_result`.

This is what keeps a question from sitting unseen in a finished session.

### 4. Hubs

A **hub** is another store of work that keeps its own files and rules: for Loris, a client's knowledge hub in a
private repo, with its own questions, inbox, decisions and timeline. Today it has its own web dashboard, its own
brief and its own agent list, which repeats most of what StudioManager does. The aim is one place to look, with
the hub's content staying where it is.

- A hub is added in Settings with a name, a colour and a **connector command** *[call]*: a program on the Mac
  that answers a small set of requests in JSON. The hub's repo provides it. StudioManager knows nothing about
  the hub's file formats.
- The requests *[call]*:

  | Request | Returns or does |
  |---|---|
  | `counts` | How many questions wait on Loris |
  | `questions` | The open questions, with recommendation and options when the hub has them |
  | `answer` | Records an answer in the hub |
  | `capture` | Adds a line to the hub's inbox |
  | `events` | Dated items for the calendar |
  | `open` | A link or path that opens an item in the hub |

- **First version**: `counts`, `open` and `events` only. "Needs you" shows the hub's line with its count and a
  link (mockup, screen 2), and the calendar shows its dates.
- **Later**: the hub's questions listed inline in "Needs you", capture into the hub from the capture field, the
  hub's agents grouped under its name, one day brief with a section per hub. When those are in place the hub's
  own dashboard can be retired; that happens in the hub's repo, not here.
- Nothing from a hub is written into StudioManager's database, its backups, the agent log or the demo build.
  Connector output is held in memory and refetched.

**The hub's timeline in the calendar** (mockup, screen 4)

- `events` returns items with an id, a title, a start date, an optional end date and an optional note. The
  client hub already produces exactly this list for its own calendar feed: events, deliveries due, milestones
  and upkeep.
- They show as a **read-only layer** in the Calendar page, in the hub's colour, with a switch in the header.
  All-day only.
- Clicking one opens it in the hub (`open`). Dragging and resizing do nothing: dates are changed in the hub.
- They are not sent to Apple Calendar by StudioManager *[call]*, because the hub's own feed can already be
  subscribed to there and the dates would show twice.
- The layer is built with or after the planned move to FullCalendar 7, so it is not built twice.

## Data and tools *[call]*

Part 1's plan checked this section against the code and changed it where it didn't hold; the plan's last section,
"Design gaps and decisions taken in this plan", lists each change. The main ones: `captures` needs more columns
than listed here (project, subtask, outcome, a reason for staying in the inbox, a try count, the reminder's id);
`file_capture` also takes a title and a reason and its project is optional; a `list_captures` tool is added; and
reminders are read with AppleScript like the existing calendar sync, since the app has no EventKit code.

New migration (numbered after the latest), per organisation database:

- `captures`: id, text, created_at, source (`hotkey`, `menubar`, `agent`, `reminders`), status (`new`, `filed`, `dismissed`),
  task_id.
- `tasks` and `subtasks`: `stage` (null, `briefed`, `ready`, `running`, `to_check`), `brief`, `result`.
- `task_agents`: id, task_id or subtask_id, session_id, short_id, name, model, branch, pr_url, started_at,
  ended_at, outcome.
- `needs_you`: id, kind (`decide`, `check`, `brief`), task_id, session_id, title, body, recommendation, options
  (JSON), status (`open`, `answered`, `dismissed`), answer, decided_by (`user`, `lead`), reason, created_at,
  answered_at.
- `projects`: `check_command`.

New Agent access tools, each following [the rules there](../../agent-access.md) (no deletes, backup before the
first write, logged):

- `capture(text, project?)`
- `file_capture(capture_id, project, task? , brief, outcome)`
- `set_brief(task_id | subtask_id, brief)`
- `ask(task_id | subtask_id, question, recommendation, options?)`: adds a Decide entry and returns its id.
- `report_result(task_id | subtask_id, result, branch?, pr_url?)`
- `resolve(needs_you_id, answer, reason)`: for lead sessions only; records a decision made alone.

The stage is set by the app, not by a tool, except `ready`, which `file_capture` may set.

Existing behaviour that must hold: status changes through the tools stay limited to todo and done; the tools
refuse in test and presentation mode; money tools are untouched.

## What it costs

- The watcher, the check command, the budget rule and the hub connector use no model.
- A lead session is short and starts with one event's context, not a day's.
- Workers and lead sessions run on Opus. This costs more per session than a smaller model would, which makes the
  cap and the budget rule the main protection for the week's limit.
- The cap and the budget rule spread a large batch over several days instead of two.
- What the lead sessions add per week is not known yet. The first week it runs, the Usage tab's numbers are the
  measure; the cap and the 85% line are then adjusted.

## Decisions

<a id="open-questions"></a>

Decided by Loris on 2026-11-12:

- The hotkey is Control-Option-Space.
- "Needs you" is the first tab of the Agents page.
- The lead may merge alone under the rule in [Leeway](#leeway), in every organisation.
- The app starts work by itself only under 85% of the week's pace.
- Captures are briefed in batches (the less costly way).
- Workers and lead sessions run on Opus.
- Agents on a second machine are out of this design. That machine is for agents that take control of the screen
  and for large renders, to keep the load off the main Mac; listing them gets its own design later.

- Capture from the phone goes through **Apple Reminders**: a list named for the inbox. The app reads new
  reminders from that list into the inbox and marks them completed, so the list stays empty. It works from the
  phone, the watch, Siri and the share sheet, and syncs by itself. It needs the Reminders permission and arrives
  only while the Mac is on and the app is open. Considered and set aside: a Shortcut writing to an iCloud Drive
  file, a dedicated mail address, a small endpoint on the home server.

- A project that belongs to a connected hub is never merged by the lead alone: its results always come to Loris
  under Check.

## Build order

1. Capture and briefing: `captures`, the hotkey and field, the Inbox tab, the brief session, Briefs entries.
   Then capture from the phone through a Reminders list.
2. A task carries its agent: `stage`, `task_agents`, brief and result, the chips and the open-task view.
3. The watcher, the lead and "Needs you": the cap, the check command, question and check sessions, the leeway
   rules, the budget rule, the Stop hook, the end-of-day list of what the lead decided.
4. Hubs: the connector setting, the count line, the calendar layer; then the later items.

Each part gets its own implementation plan under [plans](../plans) once this design is approved.
