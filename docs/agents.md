# Agents

The Agents page shows every Claude Code agent running on your Mac in one place, so you can see which ones need you without opening each terminal. It is off until you turn it on. Nothing listens on a network port: the app talks to the `claude` command on your Mac and nothing else.

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

An agent in Needs you that has waited for more than 2 hours with no change, or that you dismiss, moves to Idle. A dismissal covers only the current wait: the next time that agent needs you, it shows in Needs you again.

For each agent you can read the conversation. Agents started in the background (from this page or with `claude --bg`) also let you send a message, switch model, stop or delete them. Agents started in a terminal are listed and readable only. In Needs you you can also dismiss an agent.

- **Send a message:** not while a prompt is open, and not for agents started in a terminal. The message always reaches the agent as text: it is pasted in one piece, then Enter is pressed. A message that starts with `!` or `/` gets a space in front, so it never runs a shell command or a slash command such as `/clear`: use the terminal for those. If a prompt opens while the message is being pasted, Enter is not pressed and the message stays in the agent's input.
- **Switch model:** stops the agent and continues the same conversation as a new agent on the model you pick.

Starting an agent (or the new agent of a model switch) can take a while: the app waits up to a minute for `claude`. If that is not enough, it looks for the agent in the list by its name and folder, so an agent that did start is not reported as failed and is not started twice. Other `claude` commands (list, stop, delete) are given 10 seconds.

## New agent

Pick a folder, write the task, choose a model (haiku, sonnet, opus or fable) and optionally give it a name. Only folders you already trusted in Claude are offered, linked project folders first. StudioManager never accepts Claude's trust question for you.

## Answer buttons

When an agent asks a question or wants to run a command, the page shows what is being asked and a button for each option. A click answers only if the same prompt is still on screen and the option you chose is highlighted. If not, it tells you to use the terminal. Options that need typed text go to the terminal too.

Agents started in a terminal are listed and you can read their conversation. Stop, terminal, messages, model switch and answer buttons only work for agents started in the background (from this page or with `claude --bg`).

## Terminal

The terminal attaches to the agent only. You can use `!` commands inside Claude, but there is no free shell. Up to 8 terminals can be open.

## Notifications

You get a Mac notification when an agent has been waiting for you for a few seconds, so a prompt that resolves at once stays silent. Each agent notifies at most once every three minutes, however often it goes back to waiting. It only works while StudioManager is open.
