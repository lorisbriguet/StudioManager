# Agents

The Agents page shows every Claude Code agent running on your Mac in one place, so you can see which ones need you without opening each terminal. It is off until you turn it on. The app talks to the `claude` command on your Mac; the only port it opens is the one for [morning brief comments](#morning-brief-comments) and [review reports](#start-from-a-review-report), on this Mac only.

Design and reasons: [the design spec](superpowers/specs/2026-10-28-agents-window-design.md). For letting AI apps read your StudioManager data, see [Agent access](agent-access.md), which is a separate feature. To see and answer agents from the Mac menu bar, see [Menu bar](menu-bar.md).

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

Trust follows Claude Code's own rule: a trusted folder covers every folder inside it. Starting an agent in a folder that is not trusted yet asks first ("Trust … for Claude Code?"). On **Trust and start**, StudioManager sets `hasTrustDialogAccepted` for that folder in `~/.claude.json`, the same thing answering Yes to Claude's own question does: it takes Claude's lock (`~/.claude.json.lock`), changes only that flag and keeps the file private. The home folder gets a stronger warning, since trusting it trusts everything in it. Nothing is trusted without that yes.

## Start from a task

Right-click a task, a subtask or a project and choose **Start work with agent**. The item is in the menus of the Tasks page (task and subtask rows, project headers), the Projects page, a project's Tasks section, and the Calendar's task, subtask and deadline events. It is hidden while agents are off.

One click starts an agent on Opus in the project's linked folder and opens it on this page. There is no form: the agent is told which item to work on (its ids and titles), reads it and its context with the StudioManager tools ([Agent access](agent-access.md)), then tells you what it found and asks what to do before changing anything. Answer it in the conversation.

- **No linked folder:** a folder picker opens; the folder you choose becomes the project's linked folder. Cancelling starts nothing.
- **Folder not trusted yet:** the same trust question as **New agent**.
- **Again on the same item:** each click starts a new agent, named after the item (`task-44-new-features`).

Design: [the design spec](superpowers/specs/2026-11-05-agent-from-task-design.md).

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
