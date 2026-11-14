import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "../../i18n/useT";
import { qk } from "../../db/queryKeys";
import { TAG_COLOR_NAMES } from "../../lib/tagColors";
import { hubErrorText, isHubNotConfirmed, saveHub, type HubView } from "../../lib/hubs";
import { HubDot } from "../agents/HubLine";
import { Button, DropdownSelect, FieldError, FormField, FormGrid, FormGroup, FormModal, Input, Textarea } from "../ui";

const pick = async (directory: boolean): Promise<string | null> => {
  const r = await openDialog({ directory, multiple: false });
  return typeof r === "string" ? r : null;
};

/**
 * Adds a hub, or changes `hub`. The saved hub's program and arguments are not sent back to the
 * app, so an edit asks for them again. Saving opens a native dialog; if the owner cancels it the
 * form stays open.
 */
export function HubForm({ hub, onClose }: { hub: HubView | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(hub?.name ?? "");
  const [colour, setColour] = useState(hub?.colour ?? "blue");
  const [folder, setFolder] = useState(hub?.folder ?? "");
  const [program, setProgram] = useState("");
  const [argsText, setArgsText] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const choose = (directory: boolean, set: (v: string) => void) => () =>
    void pick(directory).then((p) => p && set(p), () => {});

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = t.hubs_name_required;
    if (!folder.trim()) e.folder = t.hubs_folder_required;
    if (!program.trim()) e.program = t.hubs_program_required;
    setErrors(e);
    setFailure(null);
    if (Object.keys(e).length > 0) return;
    try {
      await saveHub({
        id: hub?.id ?? null,
        name: name.trim(),
        colour,
        folder: folder.trim(),
        program: program.trim(),
        args: argsText.split("\n").filter((l) => l.trim() !== ""),
      });
    } catch (err) {
      setFailure(isHubNotConfirmed(err) ? t.hubs_not_allowed : hubErrorText(err));
      return;
    } finally {
      void qc.invalidateQueries({ queryKey: qk.hubs.all });
    }
    onClose();
  };

  return (
    <FormModal
      open
      onClose={onClose}
      title={hub ? t.hubs_edit_title : t.hubs_add_title}
      submitLabel={t.save}
      onSubmit={submit}
    >
      <FormGrid cols={1}>
        <FormField label={t.hubs_name} required error={errors.name}>
          <Input autoFocus value={name} maxLength={64} onChange={(ev) => setName(ev.target.value)} />
        </FormField>
        <FormField label={t.hubs_colour}>
          <DropdownSelect
            value={colour}
            onChange={setColour}
            searchable={false}
            options={TAG_COLOR_NAMES.map((c) => ({
              value: c,
              label: t[`hubs_colour_${c}`],
              icon: <HubDot colour={c} />,
            }))}
          />
        </FormField>
        <FormGroup
          label={t.hubs_folder}
          action={
            <Button variant="secondary" onClick={choose(true, setFolder)}>
              {t.hubs_choose}
            </Button>
          }
        >
          <Input aria-label={t.hubs_folder} aria-invalid={errors.folder ? true : undefined} value={folder} onChange={(ev) => setFolder(ev.target.value)} />
          {errors.folder && <FieldError>{errors.folder}</FieldError>}
        </FormGroup>
        <FormGroup
          label={t.hubs_program}
          action={
            <Button variant="secondary" onClick={choose(false, setProgram)}>
              {t.hubs_choose}
            </Button>
          }
        >
          <Input aria-label={t.hubs_program} aria-invalid={errors.program ? true : undefined} value={program} onChange={(ev) => setProgram(ev.target.value)} />
          {errors.program && <FieldError>{errors.program}</FieldError>}
          {hub && <p className="mt-1 text-xs text-muted">{t.hubs_reenter_hint}</p>}
        </FormGroup>
        <FormField label={t.hubs_args} hint={t.hubs_args_hint}>
          <Textarea rows={3} value={argsText} onChange={(ev) => setArgsText(ev.target.value)} />
        </FormField>
        {failure && <FieldError>{failure}</FieldError>}
      </FormGrid>
    </FormModal>
  );
}
