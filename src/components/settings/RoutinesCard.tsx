import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { SettingRow, SettingsCard } from "./SettingsPrimitives";
import { ask } from "@tauri-apps/plugin-dialog";
import { BAR_ICON_BUTTON, Button, FormField, Input, Select } from "../ui";
import { ModelMenu } from "../agents/ModelMenu";
import { slugifyName } from "../agents/StartAgentForm";
import { useT } from "../../i18n/useT";
import { startFolders, type StartFolder } from "../../lib/agents";
import { getRoutines, saveRoutines, type Routine, type Routines, type Section } from "../../lib/routines";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TEXTAREA =
  "w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-lg px-3 py-2 text-sm focus-accent";

function folderText(f: StartFolder): string {
  const l = f.label;
  return l ? `${l.orgName} › ${l.clientName} › ${l.projectName} — ${f.path}` : f.path;
}

/** A row of exclusive choices (native radios, so keyboard and screen readers just work). */
function Choices<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {options.map((o) => (
        <label key={o.value} className="inline-flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="accent-[var(--color-accent)]"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function moved<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---------- Section editor ----------

function SectionForm({
  section,
  onSave,
  onCancel,
  error,
}: {
  section: Section;
  onSave: (s: Section) => void;
  onCancel: () => void;
  error: string | null;
}) {
  const t = useT();
  const [name, setName] = useState(section.name);
  const [links, setLinks] = useState(section.links);
  const [nameError, setNameError] = useState<string | undefined>();

  const setLink = (i: number, patch: Partial<Section["links"][number]>) =>
    setLinks(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = () => {
    if (!name.trim()) return setNameError(t.routines_section_required);
    onSave({ ...section, name: name.trim(), links: links.filter((l) => l.label.trim() && l.target.trim()) });
  };

  return (
    <form
      className="space-y-3 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormField label={t.routines_section_name} required error={nameError}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <div className="space-y-2">
        <div className="text-xs text-muted">{t.routines_links}</div>
        {links.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label={t.routines_link_label}
              placeholder={t.routines_link_label}
              value={l.label}
              onChange={(e) => setLink(i, { label: e.target.value })}
            />
            <Input
              aria-label={t.routines_link_target}
              placeholder={t.routines_link_target}
              value={l.target}
              onChange={(e) => setLink(i, { target: e.target.value })}
            />
            <button type="button" className={BAR_ICON_BUTTON} aria-label={t.delete} onClick={() => setLinks(links.filter((_, j) => j !== i))}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={() => setLinks([...links, { label: "", target: "" }])}>
          {t.routines_add_link}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t.save}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}

// ---------- Routine editor ----------

type PromptKind = "text" | "file";
type ScheduleChoice = "none" | "daily" | "weekdays";

function RoutineForm({
  routine,
  onSave,
  onCancel,
  error,
}: {
  routine: Routine;
  onSave: (r: Routine) => void;
  onCancel: () => void;
  error: string | null;
}) {
  const t = useT();
  const k = routine.kind;
  const [title, setTitle] = useState(routine.title);
  const [idleHint, setIdleHint] = useState(routine.idleHint);
  const [kind, setKind] = useState<"agent" | "command">(k.kind);
  // Agent
  const [folders, setFolders] = useState<StartFolder[]>([]);
  const [folder, setFolder] = useState(k.kind === "agent" ? k.folder : "");
  const [model, setModel] = useState(k.kind === "agent" ? k.model : "sonnet");
  const [agentName, setAgentName] = useState(k.kind === "agent" ? k.name : "");
  const [promptKind, setPromptKind] = useState<PromptKind>(k.kind === "agent" && "file" in k.prompt ? "file" : "text");
  const [prompt, setPrompt] = useState(k.kind === "agent" ? ("file" in k.prompt ? k.prompt.file : k.prompt.text) : "");
  // Command
  const [program, setProgram] = useState(k.kind === "command" ? k.program : "");
  const [argsText, setArgsText] = useState(k.kind === "command" ? k.args.join("\n") : "");
  const [cwd, setCwd] = useState(k.kind === "command" ? k.cwd : "");
  const [resultLink, setResultLink] = useState(routine.resultLink ?? "");
  const [days, setDays] = useState<ScheduleChoice>(routine.schedule?.days ?? "none");
  const [time, setTime] = useState(routine.schedule?.time ?? "08:00");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    startFolders()
      .then((f) => alive && setFolders(f))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const submit = () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = t.routines_title_required;
    if (kind === "agent") {
      if (!folder) e.folder = t.routines_folder_required;
      if (!prompt.trim()) e.prompt = t.routines_prompt_required;
    } else {
      if (!program.trim()) e.program = t.routines_program_required;
      if (!cwd.trim()) e.cwd = t.routines_folder_required;
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    onSave({
      ...routine,
      title: title.trim(),
      idleHint: idleHint.trim(),
      kind:
        kind === "agent"
          ? {
              kind: "agent",
              folder,
              model,
              name: agentName.trim() || slugifyName(title) || "routine",
              prompt: promptKind === "file" ? { file: prompt.trim() } : { text: prompt },
            }
          : {
              kind: "command",
              program: program.trim(),
              args: argsText.split("\n").filter((l) => l.trim() !== ""),
              cwd: cwd.trim(),
            },
      resultLink: resultLink.trim() || null,
      schedule: days === "none" ? null : { time, days },
    });
  };

  return (
    <form
      className="space-y-3 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormField label={t.routines_routine_title} required error={errors.title}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </FormField>
      <FormField label={t.routines_idle_hint}>
        <Input value={idleHint} onChange={(e) => setIdleHint(e.target.value)} />
      </FormField>
      <div>
        <div className="text-xs text-muted mb-1">{t.routines_kind}</div>
        <Choices
          name="routine-kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "agent", label: t.routines_kind_agent },
            { value: "command", label: t.routines_kind_command },
          ]}
        />
      </div>

      {kind === "agent" ? (
        <>
          <FormField label={t.agents_folder} required error={errors.folder}>
            <Select value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">{folders.length === 0 ? t.agents_no_folders : ""}</option>
              {folders.map((f) => (
                <option key={f.path} value={f.path}>
                  {folderText(f)}
                </option>
              ))}
              {folder && !folders.some((f) => f.path === folder) && <option value={folder}>{folder}</option>}
            </Select>
          </FormField>
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <FormField label={t.agents_model}>
              <ModelMenu label={t.agents_model} value={model} onChange={setModel} />
            </FormField>
            <FormField label={t.agents_name}>
              <Input
                value={agentName}
                maxLength={64}
                placeholder={slugifyName(title)}
                onChange={(e) => setAgentName(e.target.value)}
              />
            </FormField>
          </div>
          <div>
            <div className="text-xs text-muted mb-1">{t.routines_prompt_kind}</div>
            <Choices
              name="routine-prompt-kind"
              value={promptKind}
              onChange={setPromptKind}
              options={[
                { value: "text", label: t.routines_prompt_text },
                { value: "file", label: t.routines_prompt_file },
              ]}
            />
          </div>
          <FormField label={promptKind === "file" ? t.routines_prompt_path : t.agents_task} required error={errors.prompt}>
            {promptKind === "file" ? (
              <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            ) : (
              <textarea className={TEXTAREA} rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            )}
          </FormField>
        </>
      ) : (
        <>
          <FormField label={t.routines_program} required error={errors.program}>
            <Input value={program} onChange={(e) => setProgram(e.target.value)} />
          </FormField>
          <FormField label={t.routines_args}>
            <textarea className={TEXTAREA} rows={3} value={argsText} onChange={(e) => setArgsText(e.target.value)} />
          </FormField>
          <FormField label={t.routines_cwd} required error={errors.cwd}>
            <Input value={cwd} onChange={(e) => setCwd(e.target.value)} />
          </FormField>
        </>
      )}

      <FormField label={t.routines_result_link}>
        <Input value={resultLink} onChange={(e) => setResultLink(e.target.value)} />
      </FormField>
      <div>
        <div className="text-xs text-muted mb-1">{t.routines_schedule}</div>
        <Choices
          name="routine-schedule"
          value={days}
          onChange={setDays}
          options={[
            { value: "none", label: t.routines_schedule_none },
            { value: "daily", label: t.routines_schedule_daily },
            { value: "weekdays", label: t.routines_schedule_weekdays },
          ]}
        />
      </div>
      {days !== "none" && (
        <FormField label={t.routines_schedule_time} className="w-32">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </FormField>
      )}

      {error && (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t.save}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}

// ---------- Card ----------

type Editing = { type: "section"; id: string } | { type: "routine"; id: string; sectionId: string } | null;

function blankRoutine(sectionId: string): Routine {
  return {
    id: "",
    sectionId,
    title: "",
    idleHint: "",
    kind: { kind: "agent", folder: "", model: "sonnet", name: "", prompt: { text: "" } },
    resultLink: null,
    schedule: null,
  };
}

/** Settings › Agents: the routines of the menu bar's Day tab, by section. Every change is
 *  saved at once through `routines_save` (Rust validates); its error shows inline. */
export function RoutinesCard() {
  const t = useT();
  const [data, setData] = useState<Routines | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getRoutines()
      .then((r) => alive && setData(r))
      .catch((e) => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, []);

  /** Saves `next`; true when it went through. */
  const save = async (next: Routines): Promise<boolean> => {
    setError(null);
    try {
      setData(await saveRoutines(next));
      return true;
    } catch (e) {
      setError(msg(e));
      return false;
    }
  };

  const closeEditor = () => {
    setEditing(null);
    setError(null);
  };

  const saveSection = async (s: Section) => {
    if (!data) return;
    const exists = data.sections.some((x) => x.id === s.id && s.id !== "");
    const sections = exists ? data.sections.map((x) => (x.id === s.id ? s : x)) : [...data.sections, s];
    if (await save({ ...data, sections })) setEditing(null);
  };

  const saveRoutine = async (r: Routine) => {
    if (!data) return;
    const exists = r.id !== "" && data.routines.some((x) => x.id === r.id);
    const routines = exists ? data.routines.map((x) => (x.id === r.id ? r : x)) : [...data.routines, r];
    if (await save({ ...data, routines })) setEditing(null);
  };

  const deleteSection = async (s: Section) => {
    if (!data) return;
    if (!(await ask(t.routines_delete_section_confirm.replace("{name}", s.name), { kind: "warning" }))) return;
    const id = s.id;
    void save({
      sections: data.sections.filter((s) => s.id !== id),
      routines: data.routines.filter((r) => r.sectionId !== id),
    });
  };

  const deleteRoutine = async (r: Routine) => {
    if (!data) return;
    if (!(await ask(t.routines_delete_confirm.replace("{title}", r.title), { kind: "warning" }))) return;
    void save({ ...data, routines: data.routines.filter((x) => x.id !== r.id) });
  };

  const moveRoutine = (r: Routine, by: number) => {
    if (!data) return;
    // Order within the section: swap with the neighbour in the same section.
    const same = data.routines.filter((x) => x.sectionId === r.sectionId);
    const target = same[same.indexOf(r) + by];
    if (!target) return;
    const from = data.routines.indexOf(r);
    const to = data.routines.indexOf(target);
    void save({ ...data, routines: moved(data.routines, from, to) });
  };

  if (!data) {
    return (
      <SettingsCard title={t.routines_title} desc={t.routines_desc}>
        {error && (
          <p role="alert" className="text-xs text-danger-text pb-2">
            {error}
          </p>
        )}
      </SettingsCard>
    );
  }

  if (editing?.type === "section") {
    const section = data.sections.find((s) => s.id === editing.id) ?? { id: "", name: "", links: [] };
    return (
      <SettingsCard title={t.routines_title}>
        <SectionForm section={section} onSave={(s) => void saveSection(s)} onCancel={closeEditor} error={error} />
      </SettingsCard>
    );
  }
  if (editing?.type === "routine") {
    const routine = data.routines.find((r) => r.id === editing.id) ?? blankRoutine(editing.sectionId);
    return (
      <SettingsCard title={t.routines_title}>
        <RoutineForm routine={routine} onSave={(r) => void saveRoutine(r)} onCancel={closeEditor} error={error} />
      </SettingsCard>
    );
  }

  const summary = (r: Routine) =>
    [
      r.kind.kind === "agent" ? t.routines_kind_agent : t.routines_kind_command,
      r.schedule && `${r.schedule.time} · ${r.schedule.days === "daily" ? t.routines_schedule_daily : t.routines_schedule_weekdays}`,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <SettingsCard title={t.routines_title} desc={t.routines_desc}>
      {data.sections.length === 0 && <div className="text-xs text-muted py-2.5">{t.routines_empty}</div>}
      {data.sections.map((s, si) => {
        const rows = data.routines.filter((r) => r.sectionId === s.id);
        return (
          <div key={s.id} className="pb-2">
            <div className="flex items-center justify-between pt-2">
              <div className="text-[10px] font-medium uppercase tracking-widest text-muted">{s.name}</div>
              <div className="flex items-center">
                <button
                  type="button" className={BAR_ICON_BUTTON} aria-label={`${t.routines_move_up}: ${s.name}`}
                  disabled={si === 0}
                  onClick={() => void save({ ...data, sections: moved(data.sections, si, si - 1) })}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button" className={BAR_ICON_BUTTON} aria-label={`${t.routines_move_down}: ${s.name}`}
                  disabled={si === data.sections.length - 1}
                  onClick={() => void save({ ...data, sections: moved(data.sections, si, si + 1) })}
                >
                  <ArrowDown size={14} />
                </button>
                <button type="button" className={BAR_ICON_BUTTON} aria-label={`${t.edit} ${s.name}`} onClick={() => setEditing({ type: "section", id: s.id })}>
                  <Pencil size={14} />
                </button>
                <button type="button" className={BAR_ICON_BUTTON} aria-label={`${t.delete} ${s.name}`} onClick={() => void deleteSection(s)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {rows.map((r, ri) => (
              <SettingRow key={r.id} label={r.title} desc={summary(r)}>
                <div className="flex items-center">
                  <button type="button" className={BAR_ICON_BUTTON} aria-label={`${t.routines_move_up}: ${r.title}`} disabled={ri === 0} onClick={() => moveRoutine(r, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button" className={BAR_ICON_BUTTON} aria-label={`${t.routines_move_down}: ${r.title}`}
                    disabled={ri === rows.length - 1}
                    onClick={() => moveRoutine(r, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" className={BAR_ICON_BUTTON} aria-label={`${t.edit} ${r.title}`} onClick={() => setEditing({ type: "routine", id: r.id, sectionId: s.id })}>
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button" className={BAR_ICON_BUTTON} aria-label={`${t.delete} ${r.title}`}
                    onClick={() => void deleteRoutine(r)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </SettingRow>
            ))}
            <div className="pt-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing({ type: "routine", id: "", sectionId: s.id })}>
                {t.routines_add_routine}
              </Button>
            </div>
          </div>
        );
      })}
      <div className="pt-1 pb-3">
        <Button size="sm" variant="secondary" onClick={() => setEditing({ type: "section", id: "" })}>
          {t.routines_add_section}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger-text pb-3">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
