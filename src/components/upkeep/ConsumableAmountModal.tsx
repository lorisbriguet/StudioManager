import { useState } from "react";
import { DatePicker, FormField, FormGrid, FormModal, Input, Select } from "../ui";
import { useT } from "../../i18n/useT";
import { useLogConsumableUsage, useRestockConsumable } from "../../db/hooks/useUpkeep";
import { useProjects } from "../../db/hooks/useProjects";
import { todayLocalISO } from "../../utils/localDate";
import type { Consumable } from "../../types/upkeep";

interface Props {
  mode: "usage" | "restock";
  consumable: Consumable;
  onClose: () => void;
  /** Restock only: called with the amount added, after the stock was updated. */
  onRestocked?: (amount: number) => void;
}

/** Amount prompt for "Log usage" (optional project, date) and "Restock". */
export function ConsumableAmountModal({ mode, consumable: c, onClose, onRestocked }: Props) {
  const t = useT();
  const logUsage = useLogConsumableUsage();
  const restock = useRestockConsumable();
  const { data: projects = [] } = useProjects();
  const [amount, setAmount] = useState("");
  const [projectId, setProjectId] = useState("");
  const [usedOn, setUsedOn] = useState(todayLocalISO());
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const n = Number(amount);
    if (!(n > 0)) { setError(t.upkeep_amount_positive); return; }
    try {
      if (mode === "usage") {
        await logUsage.mutateAsync({
          id: c.id, amount: n, projectId: projectId ? Number(projectId) : null, usedOn,
        });
      } else {
        await restock.mutateAsync({ id: c.id, amount: n });
        onRestocked?.(n);
      }
      onClose();
    } catch {
      // The mutation already surfaced the error as a toast; keep the prompt open.
    }
  };

  return (
    <FormModal
      open
      size="sm"
      onClose={onClose}
      title={`${mode === "usage" ? t.upkeep_log_usage : t.upkeep_restock} · ${c.name}`}
      submitLabel={t.save}
      submitting={logUsage.isPending || restock.isPending}
      onSubmit={() => void save()}
    >
      <FormGrid cols={1}>
        <FormField label={t.upkeep_amount} error={error ?? undefined}>
          <Input
            type="number"
            min={0}
            step="any"
            numeric
            unit={c.unit}
            value={amount}
            autoFocus
            onChange={(e) => { setAmount(e.target.value); setError(null); }}
          />
        </FormField>
        {mode === "usage" && (
          <>
            <FormField label={t.project}>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">{t.no_project}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </FormField>
            <FormField label={t.date}>
              <DatePicker value={usedOn} onChange={(v) => setUsedOn(v ?? todayLocalISO())} />
            </FormField>
          </>
        )}
      </FormGrid>
    </FormModal>
  );
}
