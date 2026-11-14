# Agents

The Agents page shows every Claude Code agent running on your Mac in one place, so you can see which ones need you without opening each terminal. It is off until you turn it on. The app talks to the `claude` command on your Mac; the only port it opens is the one for [morning brief comments](#morning-brief-comments) and [review reports](#start-from-a-review-report), on this Mac only.

Design and reasons: [the design spec](superpowers/specs/2026-10-28-agents-window-design.md). For letting AI apps read your StudioManager data, see [Agent access](agent-access.md), which is a separate feature. To see and answer agents from the Mac menu bar, see [Menu bar](menu-bar.md). To connect another store of work (a hub) to the app, see [Writing a hub connector](hub-connector.md).

## Turning it on

1. Install the `claude` command line tool (Claude Code).
2. Open Settings > Agents and switch it on. The card shows the path of `claude` the app found. Without it the switch cannot work.

Turning the switch off hides the page and closes any open terminals.

### How the app finds and runs `claude`

The app asks your login shell (zsh, or bash if that is your shell) where `claude` is, so it finds it even when StudioManager was opened from the Finder. If `claude` is not found, the app looks again at most every 30 seconds: install Claude Code, then reopen the settings card.

`claude` runs with a clean environment: `PATH` from your login shell, `HOME`, `USER`, `LANG` and `TERM`, plus the variables from your login shell that change how Claude Code works: every `CLAUDE_…` and `ANTHROPIC_…` variable (such as `CLAUDE_CONFIG_DIR` or `ANTHROPIC_BASE_URL`) and the proxy variables (`HTTPS_PROXY`, `NO_PROXY` and the like). Agents then use the same settings and sign-in as in your terminal. Nothing else is passed on.

## The page

Agents are grouped as **Needs you**, **Working**, **Idle** and **Done**. Each one is labelled Organisation > Client > Project when its folder is linked to a project, across all organisations. Otherwise it shows the folder name.

Right-click an agent to **flag** it. A flagged agent that is idle or done moves to a **Flagged** group at the top, so it is easy to find again; one that works or needs you stays in its group with a flag. Flags are kept on this Mac and show in the menu bar panel too. Right-click again to remove the flag.

An agent in Needs you that has waited for more than 2 hours with no change, or that you dismiss, moves to Idle. A dismissal covers only the current wait: the next time that agent needs you, it shows in Needs you again.

For each agent you can read the conversation. Agents started in the background (from this page or with `claude --bg`) also let you send a message, switch model, stop or delete them. Agents started in a terminal are listed and readable only. In Needs you you can also dismiss an agent.

- **Send a message:** not while a prompt is open, and not for agents started in a terminal. The message always reaches the agent as text: it is pasted in one piece, then Enter is pressed. A message that starts with `!` or `/` gets a space in front, so it never runs a shell command or a slash command such as `/clear`: use the terminal for those. If a prompt opens while the message is being pasted, Enter is not pressed and the message stays in the agent's input. A message you sent shows greyed out ("Sent, not read yet") until the agent's conversation holds it, then turns into a normal message. The app only remembers it while it is open; one the agent never shows is dropped after 30 minutes.
- **Reading:** the conversation opens at the latest message and follows new replies while you are at the bottom. Scroll up and it stays where you are; a round arrow button at the bottom brings you back to the latest message.
- **Switch model:** stops the agent and continues the same conversation as a new agent on the model you pick.

Starting an agent (or the new agent of a model switch) can take a while: the app waits up to a minute for `claude`. If that is not enough, it looks for the agent in the list by its name and folder, so an agent that did start is not reported as failed and is not started twice. Other `claude` commands (list, stop, delete) are given 10 seconds.

## New agent

Pick a folder, write the task, choose a model (haiku, sonnet, opus or fable) and optionally give it a name.

The folder list shows the folders you already trusted in Claude first (linked project folders first), then folders you may want that Claude does not trust yet: your home folder, your linked project folders, and the folders that hold them (where a code folder such as `~/Documents/GitHub` sits). **Choose…** opens any other folder.

Trust follows Claude Code's own rule: a trusted folder covers every folder inside it, except a git repository. Inside a repository Claude looks no higher than the repository's root, so a trusted folder above it (your home folder, or a code folder such as `~/Documents/GitHub`) does not cover it: the repository itself has to be trusted. A worktree inside its repository is covered by the repository. Starting an agent in a folder that is not trusted yet asks first ("Trust … for Claude Code?"). On **Trust and start**, StudioManager sets `hasTrustDialogAccepted` for that folder in `~/.claude.json`, the same thing answering Yes to Claude's own question does: it takes Claude's lock (`~/.claude.json.lock`), changes only that flag and keeps the file private. The home folder gets a stronger warning, since trusting it trusts everything in it. Nothing is trusted without that yes.

## Start from a task

Right-click a task, a subtask or a project and choose **Start work with agent**. The item is in the menus of the Tasks page (task and subtask rows, project headers), the Projects page, a project's Tasks section, and the Calendar's task, subtask and deadline events. It is hidden while agents are off.

One click starts an agent on Opus in the project's linked folder and opens it on this page. There is no form: the agent is told which item to work on (its ids and titles), reads it and its context with the StudioManager tools ([Agent access](agent-access.md)), then tells you what it found and asks what to do before changing anything. Answer it in the conversation.

- **No linked folder:** a folder picker opens; the folder you choose becomes the project's linked folder. Cancelling starts nothing.
- **Folder not trusted yet:** the same trust question as **New agent**.
- **Again on the same item:** each click starts a new agent, named after the item (`task-44-new-features`).

Design: [the design spec](superpowers/specs/2026-11-05-agent-from-task-design.md).

## A task carries its agent

A task or subtask that has a brief or an agent shows a small **stage** next to its title. It tells you where the work stands without opening the agent. The stages are:

- **Briefed:** the item has a brief. The brief session sets it when a capture needs your word. You can set it yourself.
- **Ready:** the brief is complete. The brief session sets it when the capture is clear. You can set it yourself. While [the watcher](#the-watcher-and-the-lead) is on, an agent starts on a Ready item by itself; otherwise nothing starts.
- **Running:** an agent works on it. Only the app sets it, the moment an agent starts from the item.
- **To check:** the agent has finished and its work waits for you. Only the app sets it.

The stage is hidden once the item is done, and while Agents is off.

### The link

When you use **Start work with agent** on a task or a subtask ([Start from a task](#start-from-a-task)), the app also writes a **link** between the item and that agent, and sets the stage to Running. The link is written only then. An agent started from a project, from the **New agent** form, from a [review report](#start-from-a-review-report) or in a terminal has no task to link to, so it gets none. A worker started by [the watcher](#the-watcher-and-the-lead) gets a link too, marked as the watcher's. A link is kept with its task: delete the task and its links go too.

A Running item says **waiting on you** next to its stage when its agent asks you a question or needs a permission.

### `report_result`

The agent started from a task is asked to call `report_result` when it is done, or when it stops with work left. It is one of the tools of [Agent access](agent-access.md#tools). The agent writes a short result: what was done, what is left open and how to check it (at most 4,000 characters). It can add the branch and the pull request link. The result shows on the item. `report_result` never changes the stage or the status: that stays with you and the app. It writes the branch and pull request link on the item's open link only when the item has exactly one. With no open link (an agent started by hand) or with several (more than one agent started on the same item) it writes the result only.

### When an item goes to To check

Every 30 seconds the app looks at the agents you started from your items. (A worker the watcher started is followed by the watcher instead: see [When a worker stops](#when-a-worker-stops).) An item goes from Running to **To check** when one of these holds:

- the agent has reported a result and is no longer working;
- the agent shows as done;
- the agent is gone from the list: stopped and removed, or it never started (it has to be missing from two successive lists);
- the item has a result and more than one open link: the agents that are idle close their links (the result cannot be tied to one of them).

An agent that is idle without a result keeps the item in Running (unless the previous rule applies). It may simply be waiting for your answer, and the list shows that the same way as a finished agent. The link closes at the same time and notes how it ended: with a result, or without one.

### The panel

Open a task (it expands to show its subtasks) and a **panel** sits at the top. On a subtask, click its stage to open the same panel under it. It shows the steps Idea, Briefed (or Ready), Running, To check and Done, with the current one in bold, then:

- **Stage:** you can set No stage, Briefed or Ready. Running and To check are the app's.
- **Brief:** editable. It saves when you leave the field.
- **Agents:** each linked agent with its state (working, waiting on you, finished, or "ended without a result"), its model, its branch and pull request link, and **Open** to go to it on this page.
- **Result:** the agent's last result, read-only, or a note that there is none yet.

On an item in To check, **Accept** marks the task or subtask done the usual way (calendar event removed, due date moved to today, undo entry) and clears its stage; it does nothing if the item is no longer in To check. A subtask without a chip (stage cleared, or done) that still has a result or an agent shows a small agent button on its row that opens the same panel. **Clear stage** removes the stage and leaves the item open.

### Where it does not apply

- In test or presentation mode, **Start work with agent** still starts the agent, but no link and no stage are written. The copy of the data it would go to is thrown away when the mode ends.
- Stages and the panel never show in the demo build, or while Agents is off.
- If the agent starts but its link cannot be written, the app says so. The agent keeps running.

### The dev build

In the dev build (`npm run dev:test`, see the [README](../README.md)), an agent started from a task uses the dev build's own StudioManager server and data folder, not the installed app's. This lets you try the whole flow on fictional data. Release builds start agents as they always did. The dev build has its own watcher switch, and its [budget](#the-budget) reads the installed app's usage reading, since the status line writes only there.

Design and reasons: [agent orchestrator design](superpowers/specs/2026-11-12-agent-orchestrator-design.md). Plan: [orchestrator part 2](superpowers/plans/2026-11-13-agent-orchestrator-2-task-agent.md).

## Answer buttons

When an agent asks a question or wants to run a command, the page shows what is being asked and a button for each option. A click answers only if the same prompt is still on screen and the option you chose is highlighted. If not, it tells you to use the terminal. Options that need typed text go to the terminal too.

Agents started in a terminal are listed and you can read their conversation. Stop, terminal, messages, model switch and answer buttons only work for agents started in the background (from this page or with `claude --bg`).

## Terminal

The terminal attaches to the agent only. You can use `!` commands inside Claude, but there is no free shell. Up to 8 terminals can be open.

## Notifications

You get a Mac notification when an agent has been waiting for you for a few seconds, so a prompt that resolves at once stays silent. Each agent notifies at most once every three minutes, however often it goes back to waiting. It only works while StudioManager is open.

## Claude sign-in

A claude.ai sign-in ends on a set date, and once it has ended agents stop working. The page tells you before that happens. It reads the date from `claude auth status`, which reports `loginExpiresAt` from Claude Code 2.1.318.

- **More than 10 days left:** a muted line under the page title, "Claude sign-in until 8 Nov".
- **10 days or fewer:** a warning on the page and in the [menu bar](menu-bar.md) Agents tab: "Claude sign-in ends in 4 days (8 Nov). Run claude auth login in a terminal."
- **Ended, or signed out:** the same place, in red.
- **Check again** (on the warning) reads the status right away, so it clears as soon as you have signed in again.

The app checks when Agents start and then every hour. Days left are counted from the last check, so the warning stays right between checks. While the menu bar is on, you also get a Mac notification at 10, 3 and 1 day left, and when the sign-in has ended (or Claude is signed out). Each comes once per sign-in. A new sign-in starts over. Which ones were sent is kept in `login-alerts.json` in the app data folder.

A sign-in with no end date shows nothing: an API key, or a token from `claude setup-token` in `CLAUDE_CODE_OAUTH_TOKEN`. The studio Mac mini signs in that second way (its SSH sessions read the token from `~/.config/claude-oauth.env`), and for it `claude auth status` gives `loginExpiresAt: null`, so the app cannot show its end. These tokens last about a year. The renewal is tracked as an Upkeep item in StudioManager instead.

## Capture

Note a thought in one line, without opening the main window. Press **Control-Option-Space** anywhere: a small field opens over whatever is on screen, centred on the screen under the mouse. It starts empty each time.

- **Enter** saves it to the Inbox of the active organisation and the field closes.
- **Shift+Enter** adds a line.
- **Tab** picks a project (optional): type to filter, arrow keys and Enter to choose, Esc to close the list only. The project is kept with the capture.
- **Esc** closes the field. Clicking elsewhere closes it too.

The **Agents** tab of the [menu bar](menu-bar.md) has the same field, so a capture also works without the shortcut. Both need the Agents switch on.

- A capture is refused while the active organisation is in test or presentation mode. The text stays in the field, so nothing typed is lost.
- If another app or macOS already uses Control-Option-Space (macOS does, under Keyboard › Input Sources), StudioManager starts as usual and Settings › Agents says the shortcut is taken. Free it, then turn Agents off and on. The menu bar field still works.
- The shortcut and the field are not in the demo build.

Agents can also note a thought through the `capture` tool of [Agent access](agent-access.md#tools).

## Capture from Reminders

Turn on **Capture from Reminders** in Settings › Agents and name a list (**Inbox** by default). Every 2 minutes, and right after the Mac wakes, StudioManager reads the open reminders of that list, saves each as a capture (the title, then the notes), and ticks it in Reminders. A reminder added on your iPhone or Watch shows in the Inbox within a few minutes. It only works while StudioManager is open, and it waits while the organisation is in test or presentation mode.

- The list name cannot start with "-". The list must already exist in your **default** Reminders account, the one your phone shows. StudioManager never creates a list; if it is missing, Settings says so and names the account.
- The first time, macOS asks to allow StudioManager to control Reminders (System Settings › Privacy & Security › Automation).
- If Reminders is slow, StudioManager says "Reminders did not answer" and tries again on the next pass. A reminder is never captured twice, even when ticking it failed or you changed organisation in between. If you change organisation (or enter test or presentation mode) during a pass, the pass stops and the rest waits for the next one; a reminder that cannot be saved is skipped and tried again. Switching Agents off also switches this off.
- Not in the demo build. Captures made this way show "Reminders" as their source in the [Inbox](#inbox).

## Inbox and briefs

The Agents page has three tabs: **Needs you**, **Inbox** and **All agents** (the list described above). The first two show a count when something waits. Needs you is the first tab.

### Inbox

Every capture of the active organisation, in three groups: **New**, **Filed** and **Dismissed**. Each one shows its text, where it came from (shortcut, menu bar, agent or Reminders) and its project when it has one.

- **File…** puts it under a project yourself, as a task or as a subtask of an open task, with a title.
- **Dismiss** sets it aside, **Restore** brings it back.
- A capture the brief session could not place shows "No project fits" and the reason. It stays in the Inbox until you file it.
- After 3 failed tries a capture shows **Briefing failed**. **Brief again** gives it new tries.

### Brief session

Off by default. In Settings › Agents, switch on **Brief new captures with an agent**. It needs Agents on and [Agent access](agent-access.md) allowed for the organisation.

- **The folder.** The app prepares a `briefing` folder in its data folder. It holds the config for the StudioManager server and a settings file that only denies tools. Turning the switch on asks you to trust that folder in Claude Code, once.
- **The session.** At most every 15 minutes, when new captures wait, the app starts one background agent on Opus in that folder. It takes up to 20 captures of one organisation, the one whose oldest capture is oldest. Organisations in test or presentation mode are skipped.
- **What it may do.** It starts with only the StudioManager server and seven tools: read captures, projects, tasks and wiki articles, and file a capture with its brief. The server itself lists and allows only those seven for this session (the `STUDIOMANAGER_TOOLS` setting in the folder's config), and the session may not read files, search, start other agents, use skills or the browser, run a shell, edit files or use the web. It never creates projects or clients.
- **What it writes.** For each capture it finds the project, reads the wiki, decisions and open tasks, then files the capture as a task, or as a subtask of an open task that already covers it. It writes a short brief (what to do, done when, unclear) and sets an outcome: a note, ready, or needs your word. With no clear project it leaves the capture in the Inbox with a reason.
- **Limits.** It starts only while [the budget](#the-budget) allows: it pauses while the 5-hour plan limit is at 80% or more, while the week is ahead of its pace, and when there is no usage reading from the last 30 minutes. A session that runs over 20 minutes, or waits for an answer for over 2 minutes, is stopped. The app gives a session 60 seconds to appear in the list before it counts it as ended.
- **After it.** When everything is filed, the session is stopped and removed. Each capture sent gets one try counted when the session starts (a start that fails before it began counts none and is shown as the last failure; the next slot tries again). After 3 tries a capture that is still waiting shows **Briefing failed** in the Inbox. Settings shows the last failure, the next session time and why a session is paused. The app only trusts "not in the list" after the Agents list has been read again following the start. Switching Agents off stops a running brief session.

### Needs you

Everything that waits on you, in four groups. The tab, the sidebar's Agents entry and the menu bar icon show how many entries wait (Decide, Check and Briefs together).

- **Decide:** a question from a worker that the lead could not answer from what is written, or something the app could not settle: a worker that could not start, one waiting at a permission prompt, one that stopped without a result or a question, one still stuck after three restarts. A question shows the recommendation, a button per option and **Answer in words**. Your answer is typed into the waiting agent, and saved as a decision in the project's wiki when the lead marked the question as one. A permission prompt has **Open the agent** and **Dismiss**. A worker that could not start has **Dismiss**. A worker that stopped or is stuck has **Open the agent** and **Answer in words**, typed into it. A question from an agent you started yourself comes here without a lead's reading.
- **Check:** finished work. Each entry shows the result, the number of changed lines, whether the check command passed, and what the change touches (migrations, dependencies, deletions). **Accept** marks the item done, as in [the panel](#the-panel); it does not merge: use **Open the pull request** and merge on GitHub. **Send back** types your note into the worker, and its next result is checked again.
- **Briefs:** captures filed with the outcome "needs your word": the project, your original words and the brief. From there you can **Start an agent** on the task, **Keep as a task** (it leaves the list and stays a task), or open the brief.
- **Decided alone:** what the lead or the app did without you in the last 7 days, each with its reason: a question answered from the wiki, work sent back (it carries a "Sent back" badge), a worker restarted or wrapped up, a pull request merged. **Reopen** puts the entry back in its group. Reopening a merged entry does not undo the merge; the item goes back to To check.

An agent of the watcher that has an open entry here is left out of the Needs you group of **All agents**, so nothing is listed twice.

Design and reasons: [agent orchestrator design](superpowers/specs/2026-11-12-agent-orchestrator-design.md). Plan: [orchestrator part 1](superpowers/plans/2026-11-12-agent-orchestrator-1-capture.md).

## The watcher and the lead

The **watcher** is plain code in the app, not a model. While it is on, it starts an agent (a **worker**) on the next Ready task, follows the workers it started, and lists what waits on you under [Needs you](#needs-you). The **lead** is a short Opus session the watcher starts for one event at a time: a worker's question, or finished work to read. Nothing runs all day.

Design and reasons: [agent orchestrator design](superpowers/specs/2026-11-12-agent-orchestrator-design.md). Plan, with what changed while it was built: [orchestrator part 3](superpowers/plans/2026-11-13-agent-orchestrator-3-watcher-lead.md).

### Turning it on

In Settings › Agents, switch on **Start work on Ready tasks by itself** and set **Workers at once** (3 by default, 1 to 5; it limits the workers with work in progress, and workers waiting for you under Check do not count). It is off by default and needs the Agents switch; switching Agents off pauses it. Turning it on asks you to trust the lead's folder in Claude Code, once.

The watcher makes a pass every 30 seconds, and right after the Mac wakes, only while StudioManager is open. A line on the Needs you tab says which task it would start next, or why it waits. It does nothing:

- in the demo build;
- while any organisation is in test or presentation mode (the whole watcher pauses, not only that organisation);
- when another copy of the same build already runs the watcher (one per data folder).

For an organisation whose [Agent access](agent-access.md) is off, it starts no worker and no lead session; workers already started there are still checked, wrapped up and closed.

The dev build has its own switch, off by default, with a warning: its workers use your real Claude plan and the repositories of the projects in its data.

### The budget

Before it starts a worker, a lead session or a brief session, the app reads your plan usage ([plan limits](menu-bar.md#plan-limits)). Nothing starts when:

- the week's use is ahead of its pace: above a straight line from 0% when the week began to 85% at the reset (the last 15% is kept for work you start yourself);
- the 5-hour window is at 80% or more;
- there is no usage reading, the reading is more than 30 minutes old, or its week has already reset.

The reading is written by the status line while Claude Code runs. So without plan limits set up, or when Claude Code has not been used for 30 minutes, the watcher waits. The Agents page says why ("Paused: ahead of the week's pace…").

Paused does not mean unseen: questions and finished work are listed for you without the lead's reading. Two things still happen over the budget, so that work already started is not left half done, and both make a worker spend some usage: the check command runs and a first failure is typed back to the worker, and a worker a day old is asked to wrap up. A stuck worker is restarted only while the budget allows. Agents you start yourself never read the budget.

### Workers

On each pass the watcher starts at most one worker, on the first Ready task or subtask it can start, across the organisations agents may use: highest priority first (a deadline today or past counts as high, tomorrow as at least medium; a subtask takes its task's priority), then the nearest deadline, then the oldest. An item is skipped when its project has no linked folder or the folder is not a git repository; the reason shows when it is the first in line and nothing else can start. A repository that is not trusted in Claude Code gives one "Could not start" entry under Decide (see [New agent](#new-agent) for the trust rule); the item is not tried again while that entry is open.

A worker:

- runs on Opus, in the background, named `sm-w-task-<id>` or `sm-w-subtask-<id>`;
- works in its own git worktree, `<project folder>/.claude/worktrees/sm-task-<id>`, on a new branch `sm/task-<id>` cut from the default branch of `origin` (after a fetch), or from the local `main` or `master` when there is no `origin` or its default branch is not known. A branch or folder of that name that already exists is refused, never reused;
- may edit files without asking (`acceptEdits`) and use six StudioManager tools without a prompt: read its tasks, project and wiki, `ask` and `report_result`. Other permission prompts are Claude Code's own: pushing the branch and opening the pull request wait for your answer unless your own Claude Code settings allow those commands. The worker is told to run each of these commands on its own, so a prompt names one plain command;
- is told to do the work of the brief, push the branch, open a pull request, and write its result with `report_result`.

The item goes to Running. The cap counts the workers with work in progress. A worker that handed in its result and now waits for your decision under Check no longer counts, so the next task can start. A waiting worker counts until the app has seen it idle in a fresh agent list. A waiting worker that goes back to work (you or the lead send its work back, a question of its is answered, you type into it) counts again at once, so the number of working workers can exceed the cap by as many as were waiting; nothing new starts until it is back under the cap. Agents you start yourself are never counted, and the watcher never types into, stops or resumes an agent it did not start.

### The Stop hook

A worker gets a Stop hook (`studiomanager-mcp --stop-hook`, passed in a settings file for that session only). It keeps a worker from ending unseen: it sends the worker on once when it stops without having called `report_result`, and once when it ends on a question it did not send through `ask`. Each reason at most once per session.

### The check command

A project can have one **check command** (its test command, for example `npm test`, 500 characters at most), in the **Agents** section of the project's page, shown while Agents is on. Only you can set it, in the app: no tool writes it. When a worker has reported its result, the app runs the command in the worker's worktree, through `/bin/sh`, for 10 minutes at most.

- **Passed, or no command set:** a Check entry is written.
- **Failed the first time:** the end of the output (8 KB at most) is typed back to the worker with the command, once.
- **Failed again, or the worker can no longer be reached:** a Check entry marked "Check failed".

Each of these Check entries is read by a lead session when the budget allows, whatever the check said. Some ends skip the lead and come straight to you: a worker that ended without a result, a worktree that is gone, and a worker wrapped up after a day.

### When a worker stops

- **Asks a question** (`ask`): a Decide entry. The lead answers it when the answer is written in the brief, the wiki or the decisions, naming where; otherwise it is yours, with the lead's recommendation.
- **Stuck on a connection error** (the Mac slept mid-answer; the worker has been idle for 2 minutes with a server error at the end of its conversation): told to continue, at most three times and at least 5 minutes apart, then listed under Decide. A worker whose process is gone is resumed as a new agent with the same conversation. A rate limit or an ended sign-in is never retried: the worker stays idle and comes to Decide after 30 minutes, or at the next pass when its session is stopped.
- **Waiting at a permission prompt** for more than 2 minutes: a Decide entry that opens the agent. The lead never answers a prompt.
- **Idle for 30 minutes without a result or a question:** a Decide entry.
- **Stopped without a result or a question** (you ran `claude stop`, or the session died): a Decide entry at the next pass, with no 30-minute wait. A server error at the end of its conversation is still resumed first. Typing an instruction into it restarts the same session.
- **Started more than a day ago, idle, no result:** asked once to write its result, then stopped 30 minutes later if it still has none; the work comes to you under Check ("Wrapped up after a day"). If the request cannot be typed, it is listed under Decide and the worker is not stopped. A worker whose session is already stopped is not asked to wrap up: it is listed under Decide ("Stopped without a result") and keeps its slot until you answer it or remove it.
- **Its work was accepted or dismissed:** the worker is stopped if it still runs and its link is closed. It stopped counting in the cap as soon as it waited for you under Check.

### Lead sessions

One lead session runs at a time, on Opus, for 20 minutes at most, in a `lead` folder in the app data folder. It starts with only the StudioManager server and seven tools: read the entry it is given, the project, its tasks and wiki, and write its answer with `resolve` or `hand_over` ([Agent access](agent-access.md#limiting-a-session-to-some-tools)). It has no shell and no file tools: it cannot delete, release or touch money. For one worker there are at most three question sessions and two check sessions; after that, entries come straight to you.

- **A question:** it answers from what is written and says where, or hands the question to you with a recommendation. The answer is typed into the worker by the app.
- **Finished work:** it reads the result and the diff, then accepts, sends the work back once with a note, or hands it to you with a summary.

When the lead accepts, the entry comes back to you as "The lead would accept: …" unless [merging alone](#merging-alone) is on for the project. A finished lead session is stopped and kept in the agent list (`sm-lead-…`) until you remove it: the watcher never deletes an agent.

### Merging alone

Off by default, per project: **The lead may merge small changes alone**, in the project's agent settings. A project marked **Belongs to a hub** is never merged alone: the switch is off and locked there, and your choice comes back if you remove the hub mark. With it on, a change is merged without you only when all of these hold; the app works each one out itself, and the lead's accept is only one of them:

- the lead accepted the work, the budget allowed the pass, agent access is on for the organisation, and the watcher is still allowed to run after the check;
- a check command is set, passed the first time, and passes again, run a second time by the app on the very commit that is merged;
- the change is between 1 and 99 lines (added plus removed), with no binary file, and the worktree is clean;
- the worker reported the pull request link, the pull request is at the commit the app checked, and its base is the branch the worktree was cut from on `origin` (a project with no remote never merges alone);
- nothing it touches always asks: migrations and SQL files, package and lock files, version and release files, anything under `.github`, security and machine settings (`.claude`, permissions, entitlements, `.env`, `CLAUDE.md`…), anything about money (a path with a word such as `invoice`, `price` or `tax`; `syntax` matches too, on purpose), a deleted file, a symlink, a submodule, a changed file mode, or a path with unusual characters;
- the pull request is on github.com, in the repository the project folder points to, open, not a draft, mergeable, and GitHub reports the same lines, files and paths as the app measured.

The app then runs `gh pr merge --squash` pinned to that commit, once. It never deletes the branch or the worktree. Afterwards the item is done, and "Merged: check passed, N lines" is listed under Decided alone with the lead's reason. Anything that fails sends the entry back to you with the reason ("The lead would accept; not merged: …"); a refused or failed merge is never tried again. When GitHub's answer is unclear (a merge queue, a timeout), the entry says to look at the pull request and the item is not marked done.

### What it never does

- Start a session in the demo build, in test or presentation mode, or over the budget.
- Touch an agent you started yourself.
- Delete an agent, a branch, a worktree or a file. It stops the agents it started; you remove them.
- Merge a hub's project, or any project where you did not switch merging alone on.
- Answer a permission prompt, release, or change money data.

### To know before switching it on

- Worktrees go under `<project folder>/.claude/worktrees/`. A project that does not ignore that folder sees it as untracked files. They stay after the work is done: remove them yourself (`git worktree remove`).
- A project folder that is a subfolder of a larger repository gets a worktree of the whole repository.
- The repository itself must be trusted in Claude Code, not only a folder above it.
- Merging alone needs a check command that leaves the worktree clean (build output must be git-ignored), `gh` signed in, and a repository whose rules allow a squash merge without a review. Turn off "Automatically delete head branches" on GitHub if the branch should stay.
- A task you typed by hand shows no brief box and no stage menu until it has a brief.

## Morning brief comments

The personal morning brief (the page the Start of day routine opens) lets you select a passage, write a note and **Send** it to the morning agent, which answers in its chat. StudioManager receives those comments, as AgentBar did before it:

- A small server on `127.0.0.1:47480`, reachable from this Mac only. It starts the first time the Agents switch is on and runs until StudioManager quits.
- Every request needs the token in `brief-token` in the app data folder (readable by you only), which the brief's renderer writes into the page. Requests from another web page, or to another host name, are refused.
- A comment is typed into the background agent named `personal-sod` started that day. If there is none, the comment is kept with the reason ("No morning agent running for …") and the page shows it as not sent.
- Comments are kept per day in `brief-comments/<date>.json` in the app data folder.

If the page says comments stay in the browser and its button reads **Keep**, StudioManager isn't answering: open it and check that Agents is on.

## Start from a review report

A studio review report (a local HTML page of findings) can start agents the same way as [Start from a task](#start-from-a-task): right-click a finding and choose **Start work with agent**. The report sends the finding to the same local server as the morning brief (`POST /review/agent`, with the same token), and StudioManager:

- starts an agent on Opus in the folder the report gives for that finding, named after it (`review-d1-backups-skip-activities`). The folder must already be trusted in Claude Code: from a report there is no trust question, so an untrusted folder is refused with the reason, shown on the page;
- tells the agent which finding to work on (its id, title and text), to check that it still holds, then to say what it found and ask what to do before changing anything;
- brings its window forward on the Agents page, on the new agent.

A second click while an agent is starting on the same finding is turned away.

The report also keeps where each finding stands, so its list and scores follow your fixes. StudioManager stores one status per finding (`open`, `in_progress`, `fixed`, `accepted`) in `review-status/<report>.json` in the app data folder (`GET` and `POST /review/status/<report>`). Starting an agent from the report marks an open finding `in_progress` and remembers the agent; reading the statuses adds that agent's state from the Agents list (working, needs you, idle, done, or gone once it is deleted). Marking a finding fixed or accepted is yours to do from the report. The report's renderer writes the token and each finding's folder into the page, so only a copy made on this Mac can start agents; copies elsewhere (a phone, the NAS) can still copy the finding's prompt.
