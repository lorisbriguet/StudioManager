import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Input } from "./ui/Input";
import { FormField } from "./ui/FormField";
import { FormGrid, FormModal } from "./ui/Form";
import { Radio } from "./ui/Checkbox";
import { createOrganisation, DEFAULT_ORG_PREFS, type Organisation } from "../lib/orgs";
import { useOrgStore } from "../stores/org-store";
import { useTimerActions } from "../hooks/useTimerActions";
import { switchOrganisation, defaultSwitchDeps } from "../lib/switchOrganisation";
import { notifyError } from "../lib/notifyError";
import { useT } from "../i18n/useT";

export function OrgCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { stopAndSave } = useTimerActions();
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const reset = () => { setName(""); setSeed(false); setError(undefined); };

  const submit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) { setError(t.organisation_name_required); return; }
    if (useOrgStore.getState().organisations.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(t.organisation_name_taken);
      return;
    }
    setBusy(true);

    // Creation and switching are reported separately: a create failure keeps
    // the dialog open (nothing exists yet, the typed name is still valid to
    // retry); a switch failure/decline happens after the organisation
    // already exists, so the dialog still closes — the switcher lists it.
    let created: Organisation | undefined;
    try {
      const reg = await createOrganisation(trimmed, seed, { ...DEFAULT_ORG_PREFS });
      useOrgStore.setState({ organisations: reg.organisations });
      created = reg.organisations.find((o) => o.name === trimmed);
      toast.success(t.organisation_created);
    } catch (e) {
      notifyError(t.organisation_create_failed, e);
      setBusy(false);
      return;
    }

    try {
      if (created) {
        const ok = await switchOrganisation(created.id, defaultSwitchDeps(navigate, stopAndSave));
        if (ok) toast.success(t.organisation_switched.replace("{name}", trimmed));
      }
    } catch (e) {
      notifyError(t.organisation_switch_failed, e);
    } finally {
      setBusy(false);
    }
    reset();
    onClose();
  };

  return (
    <FormModal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title={t.new_organisation}
      size="sm"
      submitLabel={t.create_organisation}
      onSubmit={() => void submit()}
      submitting={busy}
    >
      <FormGrid cols={1}>
        <FormField label={t.organisation_name} required error={error}>
          <Input
            value={name}
            onChange={(e) => { setName(e.target.value); setError(undefined); }}
            autoFocus
          />
        </FormField>
        <fieldset className="flex flex-col items-start gap-2">
          <Radio
            name="seed"
            label={<span className="font-medium">{t.start_empty}</span>}
            description={t.start_empty_desc}
            checked={!seed}
            onChange={() => setSeed(false)}
          />
          <Radio
            name="seed"
            label={<span className="font-medium">{t.start_from_current}</span>}
            description={t.start_from_current_desc}
            checked={seed}
            onChange={() => setSeed(true)}
          />
        </fieldset>
      </FormGrid>
    </FormModal>
  );
}
