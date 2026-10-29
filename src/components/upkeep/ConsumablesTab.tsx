import { useState } from "react";
import { Button, Callout, EmptyState, ICONS, IconButton, Modal, ProgressBar, Table } from "../ui";
import { ConsumableAmountModal } from "./ConsumableAmountModal";
import { ConsumableForm } from "./ConsumableForm";
import { PrefilledExpenseModal } from "./PrefilledExpenseModal";
import { useT } from "../../i18n/useT";
import { useConsumables, useDeleteConsumable, useMachines } from "../../db/hooks/useUpkeep";
import { isLow } from "../../db/queries/consumables";
import { openMachineAttachment } from "../../lib/upkeep/openAttachment";
import { formatMoney } from "../../lib/money";
import { notify } from "../../lib/notify";
import { useConfirm } from "../../lib/confirm";
import { todayLocalISO } from "../../utils/localDate";
import type { Consumable } from "../../types/upkeep";

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Stock bar: full at twice the reorder level; danger colour while low. */
function StockBar({ c }: { c: Consumable }) {
  const pct = c.reorder_level > 0 ? Math.min(100, (c.stock / (c.reorder_level * 2)) * 100) : 100;
  const amount = `${fmt(c.stock)} ${c.unit}`;
  return (
    <div className="flex items-center gap-2.5">
      <ProgressBar className="w-[120px]" value={pct} tone={isLow(c) ? "danger" : "success"} aria-label={`${c.name}: ${amount}`} />
      <span className="text-xs text-muted tabular-nums">{amount}</span>
    </div>
  );
}

/** Consumables table with low-stock banner, reorder link, log usage and restock. */
export function ConsumablesTab() {
  const t = useT();
  const confirm = useConfirm();
  const { data: consumables = [] } = useConsumables();
  const { data: machines = [] } = useMachines();
  const del = useDeleteConsumable();
  const [editing, setEditing] = useState<Consumable | "new" | null>(null);
  const [prompt, setPrompt] = useState<{ mode: "usage" | "restock"; c: Consumable } | null>(null);
  const [offer, setOffer] = useState<{ c: Consumable; amount: number } | null>(null);
  const [expense, setExpense] = useState<{ c: Consumable; amount: number } | null>(null);

  const lowCount = consumables.filter(isLow).length;

  const reorder = (c: Consumable) =>
    openMachineAttachment({ kind: "link", path_or_url: c.product_url ?? "" }).catch((e) =>
      notify.error(t.upkeep_open_failed, e)
    );

  const remove = async (c: Consumable) => {
    if (!(await confirm({ title: t.upkeep_delete_consumable_confirm, confirmLabel: t.delete, tone: "danger" }))) return;
    del.mutate(c.id);
  };

  return (
    <div className="space-y-4">
      {lowCount > 0 && (
        <Callout tone="warning">{t.upkeep_low_banner.replace("{count}", String(lowCount))}</Callout>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{t.upkeep_sorted_by_stock}</span>
        <Button icon={ICONS.add} onClick={() => setEditing("new")}>{t.upkeep_add_consumable}</Button>
      </div>
      <Table>
        <Table.Head>
          <Table.Th>{t.upkeep_col_item}</Table.Th>
          <Table.Th>{t.upkeep_col_for}</Table.Th>
          <Table.Th>{t.upkeep_col_stock}</Table.Th>
          <Table.Th>{t.upkeep_col_reorder_at}</Table.Th>
          <Table.Th>{t.upkeep_col_supplier}</Table.Th>
          <Table.Th numeric>{t.upkeep_col_price}</Table.Th>
          <Table.Th aria-hidden />
          <Table.ActionsTh />
        </Table.Head>
        <Table.Body>
          {consumables.map((c) => (
            <Table.Row key={c.id}>
              <Table.Td className="font-medium">{c.name}</Table.Td>
              <Table.Td muted>{machines.find((m) => m.id === c.machine_id)?.name ?? ""}</Table.Td>
              <Table.Td><StockBar c={c} /></Table.Td>
              <Table.Td muted className="tabular-nums">{c.reorder_level > 0 ? `${fmt(c.reorder_level)} ${c.unit}` : ""}</Table.Td>
              <Table.Td muted>{c.supplier}</Table.Td>
              <Table.Td numeric>
                {c.unit_price != null ? `${formatMoney(c.unit_price, c.currency)} / ${c.unit}` : ""}
              </Table.Td>
              <Table.Td>
                <div className="flex items-center justify-end gap-1">
                  {c.product_url?.trim() && (
                    <Button variant="secondary" icon={ICONS.openExternal} onClick={() => void reorder(c)}>
                      {t.upkeep_reorder}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setPrompt({ mode: "usage", c })}>
                    {t.upkeep_log_usage}
                  </Button>
                  <Button variant="secondary" onClick={() => setPrompt({ mode: "restock", c })}>
                    {t.upkeep_restock}
                  </Button>
                </div>
              </Table.Td>
              <Table.Actions>
                <IconButton size="xs" icon={ICONS.edit} label={t.edit} onClick={() => setEditing(c)} />
                <IconButton size="xs" icon={ICONS.delete} label={t.delete} tone="danger" onClick={() => void remove(c)} />
              </Table.Actions>
            </Table.Row>
          ))}
          {consumables.length === 0 && (
            <Table.Empty colSpan={8}>
              <EmptyState
                icon={ICONS.upkeep}
                message={t.upkeep_consumables_empty}
                action={<Button icon={ICONS.add} onClick={() => setEditing("new")}>{t.upkeep_add_consumable}</Button>}
              />
            </Table.Empty>
          )}
        </Table.Body>
      </Table>

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
            <>
              <Button variant="secondary" onClick={() => setOffer(null)}>{t.upkeep_restock_expense_no}</Button>
              <Button onClick={() => { setExpense(offer); setOffer(null); }}>{t.upkeep_restock_expense_yes}</Button>
            </>
          }
        >
          <p className="text-sm">{t.upkeep_restock_expense_ask}</p>
        </Modal>
      )}
      {expense && (
        <PrefilledExpenseModal
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
