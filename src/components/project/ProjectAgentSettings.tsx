import { useState } from "react";
import { Input, Toggle } from "../ui";
import { useT } from "../../i18n/useT";
import { useSetProjectAgentSettings } from "../../db/hooks/useNeedsYou";
import type { Project } from "../../types/project";

const MAX_CHECK_COMMAND = 500;

/**
 * A project's settings for the agents: the check command the app runs when a worker finishes,
 * whether the lead may merge small changes alone, and whether the project belongs to a hub.
 * Shown on the project page while Agents is on. Writes only through the settings hook.
 */
export function ProjectAgentSettings({ project }: { project: Project }) {
  const t = useT();
  const set = useSetProjectAgentSettings();
  const saved = project.check_command ?? "";
  const [command, setCommand] = useState(saved);
  const hub = project.hub_project === 1;

  return (
    <section aria-label={t.project_agent_settings} className="mb-4 space-y-3">
      <div>
        <label htmlFor="project-check-command" className="block text-xs font-medium text-muted mb-1">
          {t.project_check_command}
        </label>
        <Input
          id="project-check-command"
          value={command}
          maxLength={MAX_CHECK_COMMAND}
          placeholder={t.project_check_command_placeholder}
          className="font-mono"
          onChange={(e) => setCommand(e.target.value)}
          onBlur={() => {
            if (command.trim() !== saved) set.mutate({ id: project.id, settings: { check_command: command } });
          }}
        />
        <p className="text-xs text-muted mt-1">{t.project_check_command_hint}</p>
      </div>
      <Toggle
        checked={project.merge_alone === 1}
        disabled={hub}
        ariaLabel={t.project_merge_alone}
        onChange={(on) => set.mutate({ id: project.id, settings: { merge_alone: on ? 1 : 0 } })}
        label={t.project_merge_alone}
        description={hub ? t.project_merge_alone_hub : t.project_merge_alone_desc}
      />
      <Toggle
        checked={hub}
        ariaLabel={t.project_hub}
        onChange={(on) => set.mutate({ id: project.id, settings: { hub_project: on ? 1 : 0 } })}
        label={t.project_hub}
        description={t.project_hub_desc}
      />
    </section>
  );
}
