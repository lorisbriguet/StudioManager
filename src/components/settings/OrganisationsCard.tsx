import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { useOrgStore } from "../../stores/org-store";
import { renameOrganisation, reorderOrganisations, deleteOrganisation } from "../../lib/orgs";
import { notifyError } from "../../lib/notifyError";
import { useT } from "../../i18n/useT";

export function OrganisationsCard() {
  const t = useT();
  const organisations = useOrgStore((s) => s.organisations);
  const activeId = useOrgStore((s) => s.activeId);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [typed, setTyped] = useState("");

  const startEditing = (o: { id: string; name: string }) => {
    setEditing({ id: o.id, name: o.name });
    setRenameError(null);
  };

  const commitRename = async () => {
    if (!editing) return;
    const trimmed = editing.name.trim();
    if (trimmed === "") {
      setRenameError(t.organisation_name_required);
      return;
    }
    const original = organisations.find((o) => o.id === editing.id);
    if (original && trimmed === original.name) {
      // No actual change: just close the edit, no backend call needed.
      setEditing(null);
      setRenameError(null);
      return;
    }
    const taken = organisations.some((o) => o.id !== editing.id && o.name.toLowerCase() === trimmed.toLowerCase());
    if (taken) {
      setRenameError(t.organisation_name_taken);
      return;
    }
    try {
      useOrgStore.getState().applyRegistry(await renameOrganisation(editing.id, trimmed));
      setEditing(null);
      setRenameError(null);
    } catch (e) {
      notifyError(t.operation_failed, e);
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
      notifyError(t.operation_failed, e);
    }
  };

  const commitDelete = async () => {
    if (!deleting) return;
    try {
      useOrgStore.getState().applyRegistry(await deleteOrganisation(deleting.id));
      toast.success(t.organisation_deleted);
      setDeleting(null);
      setTyped("");
    } catch (e) {
      notifyError(t.operation_failed, e);
    }
  };

  return (
    <section className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-divider)] px-4 pt-3 pb-1">
      <div className="border-b border-[var(--color-border-divider)] pb-2 mb-3">
        <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted">{t.organisations}</h2>
        <p className="text-xs text-muted mt-1 normal-case tracking-normal">{t.organisations_desc}</p>
      </div>
      <ul>
        {organisations.map((o, idx) => {
          const isActive = o.id === activeId;
          const isLast = organisations.length === 1;
          return (
            <li key={o.id} className="flex items-center gap-2 py-2 border-b border-[var(--color-border-divider)] last:border-b-0">
              {editing?.id === o.id ? (
                <div className="flex-1 min-w-0">
                  <Input
                    value={editing.name}
                    onChange={(e) => {
                      setEditing({ id: o.id, name: e.target.value });
                      setRenameError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename();
                      if (e.key === "Escape") {
                        setEditing(null);
                        setRenameError(null);
                      }
                    }}
                    autoFocus
                  />
                  {renameError && (
                    <p role="alert" className="text-xs text-danger-text mt-1">
                      {renameError}
                    </p>
                  )}
                </div>
              ) : (
                <span className="flex-1 text-sm truncate">
                  {o.name}
                  {isActive && <span className="ml-2 text-xs text-muted">({t.active})</span>}
                </span>
              )}
              <Button variant="ghost" size="sm" icon={<ArrowUp size={12} />} aria-label={t.move_up} disabled={idx === 0} onClick={() => void move(idx, -1)} />
              <Button variant="ghost" size="sm" icon={<ArrowDown size={12} />} aria-label={t.move_down} disabled={idx === organisations.length - 1} onClick={() => void move(idx, 1)} />
              <Button variant="ghost" size="sm" icon={<Pencil size={12} />} aria-label={t.rename_organisation} onClick={() => startEditing(o)} />
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 size={12} />}
                aria-label={t.delete_organisation}
                disabled={isActive || isLast}
                title={isActive ? t.delete_organisation_active : isLast ? t.delete_organisation_last : undefined}
                onClick={() => {
                  setDeleting({ id: o.id, name: o.name });
                  setTyped("");
                }}
              />
            </li>
          );
        })}
      </ul>
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t.delete_organisation}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>{t.cancel}</Button>
            <Button variant="danger" size="sm" disabled={typed.trim() !== deleting?.name} onClick={() => void commitDelete()}>{t.delete}</Button>
          </>
        }
      >
        <p className="text-sm text-muted mb-3">{t.delete_organisation_confirm}</p>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={deleting?.name} autoFocus />
      </Modal>
    </section>
  );
}
