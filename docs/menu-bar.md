# Menu bar

The menu bar puts StudioManager's arrow in your Mac menu bar. One click opens a small panel with your Claude Code agents, your plan limits and your daily routines, without opening the main window. It is off until you turn it on. Nothing listens on a network port.

Design and reasons: [the design spec](superpowers/specs/2026-10-28-menu-bar-design.md). It builds on [Agents](agents.md); for letting AI apps read your data, see [Agent access](agent-access.md), which is a separate feature. Moving over from AgentBar: [the retirement checklist](retire-agentbar.md).

## Turning it on

1. Turn on the Agents page first (see [Agents](agents.md)).
2. Open Settings > Agents and switch on **Show in menu bar**. It needs the Agents switch.

With it on:

- StudioManager starts when you log in, with its window hidden. The icon is in the menu bar.
- Closing the window keeps StudioManager running. Clicking the Dock icon shows the window again.
- Cmd+Q quits the app and removes the icon.

The icon turns amber while any agent needs you.

## The panel

Click the icon to open the panel; click anywhere else to close it. It has three tabs.

### Agents

The same list as the Agents page: Needs you, Working, Idle and Done. You can answer a prompt right here, with the same safety rules as the page (see [Answer buttons](agents.md#answer-buttons)). Clicking an agent opens it in the main window.

### Usage

- **Plan limits:** the 5-hour window, the week for all models and the week per model, each with the percent used, when it resets and a pacing line, for example "On pace to hit 100% Thu 15:40" or "On pace for 70% at reset". Pacing counts idle time too. Meters turn amber from 75% and red from 90%.
- **Tokens:** the last 7 days by client (through linked folders), and the week's model mix. Cache reads are not counted.
- **Agent time:** per client and project, Today or Week. It is a guide from agent activity, not a timesheet, and it is never written to your time entries. **Copy as text** copies it.

Until plan limits are set up, the tab points you to Settings.

### Day

Your routines, grouped in sections you name. Each routine shows its status (idle hint, Running, Done at 08:12, or Failed with the reason), a main button and a "..." menu: Run now, Open folder or Open link. The main button is **Run**; it becomes **Open result** once a run is done and the routine has a result link, and **Open** (the agent, in StudioManager) once an agent routine has started its agent.

Scheduled routines catch up: if the Mac was asleep or the app was closed at the time, a routine runs when it wakes if it is less than 2 hours late. A routine runs at most once per day on its schedule. If a scheduled run fails, you get one notification.

## Plan limits

Claude Code reports your plan limits through its status line. StudioManager provides its own status line command, which reads them, keeps them in the app data folder and prints nothing.

In Settings > Agents, **Set up plan limits** first shows a preview of what will be written to `~/.claude/settings.json`, and backs the file up before changing it. If the file changed after the preview, or is not valid JSON, nothing is written and you are told.

Only one status line can be set. If you already have another one, the preview warns that it will stop showing, and nothing changes until you confirm. **Remove** puts your previous status line back. Turning the menu bar off, or the Agents page with it, also offers to remove it. The Remove button stays in Settings > Agents while a StudioManager status line is set, even one from an older copy of the app or with Agents off.

Limits appear after Claude Code's next reply.

## Alerts

**Usage limit alerts** (Settings > Agents, on by default) sends a Mac notification:

- when a window passes 80%;
- when you are on pace to run out more than an hour before the window resets.

Each alert fires once per window. Turned off, limits are still recorded, so nothing piles up when you turn it back on. Needs-you notifications keep working with the window closed.

## Routines

Set them up in Settings > Agents > Routines. Routines live in your app data folder, not in StudioManager's code.

- **Sections:** a name, plus optional links shown in the section header. A link is a label and a web address or an absolute path. Deleting a section deletes its routines; both ask first. Use the arrows to reorder.
- **Agent routine:** a folder, a model, a name and the prompt, typed or read from a file (give its absolute path). With a prompt file, the agent is told to read and follow that file, so long prompts are fine. The agent runs in the background; open it from the Agents tab. It can also name a result link, which is what **Open result** opens: a web address (http or https) or an absolute path. To comment on a result, message that agent from the Agents page.
- **Command routine:** a program (absolute path), its arguments one per line, and a working folder. It never runs through a shell, so no pipes or wildcards: put those in a script and run the script. The status line is the last non-empty line of its output; exit code 0 is done, anything else is failed. A command is stopped after 10 minutes, and only the last 64 KB of its output is kept.
- **Schedule:** optional. A time, every day or weekdays.

Deleting a routine asks first.
