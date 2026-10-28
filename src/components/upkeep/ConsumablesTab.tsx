import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, EmptyState, MeterBar, Modal } from "../ui";
import { CollapsibleSection } from "./CollapsibleSection";
import { ConsumableAmountModal } from "./ConsumableAmountModal";
import { ConsumableForm } from "./ConsumableForm";
import { PrefilledExpenseModal } from "./PrefilledExpenseModal";
import { useT } from "../../i18n/useT";
import { useConsumables, useDeleteConsumable, useMachines } from "../../db/hooks/useUpkeep";
import { isLow } from "../../db/queries/consumables";
import { openMachineAttachment } from "../../lib/upkeep/openAttachment";
import { formatMoney } from "../../lib/upkeep/money";
import { notifyError } from "../../lib/notifyError";
import { todayLocalISO } from "../../utils/localDate";
import type { Consumable } from "../../types/upkeep";

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Stock bar: full at twice the reorder level; danger colour while low. */
function StockBar({ c }: { c: Consumable }) {
  const pct = c.reorder_level > 0 ? Math.min(100, (c.stock / (c.reorder_level * 2)) * 100) : 100;
  return (
    <div className="flex items-center gap-2.5">
      <MeterBar className="w-[120px]" pct={pct} color={isLow(c) ? "var(--color-danger-text)" : "var(--color-success-text)"} />
      <span className="text-xs text-muted tabular-nums">{fmt(c.stock)} {c.unit}</span>
    </div>
  );
}

/** Consumables table with low-stock banner, reorder link, log usage and restock. */
export function ConsumablesTab() {
  const t = useT();
  const { data: consumables = [] } = useConsumables();
  const { data: machines = [] } = useMachines();
  const del = useDeleteConsumable();
  const [editing, setEditing] = useState<Consumable | "new" | null>(null);
  const [prompt, setPrompt] = useState<{ mode: "usage" | "restock"; c: Consumable } | null>(null);
  const [offer, setOffer] = useState<{ c: Consumable; amount: number } | null>(null);
  const [expense, setExpense] = useState<{ c: Consumable; amount: number } | null>(null);

  const lowCount = consumables.filter(isLow).length;
  const head = "px-4 py-2.5 text-left text-xs font-normal text-muted border-b border-[var(--color-border-header)] whitespace-nowrap";
  const cell = "px-4 py-2.5";
  const iconBtn = "p-1.5 rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover-row)] hover:text-[var(--color-text-secondary)]";

  const reorder = (c: Consumable) =>
    openMachineAttachment({ kind: "link", path_or_url: c.product_url ?? "" }).catch((e) =>
      notifyError(t.upkeep_open_failed, e)
    );

  const remove = async (c: Consumable) => {
    if (!(await ask(t.upkeep_delete_consumable_confirm, { kind: "warning" }))) return;
    del.mutate(c.id);
  };

  return (
    <div className="space-y-4">
      {lowCount > 0 && (
        <CollapsibleSection id="consumables-low" title={t.upkeep_low_stock}>
          <div
            role="status"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] text-sm"
          >
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{t.upkeep_low_banner.replace("{count}", String(lowCount))}</span>
          </div>
        </CollapsibleSection>
      )}
      <CollapsibleSection
        id="consumables-list"
        title={t.upkeep_consumables}
        aside={<Button icon={<Plus size={14} />} onClick={() => setEditing("new")}>{t.upkeep_add_consumable}</Button>}
      >
      <div className="mb-2 text-xs text-muted">{t.upkeep_sorted_by_stock}</div>
      {consumables.length === 0 ? (
        <EmptyState message={t.upkeep_consumables_empty} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={head}>{t.upkeep_col_item}</th>
                <th className={head}>{t.upkeep_col_for}</th>
                <th className={head}>{t.upkeep_col_stock}</th>
                <th className={head}>{t.upkeep_col_reorder_at}</th>
                <th className={head}>{t.upkeep_col_supplier}</th>
                <th className={`${head} text-right`}>{t.upkeep_col_price}</th>
                <th className={head} />
              </tr>
            </thead>
            <tbody>
              {consumables.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] transition-colors">
                  <td className={`${cell} font-medium`}>{c.name}</td>
                  <td className={`${cell} text-muted`}>{machines.find((m) => m.id === c.machine_id)?.name ?? ""}</td>
                  <td className={cell}><StockBar c={c} /></td>
                  <td className={`${cell} text-muted tabular-nums`}>{c.reorder_level > 0 ? `${fmt(c.reorder_level)} ${c.unit}` : ""}</td>
                  <td className={`${cell} text-muted`}>{c.supplier}</td>
                  <td className={`${cell} text-right tabular-nums`}>
                    {c.unit_price != null ? `${formatMoney(c.unit_price, c.currency)} / ${c.unit}` : ""}
                  </td>
                  <td className={cell}>
                    <div className="flex items-center justify-end gap-1">
                      {c.product_url?.trim() && (
                        <Button size="sm" variant="secondary" icon={<ExternalLink size={14} />} onClick={() => void reorder(c)}>
                          {t.upkeep_reorder}
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setPrompt({ mode: "usage", c })}>
                        {t.upkeep_log_usage}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setPrompt({ mode: "restock", c })}>
                        {t.upkeep_restock}
                      </Button>
                      <button type="button" className={iconBtn} aria-label={t.edit} title={t.edit} onClick={() => setEditing(c)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className={iconBtn} aria-label={t.delete} title={t.delete} onClick={() => void remove(c)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </CollapsibleSection>

      {editing && (
        <ConsumableForm consumable={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
      )}
      {prompt && (
        <ConsumableAmountModal
          mode={prompt.mode}
          consumable={prompt.c}
          onClose={() => setPrompt(null)}
          onRestocked={(amount) => setOffer({ c: prompt.c, amount })}
        />
      )}
      {offer && (
        <Modal
          open
          onClose={() => setOffer(null)}
          title={t.upkeep_restock}
          footer={
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setOffer(null)}>{t.upkeep_restock_expense_no}</Button>
              <Button onClick={() => { setExpense(offer); setOffer(null); }}>{t.upkeep_restock_expense_yes}</Button>
            </div>
          }
        >
          <p className="text-sm">{t.upkeep_restock_expense_ask}</p>
        </Modal>
      )}
      {expense && (
        <PrefilledExpenseModal
          title={t.upkeep_restock_expense_yes}
          supplier={expense.c.supplier ?? undefined}
          amount={expense.c.unit_price != null ? Math.round(expense.amount * expense.c.unit_price * 100) / 100 : undefined}
          date={todayLocalISO()}
          onCancel={() => setExpense(null)}
          onSaved={() => setExpense(null)}
        />
      )}
    </div>
  );
}
