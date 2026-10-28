# Retiring AgentBar

A checklist for moving from the AgentBar menu bar app to StudioManager's [menu bar](menu-bar.md). Reasons and decisions: section 7 of [the design spec](superpowers/specs/2026-10-28-menu-bar-design.md). Do the steps in order; keep AgentBar until step 4 works.

1. **Turn on the menu bar.** In Settings > Agents, switch on Show in menu bar. Check that the icon appears and the Agents tab lists your agents.
2. **Set up plan limits.** In Settings > Agents, use Set up plan limits. AgentBar's status line is replaced after you confirm the preview; the previous one is kept so Remove can restore it. Send a message in Claude Code and check the Usage tab shows your limits.
3. **Remove the safety-event settings.** AgentBar pointed Claude Code's `OTEL_*` keys at its own local server, on port 47480. StudioManager doesn't use them, and AgentBar's local server goes away once you quit it (step 5).
   1. Copy `~/.claude/settings.json` to a backup, for example `~/.claude/settings.json.bak`.
   2. In its `env` block, delete the `OTEL_*` keys that point at AgentBar's local address (`localhost:47480` or `127.0.0.1:47480`). Leave other keys alone.
   3. Check the file is still valid JSON.
4. **Set up your routines** in Settings > Agents > Routines (see [Routines](menu-bar.md#routines)).
   - **Personal:** two agent routines, start and end of day, each reading its prompt from your own prompt file. Schedule start of day on weekdays or daily at 08:00.
   - **Art Basel:** command routines that run your own script, which calls the control room and prints what to show. Keep the script, and any key it needs, in your own tooling, never in StudioManager. Give the program as an absolute path and the arguments one per line.
   - Brief comments: message the start-of-day agent from the Agents page.
5. **Retire AgentBar.**
   1. Quit AgentBar, then remove it from System Settings > General > Login Items.
   2. Stop and remove its 08:00 launchd job:
      ```
      launchctl bootout gui/$(id -u)/ch.lorisbriguet.agentbar.sod
      rm ~/Library/LaunchAgents/ch.lorisbriguet.agentbar.sod.plist
      ```
      If `launchctl bootout` says the job isn't loaded (or "No such process"), that's harmless: it was already stopped.
   3. Delete the AgentBar app.

What you give up for now: the launcher, the results inbox, wrap up and the saved-tasks window. See also [Agents](agents.md) and [Agent access](agent-access.md).
