import { useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { Badge, Button, EmptyState } from "../ui";
import { PrefilledExpenseModal } from "./PrefilledExpenseModal";
import { SubscriptionForm } from "./SubscriptionForm";
import { useT } from "../../i18n/useT";
import {
  useCancelSubscription,
  useDecideRenewal,
  useDeleteSubscription,
  usePendingRenewals,
  useSubscriptions,
} from "../../db/hooks/useUpkeep";
import { yearlyTotal, type PendingRenewal } from "../../db/queries/subscriptions";
import { formatMoney } from "../../lib/upkeep/money";
import { formatDisplayDate } from "../../utils/formatDate";
import type { Subscription } from "../../types/upkeep";

/** Subscriptions table, yearly total per currency and the renewals waiting for an expenses answer. */
export function SubscriptionsTab() {
  const t = useT();
  const { data: subs = [] } = useSubscriptions();
  const { data: pending = [] } = usePendingRenewals();
  const decide = useDecideRenewal();
  const cancel = useCancelSubscription();
  const del = useDeleteSubscription();
  const [editing, setEditing] = useState<Subscription | "new" | null>(null);
  const [adding, setAdding] = useState<PendingRenewal | null>(null);

  const totals = useMemo(() => [...yearlyTotal(subs).entries()], [subs]);
  const head = "px-4 py-2.5 text-left text-xs font-normal text-muted border-b border-[var(--color-border-header)] whitespace-nowrap";
  const cell = "px-4 py-2.5";
  const iconBtn = "p-1.5 rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover-row)] hover:text-[var(--color-text-secondary)]";

  const yearly = (s: Subscription) => (s.period === "month" ? s.cost * 12 : s.cost);

  const doCancel = async (s: Subscription) => {
    if (!(await ask(t.upkeep_sub_cancel_confirm, { kind: "warning" }))) return;
    cancel.mutate(s.id);
  };
  const remove = async (s: Subscription) => {
    if (!(await ask(t.upkeep_sub_delete_confirm, { kind: "warning" }))) return;
    del.mutate(s.id);
  };

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] text-sm"
            >
              <span className="flex-1">
                {t.upkeep_renewed_add
                  .replace("{name}", r.name)
                  .replace("{amount}", formatMoney(r.amount, r.currency))}
              </span>
              <span className="text-xs tabular-nums">{formatDisplayDate(r.renewed_on)}</span>
              <Button size="sm" onClick={() => setAdding(r)}>{t.upkeep_renewal_add}</Button>
              <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: r.id, decision: "skipped" })}>
                {t.upkeep_renewal_skip}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted tabular-nums">
          {totals.map(([cur, amount]) => (
            <div key={cur}>{t.upkeep_yearly_total.replace("{amount}", formatMoney(amount, cur))}</div>
          ))}
        </div>
        <Button icon={<Plus size={14} />} onClick={() => setEditing("new")}>{t.upkeep_add_subscription}</Button>
      </div>

      {subs.length === 0 ? (
        <EmptyState message={t.upkeep_subs_empty} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={head}>{t.name}</th>
                <th className={head}>{t.upkeep_col_renews}</th>
                <th className={head}>{t.upkeep_col_period}</th>
                <th className={`${head} text-right`}>{t.upkeep_col_cost}</th>
                <th className={`${head} text-right`}>{t.upkeep_col_per_year}</th>
                <th className={head}>{t.upkeep_col_status}</th>
                <th className={head} />
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => {
                const off = s.status === "cancelled";
                return (
                  <tr
                    key={s.id}
                    className={`border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)] transition-colors ${off ? "opacity-50" : ""}`}
                  >
                    <td className={cell}>
                      <div className="font-medium">{s.name}</div>
                      {s.plan && <div className="text-xs text-muted">{s.plan}</div>}
                    </td>
                    <td className={`${cell} tabular-nums`}>{off ? "" : formatDisplayDate(s.renews_on)}</td>
                    <td className={`${cell} text-muted`}>
                      {s.period === "month" ? t.upkeep_period_month : t.upkeep_period_year}
                    </td>
                    <td className={`${cell} text-right tabular-nums`}>{formatMoney(s.cost, s.currency)}</td>
                    <td className={`${cell} text-right tabular-nums`}>{formatMoney(yearly(s), s.currency)}</td>
                    <td className={cell}>
                      <Badge variant={off ? "neutral" : "success"}>{off ? t.cancelled : t.active}</Badge>
                    </td>
                    <td className={cell}>
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" className={iconBtn} aria-label={t.edit} title={t.edit} onClick={() => setEditing(s)}>
                          <Pencil size={14} />
                        </button>
                        {!off && (
                          <button
                            type="button"
                            className={iconBtn}
                            aria-label={t.upkeep_sub_cancel}
                            title={t.upkeep_sub_cancel}
                            onClick={() => void doCancel(s)}
                          >
                            <XCircle size={14} />
                          </button>
                        )}
                        <button type="button" className={iconBtn} aria-label={t.delete} title={t.delete} onClick={() => void remove(s)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <SubscriptionForm subscription={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
      )}
      {adding && (
        <PrefilledExpenseModal
          title={t.upkeep_renewal_expense_title}
          supplier={subs.find((s) => s.id === adding.subscription_id)?.vendor ?? adding.name}
          amount={adding.amount}
          date={adding.renewed_on}
          onCancel={() => setAdding(null)}
          onSaved={async (expenseId) => {
            await decide.mutateAsync({ id: adding.id, decision: "added", expenseId });
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}
