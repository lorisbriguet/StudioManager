import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { InlineRename } from "../ui/InlineRename";
import { Tooltip } from "../ui/Tooltip";
import { useOrgStore } from "../../stores/org-store";
import { renameOrganisation, reorderOrganisations, deleteOrganisation } from "../../lib/orgs";
import { notify } from "../../lib/notify";
import { useConfirm } from "../../lib/confirm";
import { useT } from "../../i18n/useT";
import { SettingsCard } from "../ui/Settings";

export function OrganisationsCard() {
  const t = useT();
  const organisations = useOrgStore((s) => s.organisations);
  const activeId = useOrgStore((s) => s.activeId);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const confirm = useConfirm();

  const startEditing = (o: { id: string; name: string }) => setEditing({ id: o.id, name: o.name });

  // Checked on Enter and blur; an error keeps the field open. An unchanged
  // name just closes it (InlineRename), no backend call.
  const validateName = (id: string, name: string) => {
    if (name === "") return t.organisation_name_required;
    const taken = organisations.some((o) => o.id !== id && o.name.toLowerCase() === name.toLowerCase());
    return taken ? t.organisation_name_taken : null;
  };

  const commitRename = async (id: string, name: string) => {
    try {
      useOrgStore.getState().applyRegistry(await renameOrganisation(id, name));
      setEditing(null);
    } catch (e) {
      notify.error(t.error_rename_organisation, e);
      // Keep the edit open so the user can retry.
    }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const ids = organisations.map((o) => o.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    try {
      useOrgStore.getState().applyRegistry(await reorderOrganisations(ids));
    } catch (e) {
      notify.error(t.error_reorder_organisations, e);
    }
  };

  // A whole organisation, no undo: the name has to be typed.
  const remove = async (o: { id: string; name: string }) => {
    const ok = await confirm({
      title: t.confirm_delete_named.replace("{name}", o.name),
      message: t.delete_organisation_confirm,
      confirmLabel: t.delete,
      tone: "danger",
      requireText: o.name,
    });
    if (!ok) return;
    try {
      useOrgStore.getState().applyRegistry(await deleteOrganisation(o.id));
      notify.success(t.organisation_deleted);
    } catch (e) {
      notify.error(t.error_delete_organisation, e);
    }
  };

  return (
    <SettingsCard title={t.organisations} desc={t.organisations_desc}>
      <ul>
        {organisations.map((o, idx) => {
          const isActive = o.id === activeId;
          const isLast = organisations.length === 1;
          return (
            <li key={o.id} className="flex items-center gap-2 py-2 border-b border-[var(--color-border-divider)] last:border-b-0">
              {editing?.id === o.id ? (
                <InlineRename
                  value={o.name}
                  label={t.rename_organisation}
                  validate={(name) => validateName(o.id, name)}
                  onSave={(name) => commitRename(o.id, name)}
                  onCancel={() => setEditing(null)}
                  className="flex-1 text-sm"
                />
              ) : (
                <span className="flex-1 text-sm truncate">
                  {o.name}
                  {isActive && <span className="ml-2 text-xs text-muted">({t.active})</span>}
                </span>
              )}
              <Button variant="outline" icon={<ArrowUp size={12} />} aria-label={t.move_up} disabled={idx === 0} onClick={() => void move(idx, -1)} />
              <Button variant="outline" icon={<ArrowDown size={12} />} aria-label={t.move_down} disabled={idx === organisations.length - 1} onClick={() => void move(idx, 1)} />
              <Button variant="outline" icon={<Pencil size={12} />} aria-label={t.rename_organisation} onClick={() => startEditing(o)} />
              {/* span: a disabled button gets no mouse events, and the hint explains why it is disabled */}
              <Tooltip content={isActive ? t.delete_organisation_active : isLast ? t.delete_organisation_last : undefined}>
                <span className="inline-flex">
                  <Button
                    variant="outline"
                    icon={<Trash2 size={12} />}
                    aria-label={t.delete_organisation}
                    disabled={isActive || isLast}
                    onClick={() => void remove(o)}
                  />
                </span>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}
