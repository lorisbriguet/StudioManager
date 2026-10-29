import { useState } from "react";
import { Button, ICONS, ICON_SIZE, IconButton, Select } from "../ui";
import { PrefilledExpenseModal } from "./PrefilledExpenseModal";
import { useT } from "../../i18n/useT";
import { useUpdateMachine } from "../../db/hooks/useUpkeep";
import { useExpenses } from "../../db/hooks/useExpenses";
import { formatMoney } from "../../lib/money";
import { formatDisplayDate } from "../../utils/formatDate";
import { todayLocalISO } from "../../utils/localDate";
import type { Machine } from "../../types/upkeep";

/** Price of the machine, with a link to an existing expense or a new prefilled one. */
export function MachineExpenseRow({ machine }: { machine: Machine }) {
  const t = useT();
  const update = useUpdateMachine();
  const { data: expenses = [] } = useExpenses();
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);

  const linked = expenses.find((e) => e.id === machine.expense_id);

  return (
    <div className="space-y-2">
      <div className="text-sm tabular-nums">
        {machine.price != null ? formatMoney(machine.price, machine.currency ?? "CHF") : "—"}
      </div>
      {machine.expense_id != null ? (
        <div className="flex items-center gap-2 text-xs">
          <ICONS.expense size={ICON_SIZE.control} className="text-muted" />
          <span>{linked ? `${linked.reference} · ${linked.supplier}` : t.upkeep_expense_linked}</span>
          <IconButton
            size="xs"
            icon={ICONS.unlink}
            label={t.upkeep_unlink_expense}
            onClick={() => update.mutate({ id: machine.id, data: { expense_id: null } })}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {picking ? (
            <Select
              fullWidth={false}
              aria-label={t.upkeep_link_expense}
              value=""
              onChange={(e) => {
                if (e.target.value) update.mutate({ id: machine.id, data: { expense_id: Number(e.target.value) } });
                setPicking(false);
              }}
            >
              <option value="">{t.upkeep_pick_expense}</option>
              {expenses.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.reference} · {e.supplier} · {formatMoney(e.amount, "CHF")}
                </option>
              ))}
            </Select>
          ) : (
            <Button variant="secondary" icon={ICONS.link} onClick={() => setPicking(true)}>
              {t.upkeep_link_expense}
            </Button>
          )}
          <Button variant="secondary" icon={ICONS.expense} onClick={() => setCreating(true)}>
            {t.upkeep_create_expense}
          </Button>
        </div>
      )}
      {creating && (
        <PrefilledExpenseModal
          supplier={machine.supplier ?? undefined}
          amount={machine.price ?? undefined}
          currency={machine.currency}
          date={machine.purchase_date ?? todayLocalISO()}
          onCancel={() => setCreating(false)}
          onSaved={(id) => {
            update.mutate({ id: machine.id, data: { expense_id: id } });
            setCreating(false);
          }}
        />
      )}
      {linked && <div className="text-xs text-muted">{formatDisplayDate(linked.invoice_date)}</div>}
    </div>
  );
}
